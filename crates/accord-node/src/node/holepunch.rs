//! Politique du poinçonnage coordonné (SPEC §11.2) : logique pure et état
//! borné, sans E/S — testable sans réseau.
//!
//! Le rendez-vous reste **sans serveur central** : la demande de poinçonnage
//! (`ControlMsg::PunchRequest`) transite par un lien déjà établi avec l'ami —
//! typiquement une session bout-en-bout tunnelée par un relais (un nœud ami du
//! réseau, SPEC §10), ou une session directe qu'on cherche à re-poinçonner
//! après un changement de réseau. Les candidats échangés sont **frais** (à la
//! seconde près), contrairement au record de présence DHT (rafraîchi à la
//! minute) : les deux salves de HELLO se croisent dans la fenêtre d'ouverture
//! des mappings NAT.
//!
//! Ce module décide (fonctions pures + [`PunchCoordinator`]) ; le câblage
//! (envoi des messages, lancement des salves UDP/TCP) vit dans
//! [`crate::runtime`] et [`crate::maintenance`].
//!
//! **Surface d'attaque considérée** : un pair de session (même authentifié)
//! est potentiellement hostile.
//! - Il ne doit pas pouvoir faire arroser des tiers : candidats bornés
//!   ([`accord_proto::limits::MAX_PUNCH_CANDIDATES`] au décodage), filtrés
//!   ([`sanitize_candidates`] : ni adresse non spécifiée, ni multicast, ni
//!   broadcast, ni port nul), et une salve n'émet que quelques petits HELLO.
//! - Il ne doit pas pouvoir nous épuiser : demandes entrantes cadencées par
//!   pair ([`INBOUND_MIN_INTERVAL_MS`]), état global borné
//!   ([`MAX_TRACKED_PEERS`]).
//! - Une `PunchResponse` non sollicitée (ou rejouée) est ignorée : elle doit
//!   porter le jeton d'une demande sortante encore fraîche.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;

use accord_proto::limits::MAX_PUNCH_CANDIDATES;

/// Intervalle minimal entre deux demandes ENTRANTES honorées d'un même pair.
pub const INBOUND_MIN_INTERVAL_MS: u64 = 10_000;

/// Intervalle minimal entre deux demandes SORTANTES vers un même ami (le
/// poinçonnage périodique par présence DHT continue en parallèle).
pub const OUTBOUND_MIN_INTERVAL_MS: u64 = 30_000;

/// Durée de vie d'un jeton de demande sortante : au-delà, la réponse est
/// ignorée (anti-rejeu tardif).
pub const TOKEN_TTL_MS: u64 = 30_000;

/// Nombre maximal de pairs suivis par le coordinateur (borne mémoire stricte ;
/// les entrées périmées sont purgées avant tout refus).
pub const MAX_TRACKED_PEERS: usize = 256;

/// Filtre et borne des candidats reçus du réseau (SPEC §11.2) : déduplique,
/// écarte les adresses inutilisables ou dangereuses à arroser (non spécifiée,
/// multicast, broadcast IPv4, port nul) et plafonne à
/// [`MAX_PUNCH_CANDIDATES`]. Le loopback est écarté aussi : un ami distant n'a
/// aucune raison légitime de nous faire poinçonner notre propre machine.
pub fn sanitize_candidates(candidates: &[SocketAddr]) -> Vec<SocketAddr> {
    let mut out: Vec<SocketAddr> = Vec::new();
    for addr in candidates {
        if out.len() >= MAX_PUNCH_CANDIDATES {
            break;
        }
        if addr.port() == 0 || out.contains(addr) {
            continue;
        }
        let ip = addr.ip();
        let unusable = ip.is_unspecified()
            || ip.is_multicast()
            || ip.is_loopback()
            || matches!(ip, IpAddr::V4(v4) if v4.is_broadcast());
        if unusable {
            continue;
        }
        out.push(*addr);
    }
    out
}

