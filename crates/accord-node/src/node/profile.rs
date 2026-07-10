//! Profil public local (pseudo, bio, avatar, bannière — D-027, D-032) et
//! annonce aux amis (bloc `impl Node` des domaines `profile.*` et
//! `identity.self`).
//!
//! Les octets de l'avatar et de la bannière transitent par le sous-système
//! fichiers : le profil ne porte que le **hash** (racine Merkle) ; la
//! publication passe par [`Node::files_publish_bytes`] et la récupération côté
//! pair par [`Node::files_fetch`].

use accord_core::profile;
use accord_crypto::{node_id_of, FriendCode};
use accord_proto::core_msg::CoreMsg;

use crate::error::NodeError;
use crate::hex;
use crate::outbound::Outbound;

use super::Node;

/// Profil public d'un pair annoncé (bio, hash d'avatar, hash de bannière),
/// tel que persisté localement à partir de ses messages `Profile`.
pub(crate) type PeerPublicProfile = (Option<String>, Option<[u8; 32]>, Option<[u8; 32]>);

impl Node {
    /// Profil public local : node_id, clé, code ami, pseudo, bio, avatar,
    /// bannière.
    pub fn self_profile(&self) -> Result<SelfProfile, NodeError> {
        let pubkey = self.identity.public_key();
        Ok(SelfProfile {
            node_id: hex::encode(&node_id_of(&pubkey).0),
            pubkey: hex::encode(&pubkey),
            friend_code: FriendCode::of_pubkey(&pubkey).display(),
            name: self.profile_name()?,
            bio: self.profile_bio()?,
            avatar: self.profile_avatar()?.map(|h| hex::encode(&h)),
            banner: self.profile_banner()?.map(|h| hex::encode(&h)),
        })
    }

    /// Pseudo local, s'il a été défini (`profile.get`).
    pub fn profile_name(&self) -> Result<Option<String>, NodeError> {
        self.with_db(|db| Ok(profile::local_name(db)?))
    }

    /// Bio locale, si elle est définie et non vide (`profile.get`).
    pub fn profile_bio(&self) -> Result<Option<String>, NodeError> {
        self.with_db(|db| Ok(profile::local_bio(db)?))
    }

    /// Hash d'avatar local (racine Merkle), s'il est défini (`profile.get`).
    pub fn profile_avatar(&self) -> Result<Option<[u8; 32]>, NodeError> {
        self.with_db(|db| Ok(profile::local_avatar(db)?))
    }

    /// Hash de bannière local (racine Merkle), s'il est défini (`profile.get`).
    pub fn profile_banner(&self) -> Result<Option<[u8; 32]>, NodeError> {
        self.with_db(|db| Ok(profile::local_banner(db)?))
    }

    /// Définit le pseudo local (2 à 32 caractères après trim) puis l'annonce
    /// à tous les amis confirmés.
    pub fn profile_set_name(&self, name: &str) -> Result<(), NodeError> {
        self.profile_update(Some(name), None)
    }

    /// Met à jour le pseudo et/ou la bio (au moins un des deux, `profile.set`)
    /// puis annonce le profil complet à tous les amis confirmés. Une bio vide
    /// (après trim) est effacée. Tout ou rien : les deux champs sont validés
    /// avant la première écriture.
    pub fn profile_update(&self, name: Option<&str>, bio: Option<&str>) -> Result<(), NodeError> {
        if name.is_none() && bio.is_none() {
            return Err(NodeError::Invalid("profil : name ou bio requis"));
        }
        self.with_db(|db| {
            if let Some(n) = name {
                profile::validate_name(n)?;
            }
            if let Some(b) = bio {
                profile::validate_bio(b)?;
            }
            if let Some(n) = name {
                profile::set_local_name(db, n)?;
            }
            if let Some(b) = bio {
                profile::set_local_bio(db, b)?;
            }
            Ok(())
        })?;
        self.announce_profile_to_friends()
    }

    /// Définit (ou retire, avec `None`) l'avatar local (`profile.set_avatar`) :
    /// publie les octets dans le magasin de fichiers, persiste le hash, puis
    /// annonce le profil complet aux amis. Rend le hash stocké.
    pub fn profile_set_avatar(
        &self,
        blob: Option<(&str, Vec<u8>)>,
    ) -> Result<Option<[u8; 32]>, NodeError> {
        let hash = match blob {
            Some((mime, octets)) => Some(
                self.files_publish_bytes("avatar", mime, octets)?
                    .merkle_root,
            ),
            None => None,
        };
        self.with_db(|db| Ok(profile::set_local_avatar(db, hash.as_ref())?))?;
        self.announce_profile_to_friends()?;
        Ok(hash)
    }

