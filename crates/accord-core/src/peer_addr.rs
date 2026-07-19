//! Carnet d'adresses PERSISTANT des pairs : mémorise la dernière adresse
//! directe connue de chaque pair dans la table `meta`, pour reconnecter vite
//! au démarrage (avant même la résolution DHT). C'est un simple cache — une
//! entrée périmée ou fausse est sans gravité : le dial échoue et la DHT
//! reprend la main. On ne persiste QUE les adresses d'amis (voir l'appelant),
//! bornées dans le temps par un TTL relu à la lecture.

use std::net::SocketAddr;
use std::str::FromStr;

use crate::db::Db;
use crate::error::CoreError;

/// Préfixe des clés `meta` : `peeraddr.<hex(node_id)>`.
const PREFIX: &str = "peeraddr.";

/// Durée de validité par défaut d'une adresse mémorisée (14 jours). Au-delà,
/// l'adresse est jugée trop périmée pour valoir un dial et est ignorée à la
/// lecture (elle sera écrasée au prochain contact réel).
pub const DEFAULT_TTL_MS: u64 = 14 * 24 * 60 * 60 * 1000;

/// Clé `meta` de l'adresse d'un pair.
fn key(node_id: &[u8; 32]) -> String {
    use std::fmt::Write;
    let mut k = String::with_capacity(PREFIX.len() + 64);
    k.push_str(PREFIX);
    for b in node_id {
        let _ = write!(k, "{b:02x}");
    }
    k
}

/// Mémorise (ou rafraîchit) l'adresse directe d'un pair, horodatée à `now_ms`.
/// Valeur stockée : `"<ip:port>|<now_ms>"` en UTF-8.
pub fn remember(
    db: &Db,
    node_id: &[u8; 32],
    addr: SocketAddr,
    now_ms: u64,
) -> Result<(), CoreError> {
    let value = format!("{addr}|{now_ms}");
    db.set_meta(&key(node_id), value.as_bytes())
}

/// Relit l'adresse mémorisée d'un pair, ou `None` si absente, illisible ou
/// périmée (âge > `ttl_ms`). Une valeur corrompue est traitée comme absente.
pub fn recall(
    db: &Db,
    node_id: &[u8; 32],
    now_ms: u64,
    ttl_ms: u64,
) -> Result<Option<SocketAddr>, CoreError> {
    let Some(raw) = db.meta(&key(node_id))? else {
        return Ok(None);
    };
    let Ok(text) = std::str::from_utf8(&raw) else {
        return Ok(None);
    };
    let Some((addr_s, ts_s)) = text.split_once('|') else {
        return Ok(None);
    };
    let (Ok(addr), Ok(ts)) = (SocketAddr::from_str(addr_s), ts_s.parse::<u64>()) else {
        return Ok(None);
    };
    if now_ms.saturating_sub(ts) > ttl_ms {
        return Ok(None);
    }
    Ok(Some(addr))
}

/// Oublie l'adresse mémorisée d'un pair (idempotent).
pub fn forget(db: &Db, node_id: &[u8; 32]) -> Result<(), CoreError> {
    db.del_meta(&key(node_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Db {
        Db::open_in_memory(&[7u8; 32]).expect("db mémoire")
    }

    fn pk(seed: u8) -> [u8; 32] {
        [seed; 32]
    }

    #[test]
    fn round_trip_rend_l_adresse_memorisee() {
        let db = db();
        let addr: SocketAddr = "203.0.113.7:48016".parse().unwrap();
        remember(&db, &pk(1), addr, 1_000).unwrap();
        assert_eq!(
            recall(&db, &pk(1), 2_000, DEFAULT_TTL_MS).unwrap(),
            Some(addr)
        );
    }

    #[test]
    fn adresse_perimee_est_ignoree() {
        let db = db();
        let addr: SocketAddr = "203.0.113.7:48016".parse().unwrap();
        remember(&db, &pk(2), addr, 0).unwrap();
        let now = DEFAULT_TTL_MS + 1;
        assert_eq!(recall(&db, &pk(2), now, DEFAULT_TTL_MS).unwrap(), None);
    }

    #[test]
    fn pair_inconnu_rend_none() {
        let db = db();
        assert_eq!(recall(&db, &pk(9), 1, DEFAULT_TTL_MS).unwrap(), None);
    }

    #[test]
    fn rafraichissement_ecrase_l_ancienne_valeur() {
        let db = db();
        let a1: SocketAddr = "203.0.113.7:48016".parse().unwrap();
        let a2: SocketAddr = "198.51.100.4:48016".parse().unwrap();
        remember(&db, &pk(3), a1, 1_000).unwrap();
        remember(&db, &pk(3), a2, 2_000).unwrap();
        assert_eq!(
            recall(&db, &pk(3), 2_500, DEFAULT_TTL_MS).unwrap(),
            Some(a2)
        );
    }

    #[test]
    fn valeur_corrompue_est_traitee_comme_absente() {
        let db = db();
        db.set_meta(&key(&pk(4)), b"pas une adresse").unwrap();
        assert_eq!(recall(&db, &pk(4), 1, DEFAULT_TTL_MS).unwrap(), None);
    }

    #[test]
    fn forget_supprime_l_entree() {
        let db = db();
        let addr: SocketAddr = "203.0.113.7:48016".parse().unwrap();
        remember(&db, &pk(5), addr, 1_000).unwrap();
        forget(&db, &pk(5)).unwrap();
        assert_eq!(recall(&db, &pk(5), 1_500, DEFAULT_TTL_MS).unwrap(), None);
    }

    #[test]
    fn ipv6_round_trip() {
        let db = db();
        let addr: SocketAddr = "[2001:db8::1]:48016".parse().unwrap();
        remember(&db, &pk(6), addr, 1_000).unwrap();
        assert_eq!(
            recall(&db, &pk(6), 1_500, DEFAULT_TTL_MS).unwrap(),
            Some(addr)
        );
    }
}
