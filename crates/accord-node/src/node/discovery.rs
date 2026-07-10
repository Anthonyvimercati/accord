//! Découverte de pairs Accord sur le réseau local via mDNS ([`mdns_sd`]).
//!
//! Le nœud **annonce** un service `_accord._udp.local.` portant sa clé publique
//! (propriété TXT) et son port P2P, et **parcourt** le même service pour trouver
//! les autres nœuds Accord du LAN. Chaque pair découvert est ajouté au carnet
//! d'adresses joignables (comme un pair d'amorçage), de sorte que deux amis sur
//! le même Wi-Fi se connectent sans aucune configuration.
//!
//! La découverte est désactivable et ne bloque jamais le démarrage : le démon
//! mDNS tourne sur son propre fil, et une tâche tokio consomme ses événements
//! jusqu'au signal d'arrêt (annonce retirée proprement à l'arrêt).
//!
//! La logique parsable (nom d'instance, propriétés TXT, extraction d'un pair
//! depuis une annonce résolue, extraction de clé depuis un nom complet) est
//! isolée en fonctions pures testables sans réseau ; la découverte réelle sur
//! le LAN n'est vérifiable qu'en intégration.

use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::sync::Mutex;

use tokio::sync::watch;

use crate::hex;

/// Type de service mDNS annoncé et parcouru pour Accord.
pub const SERVICE_TYPE: &str = "_accord._udp.local.";
/// Clé de la propriété TXT portant la clé publique (hex) du nœud.
pub const TXT_PUBKEY: &str = "pk";

/// Rappel (synchrone, bref) déclenché quand le nombre de pairs LAN change, pour
/// que le runtime rafraîchisse l'événement `event.network`.
pub type OnChange = Arc<dyn Fn() + Send + Sync>;

/// Puits des pairs découverts sur le LAN : le runtime les enregistre comme
/// joignables (carnet d'adresses + ensemencement DHT best-effort).
#[async_trait::async_trait]
pub trait LanSink: Send + Sync {
    /// Prend en compte un pair Accord découvert sur le réseau local.
    async fn on_lan_peer(&self, pubkey: [u8; 32], addr: SocketAddr);
}

/// État partagé du LAN : ensemble des clés publiques découvertes (dédupliqué),
/// dont le cardinal est exposé par le statut réseau (`lan_peers`).
#[derive(Default)]
pub struct LanShared {
    peers: Mutex<HashSet<[u8; 32]>>,
}