    /// Définit (ou retire, avec `None`) la bannière locale
    /// (`profile.set_banner`) : publie les octets dans le magasin de fichiers,
    /// persiste le hash, puis annonce le profil complet aux amis. Rend le hash
    /// stocké.
    pub fn profile_set_banner(
        &self,
        blob: Option<(&str, Vec<u8>)>,
    ) -> Result<Option<[u8; 32]>, NodeError> {
        let hash = match blob {
            Some((mime, octets)) => Some(
                self.files_publish_bytes("banner", mime, octets)?
                    .merkle_root,
            ),
            None => None,
        };
        self.with_db(|db| Ok(profile::set_local_banner(db, hash.as_ref())?))?;
        self.announce_profile_to_friends()?;
        Ok(hash)
    }

    /// Profil public connu d'un pair (bio, hash d'avatar et hash de bannière),
    /// tel que reçu par ses annonces `Profile` — pour enrichir la liste d'amis.
    pub(crate) fn peer_public_profile(
        &self,
        node_id: &[u8; 32],
    ) -> Result<PeerPublicProfile, NodeError> {
        self.with_db(|db| {
            Ok((
                profile::peer_bio(db, node_id)?,
                profile::peer_avatar(db, node_id)?,
                profile::peer_banner(db, node_id)?,
            ))
        })
    }

    /// Notre annonce de profil (pseudo + bio + hash d'avatar + hash de
    /// bannière), si un pseudo est défini — le message `Profile` exige un
    /// pseudo valide : sans lui, rien n'est annoncé. Accessible à la boucle de
    /// maintenance pour la ré-annonce périodique.
    pub(crate) fn own_profile_msg(&self) -> Result<Option<CoreMsg>, NodeError> {
        let (name, bio, avatar, banner) = self.with_db(|db| {
            Ok((
                profile::local_name(db)?,
                profile::local_bio(db)?,
                profile::local_avatar(db)?,
                profile::local_banner(db)?,
            ))
        })?;
        Ok(name.map(|display_name| CoreMsg::Profile {
            display_name,
            bio: bio.unwrap_or_default(),
            avatar,
            banner,
        }))
    }

    /// Annonce notre profil (s'il existe) à un pair, à l'établissement d'une
    /// amitié (D-027 : chaque extrémité annonce le sien).
    pub(super) fn announce_profile_to(&self, peer_pubkey: &[u8; 32]) -> Result<(), NodeError> {
        if let Some(msg) = self.own_profile_msg()? {
            self.outbound.send(Outbound::Core {
                to: *peer_pubkey,
                msg: Box::new(msg),
            });
        }
        Ok(())
    }

    /// Annonce notre profil à tous les amis confirmés (après chaque
    /// changement de pseudo, bio ou avatar).
    fn announce_profile_to_friends(&self) -> Result<(), NodeError> {
        let Some(msg) = self.own_profile_msg()? else {
            return Ok(());
        };
        for friend in self.friend_pubkeys()? {
            self.outbound.send(Outbound::Core {
                to: friend,
                msg: Box::new(msg.clone()),
            });
        }
        Ok(())
    }
}