/// Demande sortante en attente de réponse.
struct Outstanding {
    token: u64,
    sent_ms: u64,
}

/// État interne du coordinateur (sous verrou).
#[derive(Default)]
struct CoordState {
    /// Demandes sortantes en vol, par ami.
    outstanding: HashMap<[u8; 32], Outstanding>,
    /// Dernière demande entrante honorée, par pair (cadence).
    last_inbound: HashMap<[u8; 32], u64>,
    /// Dernière demande sortante émise, par ami (cadence).
    last_outbound: HashMap<[u8; 32], u64>,
}

impl CoordState {
    /// Purge les entrées périmées pour tenir la borne mémoire.
    fn prune(&mut self, now_ms: u64) {
        self.outstanding
            .retain(|_, o| now_ms.saturating_sub(o.sent_ms) < TOKEN_TTL_MS);
        self.last_inbound
            .retain(|_, t| now_ms.saturating_sub(*t) < INBOUND_MIN_INTERVAL_MS);
        self.last_outbound
            .retain(|_, t| now_ms.saturating_sub(*t) < OUTBOUND_MIN_INTERVAL_MS);
    }

    fn tracked(&self) -> usize {
        self.outstanding
            .len()
            .max(self.last_inbound.len())
            .max(self.last_outbound.len())
    }
}

/// Cadence et corrélation des échanges de poinçonnage coordonné. Tout l'état
/// est borné ; chaque méthode prend l'horloge en paramètre (testable).
#[derive(Default)]
pub struct PunchCoordinator {
    inner: Mutex<CoordState>,
}

impl PunchCoordinator {
    /// Enregistre une demande sortante vers `friend` avec `token`. Rend faux
    /// si une demande trop récente existe déjà (cadence) ou si la borne
    /// mémoire est atteinte : l'appelant n'émet alors rien.
    pub fn begin_request(&self, friend: [u8; 32], token: u64, now_ms: u64) -> bool {
        let mut st = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        st.prune(now_ms);
        if let Some(last) = st.last_outbound.get(&friend) {
            if now_ms.saturating_sub(*last) < OUTBOUND_MIN_INTERVAL_MS {
                return false;
            }
        }
        if st.tracked() >= MAX_TRACKED_PEERS && !st.last_outbound.contains_key(&friend) {
            return false;
        }
        st.last_outbound.insert(friend, now_ms);
        st.outstanding.insert(
            friend,
            Outstanding {
                token,
                sent_ms: now_ms,
            },
        );
        true
    }

    /// Décide d'honorer une demande ENTRANTE de `peer` : rend faux si sa
    /// dernière demande honorée est trop récente (cadence par pair) ou si la
    /// borne mémoire est atteinte.
    pub fn accept_inbound(&self, peer: [u8; 32], now_ms: u64) -> bool {
        let mut st = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        st.prune(now_ms);
        if let Some(last) = st.last_inbound.get(&peer) {
            if now_ms.saturating_sub(*last) < INBOUND_MIN_INTERVAL_MS {
                return false;
            }
        }
        if st.tracked() >= MAX_TRACKED_PEERS && !st.last_inbound.contains_key(&peer) {
            return false;
        }
        st.last_inbound.insert(peer, now_ms);
        true
    }