impl LanShared {
    /// Nombre de pairs distincts actuellement découverts sur le LAN.
    pub fn count(&self) -> usize {
        self.peers.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// Ajoute une clé ; rend vrai si elle était absente (transition).
    fn insert(&self, pubkey: [u8; 32]) -> bool {
        self.peers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(pubkey)
    }

    /// Retire une clé ; rend vrai si elle était présente (transition).
    fn remove(&self, pubkey: &[u8; 32]) -> bool {
        self.peers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(pubkey)
    }
}

/// Nom d'instance mDNS d'un nœud : hex de sa clé publique (stable et unique,
/// caractères `[0-9a-f]` sans échappement).
pub fn instance_name(pubkey: &[u8; 32]) -> String {
    hex::encode(pubkey)
}

/// Nom d'hôte DNS annoncé (unique par nœud) : `<hex>.local.`.
pub fn host_name(pubkey: &[u8; 32]) -> String {
    format!("{}.local.", hex::encode(pubkey))
}

/// Propriétés TXT de l'annonce : la clé publique complète en hexadécimal.
pub fn txt_properties(pubkey: &[u8; 32]) -> Vec<(String, String)> {
    vec![(TXT_PUBKEY.to_string(), hex::encode(pubkey))]
}

/// Extrait un pair d'une annonce résolue : clé publique (hex 64 caractères) et
/// première adresse routable. Ignore soi-même, les entrées illisibles et les
/// adresses non routables (loopback, non spécifiée). Fonction pure et testable.
pub fn parse_peer(
    pk_hex: Option<&str>,
    self_pk: &[u8; 32],
    addrs: &[IpAddr],
    port: u16,
) -> Option<([u8; 32], SocketAddr)> {
    let pubkey = hex::decode::<32>(pk_hex?)?;
    if &pubkey == self_pk || port == 0 {
        return None;
    }
    let ip = addrs
        .iter()
        .copied()
        .find(|ip| !ip.is_loopback() && !ip.is_unspecified())?;
    Some((pubkey, SocketAddr::new(ip, port)))
}

/// Extrait la clé publique d'un nom complet mDNS `<hex>._accord._udp.local.`
/// (utilisé au retrait d'un service, qui ne porte que le nom). Fonction pure.
pub fn pubkey_from_fullname(fullname: &str) -> Option<[u8; 32]> {
    let instance = fullname
        .strip_suffix(SERVICE_TYPE)
        .and_then(|s| s.strip_suffix('.'))?;
    hex::decode::<32>(instance)
}

/// Lance l'annonce et la découverte mDNS en arrière-plan (non bloquant). Rend
/// silencieusement la main si le démon mDNS ne peut pas démarrer (dégradation
/// propre : le nœud reste utilisable via l'amorçage manuel).
pub fn spawn(
    shared: Arc<LanShared>,
    self_pk: [u8; 32],
    local_ips: Vec<IpAddr>,
    port: u16,
    sink: Arc<dyn LanSink>,
    stop: watch::Receiver<bool>,
    on_change: OnChange,
) {
    if port == 0 {
        return;
    }
    let daemon = match mdns_sd::ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            tracing::debug!(erreur = %e, "mdns : démon indisponible, découverte désactivée");
            return;
        }
    };
    announce(&daemon, &self_pk, &local_ips, port);
    let browse = match daemon.browse(SERVICE_TYPE) {
        Ok(rx) => rx,
        Err(e) => {
            tracing::debug!(erreur = %e, "mdns : parcours impossible, découverte désactivée");
            let _ = daemon.shutdown();
            return;
        }
    };
    tokio::spawn(consume(
        daemon, browse, shared, self_pk, sink, stop, on_change,
    ));
}

/// Enregistre l'annonce du service local (best-effort : un échec journalise
/// sans interrompre la découverte des autres).
fn announce(daemon: &mdns_sd::ServiceDaemon, self_pk: &[u8; 32], local_ips: &[IpAddr], port: u16) {
    let name = instance_name(self_pk);
    let host = host_name(self_pk);
    let props = txt_properties(self_pk);
    let info =
        match mdns_sd::ServiceInfo::new(SERVICE_TYPE, &name, &host, local_ips, port, &props[..]) {
            Ok(info) => info.enable_addr_auto(),
            Err(e) => {
                tracing::debug!(erreur = %e, "mdns : annonce non construite");
                return;
            }
        };
    if let Err(e) = daemon.register(info) {
        tracing::debug!(erreur = %e, "mdns : annonce non enregistrée");
    }
}

