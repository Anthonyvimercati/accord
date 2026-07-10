//! Profil local de l'utilisateur (pseudo, bio, avatar, bannière) et
//! réconciliation des profils annoncés par les amis (D-027, D-032).
//!
//! Le profil local vit dans la table `meta` de la base SQLCipher (clés
//! [`META_NAME_KEY`], [`META_BIO_KEY`], [`META_AVATAR_KEY`],
//! [`META_BANNER_KEY`], pas de migration de schéma). Côté réception, le profil
//! porté par un message `Profile` n'est pris en compte que si l'émetteur est un
//! **ami** (anti-abus) et que les champs sont valides ; le pseudo remplace
//! alors le nom d'affichage du contact rendu par `friends.list`, la bio et les
//! hashes d'avatar et de bannière sont persistés dans `meta` sous des clés
//! dérivées du node_id du contact.

use accord_crypto::node_id_of;

use crate::db::{ContactState, Db};
use crate::error::CoreError;

/// Clé de métadonnée du pseudo local dans la table `meta`.
const META_NAME_KEY: &str = "profile.name";
/// Clé de métadonnée de la bio locale dans la table `meta`.
const META_BIO_KEY: &str = "profile.bio";
/// Clé de métadonnée du hash d'avatar local dans la table `meta`.
const META_AVATAR_KEY: &str = "profile.avatar";
/// Clé de métadonnée du hash de bannière local dans la table `meta`.
const META_BANNER_KEY: &str = "profile.banner";
/// Préfixe des métadonnées de profil des contacts (`profile.peer.<hex>.bio`,
/// `profile.peer.<hex>.avatar` et `profile.peer.<hex>.banner`).
const PEER_META_PREFIX: &str = "profile.peer.";

/// Longueur minimale d'un pseudo (caractères, après trim).
pub const NAME_MIN_CHARS: usize = 2;
/// Longueur maximale d'un pseudo (caractères, après trim).
pub const NAME_MAX_CHARS: usize = 32;
/// Longueur maximale d'une bio (caractères, après trim).
pub const BIO_MAX_CHARS: usize = 2048;
/// Borne filaire d'une bio (octets UTF-8, alignée sur la limite de décodage
/// du message `Profile` côté protocole).
pub const BIO_MAX_BYTES: usize = 2048;

/// Profil d'un contact appliqué à l'ingestion d'un message `Profile`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerProfile {
    /// Pseudo canonique (trimé) appliqué au contact.
    pub name: String,
    /// Bio persistée (`None` si vide : effacée).
    pub bio: Option<String>,
    /// Hash d'avatar persisté (`None` si retiré).
    pub avatar: Option<[u8; 32]>,
    /// Hash de bannière persisté (`None` si retiré).
    pub banner: Option<[u8; 32]>,
}