    /// Consomme la demande sortante correspondant à une réponse de `friend`
    /// portant `token`. Rend vrai si (et seulement si) une demande fraîche au
    /// même jeton existait : sinon la réponse est non sollicitée (forgée,
    /// rejouée ou périmée) et doit être ignorée.
    pub fn take_response(&self, friend: [u8; 32], token: u64, now_ms: u64) -> bool {
        let mut st = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let matches = st
            .outstanding
            .get(&friend)
            .is_some_and(|o| o.token == token && now_ms.saturating_sub(o.sent_ms) < TOKEN_TTL_MS);
        if matches {
            st.outstanding.remove(&friend);
        }
        matches
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn sanitize_ecarte_les_candidats_dangereux() {
        let cands = [
            addr("203.0.113.7:48016"),  // légitime
            addr("0.0.0.0:48016"),      // non spécifiée
            addr("203.0.113.8:0"),      // port nul
            addr("224.0.0.1:48016"),    // multicast v4
            addr("[ff02::1]:48016"),    // multicast v6
            addr("255.255.255.255:80"), // broadcast
            addr("127.0.0.1:48016"),    // loopback
            addr("203.0.113.7:48016"),  // doublon
            addr("192.168.1.5:48016"),  // LAN : légitime (ami sur le même réseau)
        ];
        let ok = sanitize_candidates(&cands);
        assert_eq!(
            ok,
            vec![addr("203.0.113.7:48016"), addr("192.168.1.5:48016")]
        );
    }

    #[test]
    fn sanitize_plafonne_le_nombre_de_candidats() {
        let flood: Vec<SocketAddr> = (0..64)
            .map(|i| addr(&format!("203.0.113.7:{}", 1000 + i)))
            .collect();
        assert_eq!(sanitize_candidates(&flood).len(), MAX_PUNCH_CANDIDATES);
    }

    #[test]
    fn demandes_entrantes_cadencees_par_pair() {
        let c = PunchCoordinator::default();
        let peer = [1u8; 32];
        assert!(c.accept_inbound(peer, 1_000));
        assert!(!c.accept_inbound(peer, 1_000 + INBOUND_MIN_INTERVAL_MS - 1));
        assert!(c.accept_inbound(peer, 1_000 + INBOUND_MIN_INTERVAL_MS));
        // Un autre pair n'est pas affecté par la cadence du premier.
        assert!(c.accept_inbound([2u8; 32], 1_001));
    }

    #[test]
    fn demandes_sortantes_cadencees_et_correlees() {
        let c = PunchCoordinator::default();
        let friend = [3u8; 32];
        assert!(c.begin_request(friend, 42, 5_000));
        assert!(
            !c.begin_request(friend, 43, 5_100),
            "cadence sortante respectée"
        );
        // Réponse au bon jeton : consommée une seule fois (anti-rejeu).
        assert!(c.take_response(friend, 42, 6_000));
        assert!(!c.take_response(friend, 42, 6_001), "rejeu ignoré");
    }

    #[test]
    fn reponse_non_sollicitee_ou_perimee_ignoree() {
        let c = PunchCoordinator::default();
        let friend = [4u8; 32];
        // Jamais demandé : ignorée.
        assert!(!c.take_response(friend, 7, 1_000));
        // Mauvais jeton : ignorée (et la demande reste consommable).
        assert!(c.begin_request(friend, 7, 1_000));
        assert!(!c.take_response(friend, 8, 1_500));
        assert!(c.take_response(friend, 7, 1_600));
        // Périmée : ignorée.
        assert!(c.begin_request(friend, 9, 100_000));
        assert!(!c.take_response(friend, 9, 100_000 + TOKEN_TTL_MS));
    }

    #[test]
    fn etat_borne_meme_sous_un_flot_d_identites() {
        let c = PunchCoordinator::default();
        // Un attaquant multiplie les identités de session : au-delà de la
        // borne, les nouvelles entrées sont refusées (pas d'épuisement mémoire).
        let mut accepted = 0usize;
        for i in 0..(MAX_TRACKED_PEERS + 50) {
            let mut peer = [0u8; 32];
            peer[..8].copy_from_slice(&(i as u64).to_be_bytes());
            if c.accept_inbound(peer, 1_000) {
                accepted += 1;
            }
        }
        assert_eq!(accepted, MAX_TRACKED_PEERS);
        // Après expiration de la fenêtre, la place se libère (purge).
        assert!(c.accept_inbound([9u8; 32], 1_000 + INBOUND_MIN_INTERVAL_MS));
    }
}