/// Consomme les événements mDNS jusqu'à l'arrêt : enregistre/retire les pairs
/// et notifie les transitions, puis retire l'annonce et arrête le démon.
async fn consume(
    daemon: mdns_sd::ServiceDaemon,
    browse: mdns_sd::Receiver<mdns_sd::ServiceEvent>,
    shared: Arc<LanShared>,
    self_pk: [u8; 32],
    sink: Arc<dyn LanSink>,
    mut stop: watch::Receiver<bool>,
    on_change: OnChange,
) {
    let fullname = format!("{}.{SERVICE_TYPE}", instance_name(&self_pk));
    loop {
        tokio::select! {
            event = browse.recv_async() => {
                match event {
                    Ok(mdns_sd::ServiceEvent::ServiceResolved(resolved)) => {
                        let addrs: Vec<IpAddr> =
                            resolved.get_addresses().iter().map(|s| s.to_ip_addr()).collect();
                        let pk_hex = resolved.get_property_val_str(TXT_PUBKEY);
                        if let Some((pubkey, addr)) =
                            parse_peer(pk_hex, &self_pk, &addrs, resolved.get_port())
                        {
                            if shared.insert(pubkey) {
                                on_change();
                            }
                            sink.on_lan_peer(pubkey, addr).await;
                        }
                    }
                    Ok(mdns_sd::ServiceEvent::ServiceRemoved(_, name)) => {
                        if let Some(pubkey) = pubkey_from_fullname(&name) {
                            if shared.remove(&pubkey) {
                                on_change();
                            }
                        }
                    }
                    Ok(_) => {}
                    // Canal clos : le démon s'est arrêté, rien de plus à faire.
                    Err(_) => return,
                }
            }
            res = stop.changed() => {
                if res.is_err() || *stop.borrow() {
                    let _ = daemon.unregister(&fullname);
                    let _ = daemon.shutdown();
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    #[test]
    fn nom_instance_et_hote_reversibles() {
        let key = pk(0xAB);
        let name = instance_name(&key);
        assert_eq!(name.len(), 64);
        assert_eq!(host_name(&key), format!("{name}.local."));
        // Le nom complet se re-décode en clé publique.
        let fullname = format!("{name}.{SERVICE_TYPE}");
        assert_eq!(pubkey_from_fullname(&fullname), Some(key));
    }

    #[test]
    fn txt_porte_la_cle_publique() {
        let key = pk(0x01);
        let props = txt_properties(&key);
        assert_eq!(props.len(), 1);
        assert_eq!(props[0].0, TXT_PUBKEY);
        assert_eq!(props[0].1, hex::encode(&key));
    }

    #[test]
    fn parse_peer_valide_et_ignore_soi_meme() {
        let me = pk(0x01);
        let other = pk(0x02);
        let other_hex = hex::encode(&other);
        let addrs = ["192.168.1.5".parse().unwrap()];

        // Pair valide : clé décodée + adresse routable.
        assert_eq!(
            parse_peer(Some(&other_hex), &me, &addrs, 48016),
            Some((other, "192.168.1.5:48016".parse().unwrap()))
        );
        // Soi-même : ignoré (évite de se compter comme pair).
        let me_hex = hex::encode(&me);
        assert!(parse_peer(Some(&me_hex), &me, &addrs, 48016).is_none());
        // Port nul : refusé.
        assert!(parse_peer(Some(&other_hex), &me, &addrs, 0).is_none());
        // Clé absente ou illisible : refusée.
        assert!(parse_peer(None, &me, &addrs, 48016).is_none());
        assert!(parse_peer(Some("pas-hex"), &me, &addrs, 48016).is_none());
    }

    #[test]
    fn parse_peer_ecarte_les_adresses_non_routables() {
        let me = pk(0x01);
        let other_hex = hex::encode(&pk(0x02));
        // Loopback et non spécifiée : écartées ; l'adresse LAN est retenue.
        let addrs = [
            "127.0.0.1".parse().unwrap(),
            "0.0.0.0".parse().unwrap(),
            "10.0.0.4".parse().unwrap(),
        ];
        assert_eq!(
            parse_peer(Some(&other_hex), &me, &addrs, 48016).map(|(_, a)| a),
            Some("10.0.0.4:48016".parse().unwrap())
        );
        // Aucune adresse routable : aucun pair.
        let only_loopback = ["127.0.0.1".parse().unwrap()];
        assert!(parse_peer(Some(&other_hex), &me, &only_loopback, 48016).is_none());
    }

    #[test]
    fn pubkey_from_fullname_rejette_les_noms_malformes() {
        assert!(pubkey_from_fullname("bonjour").is_none());
        // Bon suffixe mais instance non hexadécimale.
        assert!(pubkey_from_fullname(&format!("zzz.{SERVICE_TYPE}")).is_none());
        // Suffixe absent.
        let hexid = hex::encode(&pk(0x07));
        assert!(pubkey_from_fullname(&hexid).is_none());
    }
}
