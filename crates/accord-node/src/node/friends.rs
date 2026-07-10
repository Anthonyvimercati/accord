//! Amis : contacts, demandes, réponses et blocage (bloc `impl Node` du
//! domaine `friends.*`).

use accord_core::db::Contact;
use accord_core::friends;
use accord_crypto::FriendCode;
use accord_proto::core_msg::CoreMsg;

use crate::error::NodeError;
use crate::outbound::Outbound;

use super::{now_ms, Node};

impl Node {
    /// Liste des contacts.
    pub fn contacts(&self) -> Result<Vec<Contact>, NodeError> {
        self.with_db(|db| Ok(db.contacts()?))
    }

    /// Prépare et route une demande d'ami vers une clé publique.
    pub fn friend_request(
        &self,
        peer_pubkey: &[u8; 32],
        display_name: &str,
    ) -> Result<(), NodeError> {
        let action = self.with_db(|db| {
            Ok(friends::request_friend(
                db,
                peer_pubkey,
                display_name,
                now_ms(),
            )?)
        })?;
        // Nom annoncé au pair : le pseudo de profil s'il est défini, sinon le
        // code ami (D-027).
        let my_name = match self.profile_name()? {
            Some(name) => name,
            None => FriendCode::of_pubkey(&self.identity.public_key()).display(),
        };
        let msg = match action {
            friends::OutgoingAction::SendRequest => CoreMsg::FriendRequest {
                display_name: my_name,
                message: String::new(),
                verify_phrase: None,
            },
            friends::OutgoingAction::SendAccept => CoreMsg::FriendResponse { accepted: true },
        };
        self.outbound.send(Outbound::Core {
            to: *peer_pubkey,
            msg: Box::new(msg),
        });
        // Demandes croisées : amitié établie, annoncer aussi notre pseudo.
        if action == friends::OutgoingAction::SendAccept {
            self.announce_profile_to(peer_pubkey)?;
        }
        Ok(())
    }

    /// Répond à une demande entrante. Sur acceptation, annonce aussi notre
    /// pseudo au nouvel ami (D-027).
    pub fn friend_respond(&self, peer_pubkey: &[u8; 32], accept: bool) -> Result<(), NodeError> {
        self.with_db(|db| Ok(friends::respond_friend(db, peer_pubkey, accept)?))?;
        self.outbound.send(Outbound::Core {
            to: *peer_pubkey,
            msg: Box::new(CoreMsg::FriendResponse { accepted: accept }),
        });
        if accept {
            self.announce_profile_to(peer_pubkey)?;
        }
        Ok(())
    }

    /// Bloque un pair.
    pub fn friend_block(&self, peer_pubkey: &[u8; 32]) -> Result<(), NodeError> {
        self.with_db(|db| Ok(friends::block(db, peer_pubkey, now_ms())?))
    }

    /// Débloque un pair.
    pub fn friend_unblock(&self, peer_pubkey: &[u8; 32]) -> Result<(), NodeError> {
        self.with_db(|db| Ok(friends::unblock(db, peer_pubkey)?))
    }

    /// Clés publiques des amis confirmés (présence, relève des boîtes).
    pub fn friend_pubkeys(&self) -> Result<Vec<[u8; 32]>, NodeError> {
        self.with_db(|db| {
            Ok(db
                .contacts()?
                .into_iter()
                .filter(|c| c.state == accord_core::db::ContactState::Friend)
                .map(|c| c.pubkey)
                .collect())
        })
    }
}