/// Profil public local exposé à l'UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SelfProfile {
    /// NodeId en hexadécimal.
    pub node_id: String,
    /// Clé publique Ed25519 en hexadécimal.
    pub pubkey: String,
    /// Code ami affichable (`MOT-MOT-MOT-0042`).
    pub friend_code: String,
    /// Pseudo local (`null` s'il n'a jamais été défini, D-027).
    pub name: Option<String>,
    /// Bio locale (`null` si jamais définie ou effacée).
    pub bio: Option<String>,
    /// Hash d'avatar (hex 64) ou `null` si aucun avatar.
    pub avatar: Option<String>,
    /// Hash de bannière (hex 64) ou `null` si aucune bannière.
    pub banner: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outbound::OutboundSink;
    use accord_core::db::Db;
    use accord_crypto::Identity;
    use tokio::sync::mpsc;

    fn node() -> Node {
        let id = Identity::generate_with_pow_bits(1);
        let db = Db::open_in_memory(&[1u8; 32]).unwrap();
        Node::new(id, db, OutboundSink::null())
    }

    /// Nœud relié à un canal outbound + un ami confirmé (clé du pair).
    fn node_with_friend_and_channel() -> (Node, [u8; 32], mpsc::Receiver<Outbound>) {
        let id = Identity::generate_with_pow_bits(1);
        let db = Db::open_in_memory(&[1u8; 32]).unwrap();
        let (sink, mut rx) = OutboundSink::channel(64);
        let node = Node::new(id, db, sink);
        let peer = Identity::generate_with_pow_bits(1);
        node.friend_request(&peer.public_key(), "Pair").unwrap();
        node.ingest_core(
            &peer.public_key(),
            CoreMsg::FriendResponse { accepted: true },
        )
        .unwrap();
        // Purge les actions de l'établissement d'amitié.
        while rx.try_recv().is_ok() {}
        (node, peer.public_key(), rx)
    }

    /// Extrait le prochain `CoreMsg::Profile` du canal outbound.
    fn next_profile(rx: &mut mpsc::Receiver<Outbound>) -> Option<([u8; 32], CoreMsg)> {
        while let Ok(action) = rx.try_recv() {
            if let Outbound::Core { to, msg } = action {
                if matches!(*msg, CoreMsg::Profile { .. }) {
                    return Some((to, *msg));
                }
            }
        }
        None
    }

    #[test]
    fn profile_update_requires_at_least_one_field() {
        let n = node();
        assert!(n.profile_update(None, None).is_err());
        assert_eq!(n.profile_name().unwrap(), None);
    }

    #[test]
    fn profile_update_is_all_or_nothing() {
        let n = node();
        n.profile_update(Some("Anna"), Some("bio initiale"))
            .unwrap();
        // Bio invalide : le pseudo pourtant valide n'est pas écrit non plus.
        assert!(n
            .profile_update(Some("Bertrand"), Some(&"x".repeat(2049)))
            .is_err());
        assert_eq!(n.profile_name().unwrap(), Some("Anna".into()));
        assert_eq!(n.profile_bio().unwrap(), Some("bio initiale".into()));
    }

    #[test]
    fn bio_set_clear_and_self_profile_shape() {
        let n = node();
        n.profile_update(Some("  Anna  "), Some("  ma bio  "))
            .unwrap();
        assert_eq!(n.profile_name().unwrap(), Some("Anna".into()));
        assert_eq!(n.profile_bio().unwrap(), Some("ma bio".into()));
        let p = n.self_profile().unwrap();
        assert_eq!(p.name, Some("Anna".into()));
        assert_eq!(p.bio, Some("ma bio".into()));
        assert_eq!(p.avatar, None);
        assert_eq!(p.banner, None);
        // Bio vide = effacée.
        n.profile_update(None, Some("")).unwrap();
        assert_eq!(n.profile_bio().unwrap(), None);
    }

    #[test]
    fn own_profile_msg_requires_a_name() {
        let n = node();
        // Bio seule : rien à annoncer tant que le pseudo n'est pas défini.
        n.profile_update(None, Some("bio sans pseudo")).unwrap();
        assert!(n.own_profile_msg().unwrap().is_none());
        n.profile_update(Some("Anna"), None).unwrap();
        match n.own_profile_msg().unwrap() {
            Some(CoreMsg::Profile {
                display_name,
                bio,
                avatar,
                banner,
            }) => {
                assert_eq!(display_name, "Anna");
                assert_eq!(bio, "bio sans pseudo");
                assert_eq!(avatar, None);
                assert_eq!(banner, None);
            }
            other => panic!("annonce inattendue : {other:?}"),
        }
    }

    #[test]
    fn profile_change_announces_full_profile_to_friends() {
        let (n, peer, mut rx) = node_with_friend_and_channel();
        n.profile_update(Some("Anna"), Some("ma bio")).unwrap();
        let (to, msg) = next_profile(&mut rx).expect("annonce attendue");
        assert_eq!(to, peer);
        match msg {
            CoreMsg::Profile {
                display_name, bio, ..
            } => {
                assert_eq!(display_name, "Anna");
                assert_eq!(bio, "ma bio");
            }
            other => panic!("annonce inattendue : {other:?}"),
        }
    }

    #[test]
    fn avatar_removal_clears_hash_and_reannounces() {
        let (n, _peer, mut rx) = node_with_friend_and_channel();
        n.profile_set_name("Anna").unwrap();
        while rx.try_recv().is_ok() {}
        // Retrait (aucun avatar défini : idempotent) : hash nul, ré-annonce.
        assert_eq!(n.profile_set_avatar(None).unwrap(), None);
        assert_eq!(n.profile_avatar().unwrap(), None);
        let (_, msg) = next_profile(&mut rx).expect("ré-annonce attendue");
        assert!(matches!(msg, CoreMsg::Profile { avatar: None, .. }));
    }

    #[test]
    fn avatar_publication_goes_through_files_subsystem() {
        // Le magasin de blobs vit à côté de la base : sur une base disque,
        // la publication renvoie le hash, le persiste et le blob est relisible.
        let dir = tempfile::tempdir().unwrap();
        let id = Identity::generate_with_pow_bits(1);
        let db = Db::open(&dir.path().join("accord.db"), &[1u8; 32]).unwrap();
        let n = Node::new(id, db, OutboundSink::null());
        n.profile_set_name("Anna").unwrap();
        let hash = n
            .profile_set_avatar(Some(("image/png", vec![1, 2, 3])))
            .unwrap()
            .expect("hash d'avatar attendu");
        assert_eq!(n.profile_avatar().unwrap(), Some(hash));
        assert!(n.files_local_path(&hash).unwrap().is_some());
        // Retrait : le hash disparaît du profil.
        assert_eq!(n.profile_set_avatar(None).unwrap(), None);
        assert_eq!(n.profile_avatar().unwrap(), None);
    }

    #[test]
    fn banner_removal_clears_hash_and_reannounces() {
        let (n, _peer, mut rx) = node_with_friend_and_channel();
        n.profile_set_name("Anna").unwrap();
        while rx.try_recv().is_ok() {}
        // Retrait (aucune bannière définie : idempotent) : hash nul, ré-annonce.
        assert_eq!(n.profile_set_banner(None).unwrap(), None);
        assert_eq!(n.profile_banner().unwrap(), None);
        let (_, msg) = next_profile(&mut rx).expect("ré-annonce attendue");
        assert!(matches!(msg, CoreMsg::Profile { banner: None, .. }));
    }

    #[test]
    fn banner_publication_goes_through_files_subsystem() {
        // Même mécanisme que l'avatar : publication dans le magasin de blobs
        // (base disque), le hash est persisté et le blob relisible.
        let dir = tempfile::tempdir().unwrap();
        let id = Identity::generate_with_pow_bits(1);
        let db = Db::open(&dir.path().join("accord.db"), &[1u8; 32]).unwrap();
        let n = Node::new(id, db, OutboundSink::null());
        n.profile_set_name("Anna").unwrap();
        let hash = n
            .profile_set_banner(Some(("image/png", vec![4, 5, 6])))
            .unwrap()
            .expect("hash de bannière attendu");
        assert_eq!(n.profile_banner().unwrap(), Some(hash));
        assert!(n.files_local_path(&hash).unwrap().is_some());
        // Avatar et bannière coexistent sans interférence.
        let av = n
            .profile_set_avatar(Some(("image/png", vec![1, 2, 3])))
            .unwrap()
            .expect("hash d'avatar attendu");
        assert_eq!(n.profile_avatar().unwrap(), Some(av));
        assert_eq!(n.profile_banner().unwrap(), Some(hash));
        // Retrait : le hash de bannière disparaît, l'avatar reste.
        assert_eq!(n.profile_set_banner(None).unwrap(), None);
        assert_eq!(n.profile_banner().unwrap(), None);
        assert_eq!(n.profile_avatar().unwrap(), Some(av));
    }

    #[test]
    fn ingested_friend_profile_persists_bio_avatar_and_banner() {
        let (n, peer, _rx) = node_with_friend_and_channel();
        n.ingest_core(
            &peer,
            CoreMsg::Profile {
                display_name: "Pair".into(),
                bio: "bio du pair".into(),
                avatar: Some([5u8; 32]),
                banner: Some([6u8; 32]),
            },
        )
        .unwrap();
        let node_id = node_id_of(&peer).0;
        let (bio, avatar, banner) = n
            .with_db(|db| {
                Ok((
                    profile::peer_bio(db, &node_id)?,
                    profile::peer_avatar(db, &node_id)?,
                    profile::peer_banner(db, &node_id)?,
                ))
            })
            .unwrap();
        assert_eq!(bio, Some("bio du pair".into()));
        assert_eq!(avatar, Some([5u8; 32]));
        assert_eq!(banner, Some([6u8; 32]));
        // Nouvelle annonce sans bio, avatar ni bannière : effacement.
        n.ingest_core(
            &peer,
            CoreMsg::Profile {
                display_name: "Pair".into(),
                bio: String::new(),
                avatar: None,
                banner: None,
            },
        )
        .unwrap();
        let (bio, avatar, banner) = n
            .with_db(|db| {
                Ok((
                    profile::peer_bio(db, &node_id)?,
                    profile::peer_avatar(db, &node_id)?,
                    profile::peer_banner(db, &node_id)?,
                ))
            })
            .unwrap();
        assert_eq!(bio, None);
        assert_eq!(avatar, None);
        assert_eq!(banner, None);
    }
}
