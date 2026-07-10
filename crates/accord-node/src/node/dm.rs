//! Messagerie directe : composition et routage des messages, éditions,
//! suppressions et réactions (bloc `impl Node` du domaine `dm.*`).

use accord_core::db::DmRecord;
use accord_core::messaging;
use accord_proto::core_msg::{CoreMsg, FileRef};
use serde_json::{json, Value};

use crate::error::NodeError;
use crate::hex;
use crate::outbound::Outbound;

use super::{dm_mark_key, now_ms, read_u64, Node};

/// Rend une liste de pièces jointes en JSON (forme gelée côté UI).
pub(super) fn attachments_json(attachments: &[FileRef]) -> Value {
    Value::Array(
        attachments
            .iter()
            .map(|a| {
                json!({
                    "merkle_root": hex::encode(&a.merkle_root),
                    "name": a.name,
                    "size": a.size,
                    "mime": a.mime,
                })
            })
            .collect(),
    )
}

impl Node {
    /// Compose et route un message texte ; persiste et met en file si le pair
    /// est hors ligne (géré par la boucle réseau).
    pub fn dm_send(
        &self,
        peer_pubkey: &[u8; 32],
        text: &str,
        reply_to: Option<[u8; 16]>,
    ) -> Result<String, NodeError> {
        self.dm_send_with_attachments(peer_pubkey, text, reply_to, vec![])
    }

    /// Compose et route un message texte avec pièces jointes (≤ 10, déjà
    /// publiées dans le magasin de fichiers).
    pub fn dm_send_with_attachments(
        &self,
        peer_pubkey: &[u8; 32],
        text: &str,
        reply_to: Option<[u8; 16]>,
        attachments: Vec<FileRef>,
    ) -> Result<String, NodeError> {
        let msg = self.with_db(|db| {
            Ok(messaging::compose_text(
                db,
                &self.identity,
                &self.search_key,
                peer_pubkey,
                text,
                reply_to,
                attachments,
                now_ms(),
            )?)
        })?;
        let msg_id = match &msg {
            CoreMsg::DirectMsg { msg_id, .. } => hex::encode(msg_id),
            _ => unreachable!("compose_text produit un DirectMsg"),
        };
        self.outbound.send(Outbound::Core {
            to: *peer_pubkey,
            msg: Box::new(msg),
        });
        Ok(msg_id)
    }

    /// Pièces jointes persistées d'un message (DM ou groupe).
    pub fn attachments_of(&self, msg_id: &[u8; 16]) -> Result<Vec<FileRef>, NodeError> {
        self.with_db(|db| Ok(db.msg_attachments(msg_id)?))
    }

    /// Historique d'une conversation directe.
    pub fn dm_history(
        &self,
        peer_pubkey: &[u8; 32],
        before_lamport: u64,
        limit: usize,
    ) -> Result<Vec<DmRecord>, NodeError> {
        self.with_db(|db| Ok(db.dm_history(peer_pubkey, before_lamport, limit)?))
    }

    /// Émet un indicateur de frappe éphémère vers un ami. Jamais persisté,
    /// jamais mis en file : si le pair n'est pas présumé en ligne, silence
    /// (« pair injoignable = silencieusement ignoré », SPEC §6).
    pub fn dm_typing(&self, peer_pubkey: &[u8; 32]) -> Result<(), NodeError> {
        if !self.is_online(peer_pubkey) {
            return Ok(());
        }
        let msg = self.with_db(|db| {
            Ok(messaging::compose_typing(
                db,
                &self.identity,
                peer_pubkey,
                now_ms(),
            )?)
        })?;
        self.outbound.send(Outbound::Core {
            to: *peer_pubkey,
            msg: Box::new(msg),
        });
        Ok(())
    }

    /// Marque la conversation avec `peer` lue jusqu'à `lamport` (position
    /// locale, persistée dans les métadonnées, pour le calcul des non-lus).
    pub fn dm_mark_read(&self, peer_pubkey: &[u8; 32], lamport: u64) -> Result<(), NodeError> {
        self.with_db(|db| Ok(db.set_meta(&dm_mark_key(peer_pubkey), &lamport.to_be_bytes())?))
    }

    /// Nombre de messages du pair reçus après notre marque de lecture locale.
    pub fn dm_unread(&self, peer_pubkey: &[u8; 32]) -> Result<u64, NodeError> {
        self.with_db(|db| {
            let mark = read_u64(db.meta(&dm_mark_key(peer_pubkey))?);
            Ok(db.count_dm_unread(peer_pubkey, mark)?)
        })
    }

    /// Édite un de nos messages directs (auteur seul, refusé sinon) puis
    /// route l'édition vers le pair, sur le même chemin que [`Node::dm_send`].
    pub fn dm_edit(
        &self,
        peer_pubkey: &[u8; 32],
        target: &[u8; 16],
        new_text: &str,
    ) -> Result<(), NodeError> {
        let msg = self.with_db(|db| {
            Ok(messaging::compose_edit(
                db,
                &self.identity,
                &self.search_key,
                peer_pubkey,
                target,
                new_text,
                now_ms(),
            )?)
        })?;
        self.outbound.send(Outbound::Core {
            to: *peer_pubkey,
            msg: Box::new(msg),
        });
        Ok(())
    }

    /// Supprime un de nos messages directs (tombstone local immédiat) puis
    /// route la suppression vers le pair.
    pub fn dm_delete(&self, peer_pubkey: &[u8; 32], target: &[u8; 16]) -> Result<(), NodeError> {
        let msg = self.with_db(|db| {
            Ok(messaging::compose_delete(
                db,
                &self.identity,
                peer_pubkey,
                target,
                now_ms(),
            )?)
        })?;
        self.outbound.send(Outbound::Core {
            to: *peer_pubkey,
            msg: Box::new(msg),
        });
        Ok(())
    }

    /// Ajoute (`add = true`) ou retire une réaction sur un message direct,
    /// applique le changement localement puis le route vers le pair.
    pub fn dm_react(
        &self,
        peer_pubkey: &[u8; 32],
        target: &[u8; 16],
        emoji: &str,
        add: bool,
    ) -> Result<(), NodeError> {
        let msg = self.with_db(|db| {
            Ok(messaging::compose_reaction(
                db,
                &self.identity,
                peer_pubkey,
                target,
                emoji,
                add,
                now_ms(),
            )?)
        })?;
        self.outbound.send(Outbound::Core {
            to: *peer_pubkey,
            msg: Box::new(msg),
        });
        Ok(())
    }
}