/// Valide un pseudo : 2 à 32 caractères après trim, sans caractère de
/// contrôle. Rend la forme canonique (trimée).
pub fn validate_name(name: &str) -> Result<&str, CoreError> {
    let trimmed = name.trim();
    let chars = trimmed.chars().count();
    if !(NAME_MIN_CHARS..=NAME_MAX_CHARS).contains(&chars) {
        return Err(CoreError::Invalid(
            "pseudo : 2 à 32 caractères requis (espaces de bord ignorés)",
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(CoreError::Invalid(
            "pseudo : caractères de contrôle interdits",
        ));
    }
    Ok(trimmed)
}

/// Valide une bio : au plus 2048 caractères après trim (et 2048 octets UTF-8,
/// borne filaire), sans caractère de contrôle autre que les sauts de ligne et
/// tabulations. Une bio vide est valide et signifie « effacer ». Rend la
/// forme canonique (trimée).
pub fn validate_bio(bio: &str) -> Result<&str, CoreError> {
    let trimmed = bio.trim();
    if trimmed.chars().count() > BIO_MAX_CHARS {
        return Err(CoreError::Invalid("bio : 2048 caractères maximum"));
    }
    if trimmed.len() > BIO_MAX_BYTES {
        return Err(CoreError::Invalid(
            "bio : 2048 octets UTF-8 maximum une fois encodée",
        ));
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(CoreError::Invalid("bio : caractères de contrôle interdits"));
    }
    Ok(trimmed)
}

/// Enregistre le pseudo local après validation ; rend la forme canonique
/// stockée (trimée).
pub fn set_local_name(db: &Db, name: &str) -> Result<String, CoreError> {
    let canon = validate_name(name)?;
    db.set_meta(META_NAME_KEY, canon.as_bytes())?;
    Ok(canon.to_string())
}

/// Pseudo local, s'il a déjà été défini.
pub fn local_name(db: &Db) -> Result<Option<String>, CoreError> {
    match db.meta(META_NAME_KEY)? {
        None => Ok(None),
        Some(bytes) => {
            Ok(Some(String::from_utf8(bytes).map_err(|_| {
                CoreError::Invalid("pseudo local corrompu")
            })?))
        }
    }
}

/// Enregistre la bio locale après validation ; une bio vide (après trim)
/// l'efface. Rend la forme canonique stockée (`None` si effacée).
pub fn set_local_bio(db: &Db, bio: &str) -> Result<Option<String>, CoreError> {
    let canon = validate_bio(bio)?;
    db.set_meta(META_BIO_KEY, canon.as_bytes())?;
    if canon.is_empty() {
        Ok(None)
    } else {
        Ok(Some(canon.to_string()))
    }
}

/// Bio locale, si elle est définie et non vide.
pub fn local_bio(db: &Db) -> Result<Option<String>, CoreError> {
    read_bio(db, META_BIO_KEY)
}

/// Enregistre (ou efface, avec `None`) le hash d'avatar local.
pub fn set_local_avatar(db: &Db, avatar: Option<&[u8; 32]>) -> Result<(), CoreError> {
    db.set_meta(META_AVATAR_KEY, avatar.map_or(&[][..], |h| &h[..]))
}

/// Hash d'avatar local, s'il est défini.
pub fn local_avatar(db: &Db) -> Result<Option<[u8; 32]>, CoreError> {
    read_avatar(db, META_AVATAR_KEY)
}

/// Enregistre (ou efface, avec `None`) le hash de bannière local.
pub fn set_local_banner(db: &Db, banner: Option<&[u8; 32]>) -> Result<(), CoreError> {
    db.set_meta(META_BANNER_KEY, banner.map_or(&[][..], |h| &h[..]))
}

/// Hash de bannière local, s'il est défini.
pub fn local_banner(db: &Db) -> Result<Option<[u8; 32]>, CoreError> {
    read_banner(db, META_BANNER_KEY)
}

/// Bio persistée d'un contact (annoncée par lui), si non vide.
pub fn peer_bio(db: &Db, node_id: &[u8; 32]) -> Result<Option<String>, CoreError> {
    read_bio(db, &peer_meta_key(node_id, "bio"))
}

/// Hash d'avatar persisté d'un contact (annoncé par lui), s'il existe.
pub fn peer_avatar(db: &Db, node_id: &[u8; 32]) -> Result<Option<[u8; 32]>, CoreError> {
    read_avatar(db, &peer_meta_key(node_id, "avatar"))
}

/// Hash de bannière persisté d'un contact (annoncé par lui), s'il existe.
pub fn peer_banner(db: &Db, node_id: &[u8; 32]) -> Result<Option<[u8; 32]>, CoreError> {
    read_banner(db, &peer_meta_key(node_id, "banner"))
}

/// Ingère le profil annoncé par un pair (message `Profile`, authentifié par
/// la session chiffrée : `peer_pubkey` est la clé de session, pas un champ).
///
/// Anti-abus : seuls les **amis** sont pris en compte ; toute autre relation
/// (inconnu, demande en attente, bloqué) est ignorée silencieusement
/// (`Ok(None)`). Un pseudo ou une bio invalide venant d'un ami rejette le
/// message en erreur, sans effet. Rend le profil canonique appliqué au
/// contact : pseudo dans `contacts.display_name`, bio et hashes d'avatar et de
/// bannière dans `meta` (une bio vide, un avatar ou une bannière absents
/// **effacent** la valeur connue).
pub fn ingest_peer_profile(
    db: &Db,
    peer_pubkey: &[u8; 32],
    name: &str,
    bio: &str,
    avatar: Option<[u8; 32]>,
    banner: Option<[u8; 32]>,
    now_ms: u64,
) -> Result<Option<PeerProfile>, CoreError> {
    let node_id = node_id_of(peer_pubkey).0;
    match db.contact(&node_id)?.map(|c| c.state) {
        Some(ContactState::Friend) => {
            // Tout valider avant la première écriture (tout ou rien).
            let canon_name = validate_name(name)?;
            let canon_bio = validate_bio(bio)?;
            db.set_contact_name(&node_id, canon_name, now_ms)?;
            db.set_meta(&peer_meta_key(&node_id, "bio"), canon_bio.as_bytes())?;
            db.set_meta(
                &peer_meta_key(&node_id, "avatar"),
                avatar.as_ref().map_or(&[][..], |h| &h[..]),
            )?;
            db.set_meta(
                &peer_meta_key(&node_id, "banner"),
                banner.as_ref().map_or(&[][..], |h| &h[..]),
            )?;
            Ok(Some(PeerProfile {
                name: canon_name.to_string(),
                bio: (!canon_bio.is_empty()).then(|| canon_bio.to_string()),
                avatar,
                banner,
            }))
        }
        _ => Ok(None),
    }
}

/// Clé `meta` d'un champ de profil d'un contact : `profile.peer.<hex>.<champ>`.
fn peer_meta_key(node_id: &[u8; 32], field: &str) -> String {
    use std::fmt::Write;
    let mut key = String::with_capacity(PEER_META_PREFIX.len() + 64 + 1 + field.len());
    key.push_str(PEER_META_PREFIX);
    for b in node_id {
        // L'écriture dans une String ne peut pas échouer.
        let _ = write!(key, "{b:02x}");
    }
    key.push('.');
    key.push_str(field);
    key
}

/// Lit une bio stockée sous `key` (`None` si absente ou vide).
fn read_bio(db: &Db, key: &str) -> Result<Option<String>, CoreError> {
    match db.meta(key)? {
        None => Ok(None),
        Some(bytes) if bytes.is_empty() => Ok(None),
        Some(bytes) => {
            Ok(Some(String::from_utf8(bytes).map_err(|_| {
                CoreError::Invalid("bio stockée corrompue")
            })?))
        }
    }
}

/// Lit un hash d'avatar stocké sous `key` (`None` si absent ou effacé).
fn read_avatar(db: &Db, key: &str) -> Result<Option<[u8; 32]>, CoreError> {
    match db.meta(key)? {
        None => Ok(None),
        Some(bytes) if bytes.is_empty() => Ok(None),
        Some(bytes) => {
            Ok(Some(bytes.try_into().map_err(|_| {
                CoreError::Invalid("hash d'avatar stocké corrompu")
            })?))
        }
    }
}

/// Lit un hash de bannière stocké sous `key` (`None` si absent ou effacé).
fn read_banner(db: &Db, key: &str) -> Result<Option<[u8; 32]>, CoreError> {
    match db.meta(key)? {
        None => Ok(None),
        Some(bytes) if bytes.is_empty() => Ok(None),
        Some(bytes) => {
            Ok(Some(bytes.try_into().map_err(|_| {
                CoreError::Invalid("hash de bannière stocké corrompu")
            })?))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Contact;

    fn db() -> Db {
        Db::open_in_memory(&[3u8; 32]).unwrap()
    }

    fn friend(db: &Db, pubkey: &[u8; 32], state: ContactState) {
        db.upsert_contact(&Contact {
            node_id: node_id_of(pubkey).0,
            pubkey: *pubkey,
            display_name: "étiquette-locale".into(),
            state,
            added_ms: 1,
            last_seen_ms: 1,
        })
        .unwrap();
    }

    #[test]
    fn validation_enforces_bounds_and_trims() {
        assert_eq!(validate_name("  Anna  ").unwrap(), "Anna");
        assert_eq!(validate_name("ab").unwrap(), "ab");
        assert_eq!(validate_name(&"x".repeat(32)).unwrap(), "x".repeat(32));
        // Bornes en caractères, pas en octets : 32 caractères multi-octets.
        assert_eq!(validate_name(&"é".repeat(32)).unwrap(), "é".repeat(32));
        assert!(validate_name("a").is_err());
        assert!(validate_name("   a   ").is_err());
        assert!(validate_name("").is_err());
        assert!(validate_name(&"x".repeat(33)).is_err());
        assert!(validate_name("an\u{0007}na").is_err());
    }

    #[test]
    fn bio_validation_bounds_and_control_chars() {
        assert_eq!(validate_bio("").unwrap(), "");
        assert_eq!(validate_bio("   ").unwrap(), "");
        assert_eq!(validate_bio("  salut  ").unwrap(), "salut");
        // Sauts de ligne et tabulations autorisés, autres contrôles refusés.
        assert_eq!(
            validate_bio("ligne 1\nligne 2\tfin").unwrap(),
            "ligne 1\nligne 2\tfin"
        );
        assert!(validate_bio("bip\u{0007}").is_err());
        // Borne en caractères.
        assert!(validate_bio(&"x".repeat(2048)).is_ok());
        assert!(validate_bio(&"x".repeat(2049)).is_err());
        // Borne filaire en octets : 1500 caractères « é » = 3000 octets.
        assert!(validate_bio(&"é".repeat(1500)).is_err());
        assert!(validate_bio(&"é".repeat(1024)).is_ok());
    }

    #[test]
    fn local_name_roundtrips_and_defaults_to_none() {
        let db = db();
        assert_eq!(local_name(&db).unwrap(), None);
        assert_eq!(set_local_name(&db, "  Anna  ").unwrap(), "Anna");
        assert_eq!(local_name(&db).unwrap(), Some("Anna".into()));
        // Remplacement.
        set_local_name(&db, "Bertrand").unwrap();
        assert_eq!(local_name(&db).unwrap(), Some("Bertrand".into()));
        // Invalide : refusé, l'ancien pseudo reste.
        assert!(set_local_name(&db, "x").is_err());
        assert_eq!(local_name(&db).unwrap(), Some("Bertrand".into()));
    }

    #[test]
    fn local_bio_roundtrips_and_empty_clears() {
        let db = db();
        assert_eq!(local_bio(&db).unwrap(), None);
        assert_eq!(
            set_local_bio(&db, "  ma bio  ").unwrap(),
            Some("ma bio".into())
        );
        assert_eq!(local_bio(&db).unwrap(), Some("ma bio".into()));
        // Vide = effacer.
        assert_eq!(set_local_bio(&db, "").unwrap(), None);
        assert_eq!(local_bio(&db).unwrap(), None);
        // Invalide : refusée, sans effet.
        set_local_bio(&db, "durable").unwrap();
        assert!(set_local_bio(&db, &"x".repeat(2049)).is_err());
        assert_eq!(local_bio(&db).unwrap(), Some("durable".into()));
    }

    #[test]
    fn local_avatar_roundtrips_and_none_clears() {
        let db = db();
        assert_eq!(local_avatar(&db).unwrap(), None);
        set_local_avatar(&db, Some(&[9u8; 32])).unwrap();
        assert_eq!(local_avatar(&db).unwrap(), Some([9u8; 32]));
        set_local_avatar(&db, None).unwrap();
        assert_eq!(local_avatar(&db).unwrap(), None);
    }

    #[test]
    fn local_banner_roundtrips_and_none_clears() {
        let db = db();
        assert_eq!(local_banner(&db).unwrap(), None);
        set_local_banner(&db, Some(&[7u8; 32])).unwrap();
        assert_eq!(local_banner(&db).unwrap(), Some([7u8; 32]));
        set_local_banner(&db, None).unwrap();
        assert_eq!(local_banner(&db).unwrap(), None);
        // Bannière et avatar sont stockés sous des clés distinctes.
        set_local_avatar(&db, Some(&[9u8; 32])).unwrap();
        set_local_banner(&db, Some(&[7u8; 32])).unwrap();
        assert_eq!(local_avatar(&db).unwrap(), Some([9u8; 32]));
        assert_eq!(local_banner(&db).unwrap(), Some([7u8; 32]));
    }

    #[test]
    fn peer_profile_updates_friend_contact_only() {
        let db = db();
        let peer = [7u8; 32];
        friend(&db, &peer, ContactState::Friend);
        let applied = ingest_peer_profile(
            &db,
            &peer,
            " Anna ",
            " sa bio ",
            Some([4u8; 32]),
            Some([6u8; 32]),
            9,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            applied,
            PeerProfile {
                name: "Anna".into(),
                bio: Some("sa bio".into()),
                avatar: Some([4u8; 32]),
                banner: Some([6u8; 32]),
            }
        );
        let node_id = node_id_of(&peer).0;
        let contact = db.contact(&node_id).unwrap().unwrap();
        assert_eq!(contact.display_name, "Anna");
        assert_eq!(contact.last_seen_ms, 9);
        assert_eq!(peer_bio(&db, &node_id).unwrap(), Some("sa bio".into()));
        assert_eq!(peer_avatar(&db, &node_id).unwrap(), Some([4u8; 32]));
        assert_eq!(peer_banner(&db, &node_id).unwrap(), Some([6u8; 32]));
    }

    #[test]
    fn peer_profile_empty_fields_clear_previous_values() {
        let db = db();
        let peer = [7u8; 32];
        friend(&db, &peer, ContactState::Friend);
        ingest_peer_profile(
            &db,
            &peer,
            "Anna",
            "bio",
            Some([4u8; 32]),
            Some([6u8; 32]),
            1,
        )
        .unwrap();
        // Nouvelle annonce sans bio, avatar ni bannière : les valeurs connues
        // s'effacent.
        let applied = ingest_peer_profile(&db, &peer, "Anna", "", None, None, 2)
            .unwrap()
            .unwrap();
        assert_eq!(applied.bio, None);
        assert_eq!(applied.avatar, None);
        assert_eq!(applied.banner, None);
        let node_id = node_id_of(&peer).0;
        assert_eq!(peer_bio(&db, &node_id).unwrap(), None);
        assert_eq!(peer_avatar(&db, &node_id).unwrap(), None);
        assert_eq!(peer_banner(&db, &node_id).unwrap(), None);
    }

    #[test]
    fn peer_profile_from_non_friend_is_silently_ignored() {
        let db = db();
        let unknown = [8u8; 32];
        assert_eq!(
            ingest_peer_profile(&db, &unknown, "Anna", "", None, None, 1).unwrap(),
            None
        );
        for state in [
            ContactState::PendingIn,
            ContactState::PendingOut,
            ContactState::Blocked,
        ] {
            let peer = [state as u8 + 10; 32];
            friend(&db, &peer, state);
            assert_eq!(
                ingest_peer_profile(
                    &db,
                    &peer,
                    "Anna",
                    "bio",
                    Some([1u8; 32]),
                    Some([2u8; 32]),
                    1
                )
                .unwrap(),
                None
            );
            let node_id = node_id_of(&peer).0;
            let contact = db.contact(&node_id).unwrap().unwrap();
            assert_eq!(contact.display_name, "étiquette-locale");
            assert_eq!(peer_bio(&db, &node_id).unwrap(), None);
            assert_eq!(peer_avatar(&db, &node_id).unwrap(), None);
            assert_eq!(peer_banner(&db, &node_id).unwrap(), None);
        }
    }

    #[test]
    fn invalid_peer_profile_from_friend_is_rejected_without_effect() {
        let db = db();
        let peer = [7u8; 32];
        friend(&db, &peer, ContactState::Friend);
        // Pseudo invalide.
        assert!(ingest_peer_profile(&db, &peer, &"x".repeat(33), "", None, None, 1).is_err());
        // Bio invalide : rien n'est écrit, pas même le pseudo pourtant valide.
        assert!(ingest_peer_profile(&db, &peer, "Anna", &"x".repeat(2049), None, None, 1).is_err());
        let node_id = node_id_of(&peer).0;
        let contact = db.contact(&node_id).unwrap().unwrap();
        assert_eq!(contact.display_name, "étiquette-locale");
        assert_eq!(peer_bio(&db, &node_id).unwrap(), None);
    }

    #[test]
    fn peer_meta_keys_are_distinct_per_contact_and_field() {
        let a = peer_meta_key(&[1u8; 32], "bio");
        let b = peer_meta_key(&[1u8; 32], "avatar");
        let c = peer_meta_key(&[2u8; 32], "bio");
        let d = peer_meta_key(&[1u8; 32], "banner");
        assert!(a.starts_with("profile.peer.01"));
        assert!(a.ends_with(".bio"));
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_ne!(b, d);
        assert!(d.ends_with(".banner"));
    }
}
