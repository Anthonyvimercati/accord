//! Mapping de port automatique (connexion sans configuration manuelle).
//!
//! Au démarrage, le nœud demande au routeur d'ouvrir son port UDP externe vers
//! lui-même, pour être joignable de l'extérieur sans redirection manuelle. Deux
//! protocoles sont essayés, dans l'ordre :
//!
//! 1. **UPnP-IGD** ([`igd_next`]) : auto-découverte de la passerelle par SSDP,
//!    lecture de l'adresse publique, ajout d'un mapping `externe → interne`.
//! 2. **NAT-PMP / PCP** ([`natpmp`]) en repli : passerelle par défaut
//!    auto-détectée, mapping et lecture de l'adresse publique.
//!
//! Au succès, on connaît l'**adresse externe** (IP publique : port) joignable,
//! exposée dans [`super::network::NetworkStatus`]. À l'échec (routeur absent,
//! délai dépassé, protocole non supporté) : dégradation propre, aucune panique,
//! le nœud continue sans mapping (repli sur l'amorçage manuel).
//!
//! Toutes les E/S réseau sont bornées par des délais courts et exécutées en
//! tâche de fond non bloquante : le mapping ne retarde jamais le démarrage. Le
//! mapping est renouvelé périodiquement (les baux expirent) et libéré au mieux
//! à l'arrêt.
//!
//! La logique parsable (méthode active, instantané d'état, construction de
//! l'adresse externe) est isolée en fonctions pures testables sans réseau ; le
//! mapping réel dépend d'un routeur et n'est vérifiable qu'en intégration.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::watch;

/// Délai maximal d'une tentative de mapping (recherche de passerelle + requête).
/// Court : au-delà, on considère le protocole indisponible et on dégrade.
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(4);
/// Délai maximal d'une libération de mapping à l'arrêt (best-effort).
const RELEASE_TIMEOUT: Duration = Duration::from_secs(2);
/// Bail demandé pour le mapping, en secondes (le routeur peut le raccourcir).
const MAPPING_LIFETIME_S: u32 = 3600;
/// Intervalle de renouvellement du mapping (bien avant l'expiration du bail).
const RENEW_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// Description du mapping affichée dans l'interface du routeur (UPnP).
const MAPPING_DESCRIPTION: &str = "Accord";

/// Méthode de mapping de port active, exposée telle quelle par l'API réseau
/// (`"upnp"`, `"natpmp"`, `"aucun"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PortMappingMethod {
    /// Mapping obtenu via UPnP-IGD.
    Upnp,
    /// Mapping obtenu via NAT-PMP/PCP.
    #[serde(rename = "natpmp")]
    NatPmp,
    /// Aucun mapping actif (échec ou désactivé).
    Aucun,
}

impl PortMappingMethod {
    /// Libellé stable de la méthode (identique à la sérialisation JSON).
    pub fn as_str(&self) -> &'static str {
        match self {
            PortMappingMethod::Upnp => "upnp",
            PortMappingMethod::NatPmp => "natpmp",
            PortMappingMethod::Aucun => "aucun",
        }
    }
}

/// Instantané de l'état du mapping (méthode + adresse externe joignable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NatSnapshot {
    /// Protocole ayant produit le mapping courant.
    pub method: PortMappingMethod,
    /// Adresse externe (IP publique : port) joignable, si un mapping est actif.
    pub external: Option<SocketAddr>,
}

impl Default for NatSnapshot {
    fn default() -> Self {
        Self {
            method: PortMappingMethod::Aucun,
            external: None,
        }
    }
}

/// État partagé du mapping : écrit par la tâche de fond, lu par le statut réseau.
#[derive(Default)]
pub struct NatShared {
    inner: Mutex<NatSnapshot>,
}

impl NatShared {
    /// Lecture de l'instantané courant (jamais bloquante longtemps).
    pub fn snapshot(&self) -> NatSnapshot {
        *self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Remplace l'instantané ; rend vrai s'il a changé (pour n'émettre un
    /// événement réseau que sur transition réelle).
    fn store(&self, snap: NatSnapshot) -> bool {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let changed = *guard != snap;
        *guard = snap;
        changed
    }
}

/// Construit l'adresse externe joignable à partir de l'IP publique observée par
/// le routeur et du port externe mappé (fonction pure, testable sans réseau).
pub fn external_addr(public_ip: IpAddr, external_port: u16) -> SocketAddr {
    SocketAddr::new(public_ip, external_port)
}

/// Rappel (synchrone, bref) déclenché quand l'état du mapping change, pour que
/// le runtime rafraîchisse l'événement `event.network`.
pub type OnChange = Arc<dyn Fn() + Send + Sync>;

/// Ressource à libérer à l'arrêt selon le protocole ayant produit le mapping.
enum Active {
    /// Rien à libérer.
    None,
    /// Mapping UPnP : passerelle + port externe à retirer.
    Upnp {
        gateway: igd_next::aio::Gateway<igd_next::aio::tokio::Tokio>,
        external_port: u16,
    },
    /// Mapping NAT-PMP : handle + port interne (libéré par un bail nul).
    NatPmp {
        client: natpmp::NatpmpAsync<tokio::net::UdpSocket>,
        internal_port: u16,
    },
}

/// Lance la tâche de mapping de port en arrière-plan (non bloquante). La tâche
/// tente le mapping, publie l'état dans `shared`, notifie `on_change` sur
/// transition, renouvelle périodiquement, puis libère au signal d'arrêt.
///
/// `local_ip` est l'adresse LAN vers laquelle rediriger (nécessaire à UPnP) ;
/// `None` désactive UPnP (NAT-PMP reste tenté, sa passerelle gère le retour).
pub fn spawn(
    shared: Arc<NatShared>,
    local_ip: Option<IpAddr>,
    port: u16,
    stop: watch::Receiver<bool>,
    on_change: OnChange,
) {
    tokio::spawn(run(shared, local_ip, port, stop, on_change));
}

/// Boucle de vie du mapping : (re)tentative, publication, renouvellement,
/// libération à l'arrêt. Chaque itération repart d'un mapping neuf pour rester
/// robuste aux redémarrages du routeur (epoch NAT-PMP, pertes de bail UPnP).
async fn run(
    shared: Arc<NatShared>,
    local_ip: Option<IpAddr>,
    port: u16,
    mut stop: watch::Receiver<bool>,
    on_change: OnChange,
) {
    if port == 0 {
        return;
    }
    loop {
        let (snapshot, active) = try_map(local_ip, port).await;
        if shared.store(snapshot) {
            on_change();
        }
        let renew = tokio::time::sleep(RENEW_INTERVAL);
        tokio::pin!(renew);
        tokio::select! {
            _ = &mut renew => {
                // Fin de période : libère le mapping courant avant d'en
                // reposer un neuf à l'itération suivante.
                release(active).await;
            }
            res = stop.changed() => {
                if res.is_err() || *stop.borrow() {
                    release(active).await;
                    if shared.store(NatSnapshot::default()) {
                        on_change();
                    }
                    return;
                }
            }
        }
    }
}

/// Tente un mapping : UPnP d'abord, NAT-PMP/PCP en repli. Chaque tentative est
/// bornée par [`ATTEMPT_TIMEOUT`] ; tout échec dégrade silencieusement.
async fn try_map(local_ip: Option<IpAddr>, port: u16) -> (NatSnapshot, Active) {
    if let Some(ip) = local_ip {
        match tokio::time::timeout(ATTEMPT_TIMEOUT, map_upnp(ip, port)).await {
            Ok(Ok((external, gateway))) => {
                tracing::info!("nat : port ouvert automatiquement (UPnP)");
                return (
                    NatSnapshot {
                        method: PortMappingMethod::Upnp,
                        external: Some(external),
                    },
                    Active::Upnp {
                        gateway,
                        external_port: external.port(),
                    },
                );
            }
            Ok(Err(e)) => tracing::debug!(erreur = %e, "nat : UPnP indisponible"),
            Err(_) => tracing::debug!("nat : UPnP hors délai"),
        }
    }
    match tokio::time::timeout(ATTEMPT_TIMEOUT, map_natpmp(port)).await {
        Ok(Ok((external, client))) => {
            tracing::info!("nat : port ouvert automatiquement (NAT-PMP)");
            (
                NatSnapshot {
                    method: PortMappingMethod::NatPmp,
                    external: Some(external),
                },
                Active::NatPmp {
                    client,
                    internal_port: port,
                },
            )
        }
        Ok(Err(e)) => {
            tracing::debug!(erreur = %e, "nat : NAT-PMP indisponible");
            (NatSnapshot::default(), Active::None)
        }
        Err(_) => {
            tracing::debug!("nat : NAT-PMP hors délai");
            (NatSnapshot::default(), Active::None)
        }
    }
}

/// Mappe `port` via UPnP-IGD et rend l'adresse externe + la passerelle (pour la
/// libération). Redirige le port externe vers `local_ip:port` (LAN).
async fn map_upnp(
    local_ip: IpAddr,
    port: u16,
) -> Result<
    (
        SocketAddr,
        igd_next::aio::Gateway<igd_next::aio::tokio::Tokio>,
    ),
    NatError,
> {
    let options = igd_next::SearchOptions {
        timeout: Some(ATTEMPT_TIMEOUT),
        single_search_timeout: Some(ATTEMPT_TIMEOUT),
        ..Default::default()
    };
    let gateway = igd_next::aio::tokio::search_gateway(options)
        .await
        .map_err(|e| NatError(e.to_string()))?;
    let public_ip = gateway
        .get_external_ip()
        .await
        .map_err(|e| NatError(e.to_string()))?;
    let local_addr = SocketAddr::new(local_ip, port);
    gateway
        .add_port(
            igd_next::PortMappingProtocol::UDP,
            port,
            local_addr,
            MAPPING_LIFETIME_S,
            MAPPING_DESCRIPTION,
        )
        .await
        .map_err(|e| NatError(e.to_string()))?;
    Ok((external_addr(public_ip, port), gateway))
}

/// Mappe `port` via NAT-PMP/PCP et rend l'adresse externe + le handle (pour la
/// libération). La passerelle par défaut est auto-détectée.
async fn map_natpmp(
    port: u16,
) -> Result<(SocketAddr, natpmp::NatpmpAsync<tokio::net::UdpSocket>), NatError> {
    let mut client = natpmp::new_tokio_natpmp()
        .await
        .map_err(|e| NatError(format!("{e:?}")))?;
    // Adresse publique observée par la passerelle.
    client
        .send_public_address_request()
        .await
        .map_err(|e| NatError(format!("{e:?}")))?;
    let public_ip = match client
        .read_response_or_retry()
        .await
        .map_err(|e| NatError(format!("{e:?}")))?
    {
        natpmp::Response::Gateway(g) => IpAddr::V4(*g.public_address()),
        _ => return Err(NatError("réponse d'adresse publique inattendue".into())),
    };
    // Mapping UDP `port → port` (le routeur peut choisir un autre port public).
    client
        .send_port_mapping_request(natpmp::Protocol::UDP, port, port, MAPPING_LIFETIME_S)
        .await
        .map_err(|e| NatError(format!("{e:?}")))?;
    let external_port = match client
        .read_response_or_retry()
        .await
        .map_err(|e| NatError(format!("{e:?}")))?
    {
        natpmp::Response::UDP(m) => m.public_port(),
        _ => return Err(NatError("réponse de mapping inattendue".into())),
    };
    Ok((external_addr(public_ip, external_port), client))
}

/// Libère un mapping actif (best-effort, borné). Un échec est sans gravité : le
/// bail expirera de lui-même côté routeur.
async fn release(active: Active) {
    match active {
        Active::None => {}
        Active::Upnp {
            gateway,
            external_port,
        } => {
            let fut = gateway.remove_port(igd_next::PortMappingProtocol::UDP, external_port);
            if tokio::time::timeout(RELEASE_TIMEOUT, fut).await.is_err() {
                tracing::debug!("nat : libération UPnP hors délai (le bail expirera)");
            }
        }
        Active::NatPmp {
            client,
            internal_port,
        } => {
            // Un bail nul retire le mapping (RFC 6886 §3.4).
            let fut = client.send_port_mapping_request(natpmp::Protocol::UDP, internal_port, 0, 0);
            let _ = tokio::time::timeout(RELEASE_TIMEOUT, fut).await;
        }
    }
}

/// Erreur interne d'une tentative de mapping (message aplati, sans donnée
/// sensible : servie uniquement au journal `debug`).
#[derive(Debug)]
struct NatError(String);

impl std::fmt::Display for NatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn methode_serialisee_en_libelle_stable() {
        assert_eq!(
            serde_json::to_value(PortMappingMethod::Upnp).unwrap(),
            serde_json::json!("upnp")
        );
        assert_eq!(
            serde_json::to_value(PortMappingMethod::NatPmp).unwrap(),
            serde_json::json!("natpmp")
        );
        assert_eq!(
            serde_json::to_value(PortMappingMethod::Aucun).unwrap(),
            serde_json::json!("aucun")
        );
        // Le libellé programmatique coïncide avec la sérialisation.
        for m in [
            PortMappingMethod::Upnp,
            PortMappingMethod::NatPmp,
            PortMappingMethod::Aucun,
        ] {
            assert_eq!(
                serde_json::to_value(m).unwrap(),
                serde_json::json!(m.as_str())
            );
        }
    }

    #[test]
    fn adresse_externe_ipv4_et_ipv6() {
        let v4 = external_addr("203.0.113.7".parse().unwrap(), 48016);
        assert_eq!(v4.to_string(), "203.0.113.7:48016");
        let v6 = external_addr("2001:db8::1".parse().unwrap(), 9000);
        assert_eq!(v6.to_string(), "[2001:db8::1]:9000");
    }

    #[test]
    fn instantane_par_defaut_sans_mapping() {
        let snap = NatSnapshot::default();
        assert_eq!(snap.method, PortMappingMethod::Aucun);
        assert!(snap.external.is_none());
    }

    #[test]
    fn etat_partage_ne_signale_que_les_transitions() {
        let shared = NatShared::default();
        assert_eq!(shared.snapshot(), NatSnapshot::default());

        let mapped = NatSnapshot {
            method: PortMappingMethod::Upnp,
            external: Some("203.0.113.7:48016".parse().unwrap()),
        };
        // Première écriture : transition (aucun → upnp).
        assert!(shared.store(mapped), "nouvelle valeur = changement");
        assert_eq!(shared.snapshot(), mapped);
        // Réécriture identique : pas de transition (évite le spam d'événements).
        assert!(
            !shared.store(mapped),
            "valeur inchangée = pas de changement"
        );
        // Retour à l'état vide (perte du mapping) : transition.
        assert!(shared.store(NatSnapshot::default()));
        assert_eq!(shared.snapshot().method, PortMappingMethod::Aucun);
    }
}
