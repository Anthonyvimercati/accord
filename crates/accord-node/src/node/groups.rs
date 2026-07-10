//! Groupes : création, salons, rôles, modération, messages, invitations et
//! synchronisation (bloc `impl Node` du domaine `groups.*`).
//!
//! Chaque op locale passe par [`accord_core::group::author_op`], qui rejoue
//! l'op sur l'état courant avant émission : les permissions (bitfield
//! `perms::*`) et la hiérarchie de rôles (on ne touche ni un membre ni un
//! rôle de position supérieure ou égale à la sienne) sont donc vérifiées à
//! l'émission comme à l'ingestion. Après chaque op appliquée, l'événement
//! `event.group_state { group_id }` invite l'UI à recharger `groups.state`.

use accord_core::group;
use accord_core::group::GroupState;
use accord_proto::core_msg::{ChannelKind, CoreMsg, FileRef, GroupOpBody};
use serde_json::json;

use crate::error::NodeError;
use crate::hex;
use crate::outbound::Outbound;

use super::{group_mark_key, now_ms, read_u64, Node};

/// Borne du nom d'un groupe, d'un salon, d'une catégorie ou d'un rôle.
const MAX_LABEL_CHARS: usize = 100;

/// Borne d'un sujet de salon (octets UTF-8, alignée sur le filaire).
const MAX_TOPIC_BYTES: usize = 2048;

/// Taille maximale d'une icône de groupe décodée (512 Kio).
pub(crate) const MAX_ICON_BYTES: usize = 512 * 1024;

/// Taille maximale d'un émoji de serveur décodé (256 Kio).
const MAX_EMOJI_BYTES: usize = 256 * 1024;

/// Types MIME acceptés pour un émoji de serveur.
const EMOJI_MIMES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/// Valide un nom d'émoji à la frontière (2-32 caractères `[a-z0-9_]`) : même
/// règle qu'au repli du journal, avec un message d'erreur explicite.
fn validate_emoji_name(name: &str) -> Result<(), NodeError> {
    let len = name.chars().count();
    let ok = (2..=32).contains(&len)
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    if ok {
        Ok(())
    } else {
        Err(NodeError::Invalid(
            "nom d'émoji invalide (2-32 caractères a-z, 0-9, _)",
        ))
    }
}

/// Valide un nom court (groupe, salon, catégorie, rôle).
fn validate_label(name: &str) -> Result<(), NodeError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_LABEL_CHARS {
        return Err(NodeError::Invalid("nom vide ou trop long (100 max)"));
    }
    Ok(())
}

impl Node {
    /// Compose, valide, persiste et diffuse une op de groupe locale, puis
    /// signale le nouvel état à l'UI (`event.group_state`).
    fn group_author(&self, group_id: &[u8; 16], body: GroupOpBody) -> Result<(), NodeError> {
        let op = self.with_db(|db| {
            Ok(group::author_op(
                db,
                &self.identity,
                group_id,
                &body,
                now_ms(),
            )?)
        })?;
        self.outbound.send(Outbound::GroupOp { op: Box::new(op) });
        self.emit_group_state(group_id);
        Ok(())
    }

    /// Émet `event.group_state { group_id }` (l'UI recharge `groups.state`).
    pub(super) fn emit_group_state(&self, group_id: &[u8; 16]) {
        self.emit(
            "event.group_state",
            json!({ "group_id": hex::encode(group_id) }),
        );
    }

    /// Crée un groupe et diffuse l'op CREATE.
    pub fn group_create(&self, name: &str) -> Result<String, NodeError> {
        let created =
            self.with_db(|db| Ok(group::create_group(db, &self.identity, name, now_ms())?))?;
        self.outbound.send(Outbound::GroupOp {
            op: Box::new(created.op),
        });
        self.emit_group_state(&created.group_id);
        Ok(hex::encode(&created.group_id))
    }

    /// Identifiants des groupes connus.
    pub fn group_ids(&self) -> Result<Vec<String>, NodeError> {
        self.with_db(|db| Ok(db.group_ids()?.iter().map(|g| hex::encode(g)).collect()))
    }

    /// État matérialisé d'un groupe.
    pub fn group_state(&self, group_id: &[u8; 16]) -> Result<GroupState, NodeError> {
        self.with_db(|db| Ok(group::group_state(db, group_id)?))
    }

    // ---- Métadonnées ----

    /// Renomme un groupe (op `SetMeta`, icône actuelle conservée).
    pub fn group_rename(&self, group_id: &[u8; 16], name: &str) -> Result<(), NodeError> {
        validate_label(name)?;
        let icon = self.group_state(group_id)?.icon;
        self.group_author(
            group_id,
            GroupOpBody::SetMeta {
                name: name.trim().to_string(),
                icon,
            },
        )
    }

    /// Change l'icône d'un groupe : publie l'image dans le magasin de
    /// fichiers puis émet `SetMeta` avec sa racine Merkle. Rend la racine.
    pub fn group_set_icon(
        &self,
        group_id: &[u8; 16],
        mime: &str,
        bytes: Vec<u8>,
    ) -> Result<String, NodeError> {
        if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
            return Err(NodeError::Invalid(
                "icône vide ou trop lourde (512 Kio max)",
            ));
        }
        if !mime.starts_with("image/") {
            return Err(NodeError::Invalid("l'icône doit être une image"));
        }
        let name = self.group_state(group_id)?.name;
        let file: FileRef = self.files_publish_bytes("icone-groupe", mime, bytes)?;
        self.group_author(
            group_id,
            GroupOpBody::SetMeta {
                name,
                icon: Some(file.merkle_root),
            },
        )?;
        Ok(hex::encode(&file.merkle_root))
    }

    // ---- Salons ----

    /// Ajoute un salon texte à un groupe (raccourci historique).
    pub fn group_add_channel(&self, group_id: &[u8; 16], name: &str) -> Result<String, NodeError> {
        self.group_channel_add(group_id, name, ChannelKind::Text, None)
    }

    /// Ajoute un salon (texte ou vocal), éventuellement dans une catégorie,
    /// positionné après les salons existants.
    pub fn group_channel_add(
        &self,
        group_id: &[u8; 16],
        name: &str,
        kind: ChannelKind,
        category: Option<[u8; 16]>,
    ) -> Result<String, NodeError> {
        validate_label(name)?;
        let state = self.group_state(group_id)?;
        if let Some(cat) = &category {
            if !state.categories.contains_key(cat) {
                return Err(NodeError::NotFound("catégorie inconnue"));
            }
        }
        let position = state
            .channels
            .values()
            .map(|c| c.position)
            .max()
            .map(|p| p.saturating_add(1))
            .unwrap_or(0);
        let channel_id = group::new_id16();
        self.group_author(
            group_id,
            GroupOpBody::AddChannel {
                channel_id,
                name: name.trim().to_string(),
                category,
                kind,
                position,
            },
        )?;
        Ok(hex::encode(&channel_id))
    }

    /// Ajoute une catégorie de salons, positionnée après les existantes.
    pub fn group_category_add(
        &self,
        group_id: &[u8; 16],
        name: &str,
        position: Option<u16>,
    ) -> Result<String, NodeError> {
        validate_label(name)?;
        let default_position = self
            .group_state(group_id)?
            .categories
            .values()
            .map(|c| c.position)
            .max()
            .map(|p| p.saturating_add(1))
            .unwrap_or(0);
        let category_id = group::new_id16();
        self.group_author(
            group_id,
            GroupOpBody::AddCategory {
                category_id,
                name: name.trim().to_string(),
                position: position.unwrap_or(default_position),
            },
        )?;
        Ok(hex::encode(&category_id))
    }

    /// Édite un salon (nom et/ou position ; champ absent = inchangé).
    pub fn group_channel_edit(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        name: Option<&str>,
        position: Option<u16>,
    ) -> Result<(), NodeError> {
        let state = self.group_state(group_id)?;
        let current = state
            .channels
            .get(channel_id)
            .ok_or(NodeError::NotFound("salon inconnu"))?;
        let name = match name {
            Some(n) => {
                validate_label(n)?;
                n.trim().to_string()
            }
            None => current.name.clone(),
        };
        self.group_author(
            group_id,
            GroupOpBody::EditChannel {
                channel_id: *channel_id,
                name,
                position: position.unwrap_or(current.position),
            },
        )
    }

    /// Supprime un salon.
    pub fn group_channel_del(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
    ) -> Result<(), NodeError> {
        self.group_author(
            group_id,
            GroupOpBody::DelChannel {
                channel_id: *channel_id,
            },
        )
    }

    /// Change le sujet d'un salon.
    pub fn group_set_topic(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        topic: &str,
    ) -> Result<(), NodeError> {
        if topic.len() > MAX_TOPIC_BYTES {
            return Err(NodeError::Invalid("sujet trop long (2048 octets max)"));
        }
        self.group_author(
            group_id,
            GroupOpBody::SetTopic {
                channel_id: *channel_id,
                topic: topic.trim().to_string(),
            },
        )
    }

    // ---- Émojis de serveur ----

    /// Ajoute (ou remplace) un émoji de serveur : publie l'image dans le
    /// magasin de fichiers puis émet l'op `AddEmoji`. Rend la racine Merkle
    /// de l'image. Un `AddEmoji` sur un nom existant met l'image à jour.
    pub fn group_emoji_add(
        &self,
        group_id: &[u8; 16],
        name: &str,
        mime: &str,
        bytes: Vec<u8>,
    ) -> Result<String, NodeError> {
        validate_emoji_name(name)?;
        if bytes.is_empty() || bytes.len() > MAX_EMOJI_BYTES {
            return Err(NodeError::Invalid("émoji vide ou trop lourd (256 Kio max)"));
        }
        if !EMOJI_MIMES.contains(&mime) {
            return Err(NodeError::Invalid(
                "type d'émoji non pris en charge (png, jpeg, webp, gif)",
            ));
        }
        let file: FileRef = self.files_publish_bytes("emoji", mime, bytes)?;
        self.group_author(
            group_id,
            GroupOpBody::AddEmoji {
                name: name.to_string(),
                file: file.merkle_root,
            },
        )?;
        Ok(hex::encode(&file.merkle_root))
    }

    /// Supprime un émoji de serveur par son nom (op `DelEmoji`).
    pub fn group_emoji_del(&self, group_id: &[u8; 16], name: &str) -> Result<(), NodeError> {
        validate_emoji_name(name)?;
        self.group_author(
            group_id,
            GroupOpBody::DelEmoji {
                name: name.to_string(),
            },
        )
    }

    // ---- Membres et modération ----

    /// Expulse un membre (hiérarchie de rôles vérifiée par l'op-log).
    pub fn group_kick(&self, group_id: &[u8; 16], member: &[u8; 32]) -> Result<(), NodeError> {
        self.group_author(group_id, GroupOpBody::Kick { member: *member })
    }

    /// Bannit un membre (hiérarchie de rôles vérifiée par l'op-log).
    pub fn group_ban(&self, group_id: &[u8; 16], member: &[u8; 32]) -> Result<(), NodeError> {
        self.group_author(group_id, GroupOpBody::Ban { member: *member })
    }

    /// Lève un bannissement.
    pub fn group_unban(&self, group_id: &[u8; 16], member: &[u8; 32]) -> Result<(), NodeError> {
        self.group_author(group_id, GroupOpBody::Unban { member: *member })
    }

    /// Quitte le groupe (refusé au fondateur tant qu'il reste des membres).
    pub fn group_leave(&self, group_id: &[u8; 16]) -> Result<(), NodeError> {
        self.group_author(group_id, GroupOpBody::Leave)
    }

    // ---- Rôles ----

    /// Crée un rôle ; rend son identifiant.
    pub fn group_role_add(
        &self,
        group_id: &[u8; 16],
        name: &str,
        color: u32,
        permissions: u32,
        position: Option<u16>,
    ) -> Result<String, NodeError> {
        validate_label(name)?;
        validate_role_fields(color, permissions)?;
        let role_id = group::new_id16();
        self.group_author(
            group_id,
            GroupOpBody::AddRole {
                role_id,
                name: name.trim().to_string(),
                color,
                position: position.unwrap_or(0),
                permissions,
            },
        )?;
        Ok(hex::encode(&role_id))
    }

    /// Édite un rôle (champ absent = inchangé).
    #[allow(clippy::too_many_arguments)]
    pub fn group_role_edit(
        &self,
        group_id: &[u8; 16],
        role_id: &[u8; 16],
        name: Option<&str>,
        color: Option<u32>,
        position: Option<u16>,
        permissions: Option<u32>,
    ) -> Result<(), NodeError> {
        let state = self.group_state(group_id)?;
        let current = state
            .roles
            .get(role_id)
            .ok_or(NodeError::NotFound("rôle inconnu"))?;
        let name = match name {
            Some(n) => {
                validate_label(n)?;
                n.trim().to_string()
            }
            None => current.name.clone(),
        };
        let color = color.unwrap_or(current.color);
        let permissions = permissions.unwrap_or(current.permissions);
        validate_role_fields(color, permissions)?;
        self.group_author(
            group_id,
            GroupOpBody::EditRole {
                role_id: *role_id,
                name,
                color,
                position: position.unwrap_or(current.position),
                permissions,
            },
        )
    }

    /// Supprime un rôle (retiré de tous les membres et overrides).
    pub fn group_role_del(&self, group_id: &[u8; 16], role_id: &[u8; 16]) -> Result<(), NodeError> {
        self.group_author(group_id, GroupOpBody::DelRole { role_id: *role_id })
    }

    /// Attribue un rôle à un membre.
    pub fn group_role_assign(
        &self,
        group_id: &[u8; 16],
        role_id: &[u8; 16],
        member: &[u8; 32],
    ) -> Result<(), NodeError> {
        self.group_author(
            group_id,
            GroupOpBody::AssignRole {
                member: *member,
                role_id: *role_id,
            },
        )
    }

    /// Retire un rôle à un membre.
    pub fn group_role_unassign(
        &self,
        group_id: &[u8; 16],
        role_id: &[u8; 16],
        member: &[u8; 32],
    ) -> Result<(), NodeError> {
        self.group_author(
            group_id,
            GroupOpBody::UnassignRole {
                member: *member,
                role_id: *role_id,
            },
        )
    }

    // ---- Épinglage ----

    /// Épingle un message d'un salon (le message doit être connu localement
    /// et appartenir au salon).
    pub fn group_pin(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        msg_id: &[u8; 16],
    ) -> Result<(), NodeError> {
        let known = self.with_db(|db| Ok(db.group_msg(msg_id)?))?;
        match known {
            Some(rec) if rec.group_id == *group_id && rec.channel_id == *channel_id => {}
            _ => return Err(NodeError::NotFound("message inconnu dans ce salon")),
        }
        self.group_author(
            group_id,
            GroupOpBody::Pin {
                channel_id: *channel_id,
                msg_id: *msg_id,
            },
        )
    }

    /// Désépingle un message.
    pub fn group_unpin(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        msg_id: &[u8; 16],
    ) -> Result<(), NodeError> {
        self.group_author(
            group_id,
            GroupOpBody::Unpin {
                channel_id: *channel_id,
                msg_id: *msg_id,
            },
        )
    }

    /// Messages épinglés d'un salon (hex), dans l'ordre des identifiants.
    pub fn group_pins(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
    ) -> Result<Vec<String>, NodeError> {
        let state = self.group_state(group_id)?;
        let channel = state
            .channels
            .get(channel_id)
            .ok_or(NodeError::NotFound("salon inconnu"))?;
        Ok(channel.pins.iter().map(|id| hex::encode(id)).collect())
    }

    // ---- Messages ----

    /// Compose, persiste et diffuse un message de salon de groupe.
    pub fn group_send(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        text: &str,
    ) -> Result<String, NodeError> {
        self.group_send_with_attachments(group_id, channel_id, text, None, vec![])
    }

    /// Compose, persiste et diffuse un message de salon avec réponse citée
    /// éventuelle (`reply_to` = `msg_id` cité) et pièces jointes.
    pub fn group_send_with_attachments(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        text: &str,
        reply_to: Option<[u8; 16]>,
        attachments: Vec<FileRef>,
    ) -> Result<String, NodeError> {
        let msg = self.with_db(|db| {
            Ok(group::compose_group_message(
                db,
                &self.identity,
                &self.search_key,
                group_id,
                channel_id,
                text,
                reply_to,
                attachments,
                now_ms(),
            )?)
        })?;
        let msg_id = match &msg {
            CoreMsg::GroupMsg { msg_id, .. } => hex::encode(msg_id),
            _ => unreachable!("compose_group_message produit un GroupMsg"),
        };
        self.outbound.send(Outbound::GroupCast {
            group_id: *group_id,
            msg: Box::new(msg),
        });
        Ok(msg_id)
    }

    /// Édite un de nos messages de groupe (auteur seul) puis diffuse
    /// l'édition aux membres.
    pub fn group_edit_msg(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        target: &[u8; 16],
        new_text: &str,
    ) -> Result<(), NodeError> {
        let msg = self.with_db(|db| {
            Ok(group::compose_group_edit(
                db,
                &self.identity,
                &self.search_key,
                group_id,
                channel_id,
                target,
                new_text,
                now_ms(),
            )?)
        })?;
        self.outbound.send(Outbound::GroupCast {
            group_id: *group_id,
            msg: Box::new(msg),
        });
        Ok(())
    }

    /// Supprime un message de groupe : le nôtre par tombstone diffusée aux
    /// membres ; celui d'autrui par op de modération signée (`DeleteMsg`,
    /// permission `MANAGE_MESSAGES` requise).
    pub fn group_delete_msg(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        target: &[u8; 16],
    ) -> Result<(), NodeError> {
        let record = self
            .with_db(|db| Ok(db.group_msg(target)?))?
            .ok_or(NodeError::NotFound("message inconnu"))?;
        if record.group_id != *group_id || record.channel_id != *channel_id {
            return Err(NodeError::NotFound("message inconnu dans ce salon"));
        }
        if record.author == self.identity.public_key() {
            let msg = self.with_db(|db| {
                Ok(group::compose_group_delete(
                    db,
                    &self.identity,
                    group_id,
                    channel_id,
                    target,
                    now_ms(),
                )?)
            })?;
            self.outbound.send(Outbound::GroupCast {
                group_id: *group_id,
                msg: Box::new(msg),
            });
            return Ok(());
        }
        // Message d'autrui : modération par op-log signée (l'op applique le
        // tombstone localement et chez tous les membres au repli).
        self.group_author(
            group_id,
            GroupOpBody::DeleteMsg {
                channel_id: *channel_id,
                msg_id: *target,
            },
        )
    }

    /// Ajoute (`add = true`) ou retire une réaction sur un message de groupe,
    /// applique le changement localement puis le diffuse aux membres.
    pub fn group_react(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        target: &[u8; 16],
        emoji: &str,
        add: bool,
    ) -> Result<(), NodeError> {
        let msg = self.with_db(|db| {
            Ok(group::compose_group_reaction(
                db,
                &self.identity,
                group_id,
                channel_id,
                target,
                emoji,
                add,
                now_ms(),
            )?)
        })?;
        self.outbound.send(Outbound::GroupCast {
            group_id: *group_id,
            msg: Box::new(msg),
        });
        Ok(())
    }

    // ---- Invitations et synchronisation ----

    /// Invite un pair dans un groupe : op `AddMember` diffusée à tous, puis
    /// rejeu de l'op-log complet et clé de groupe scellée envoyés au nouvel
    /// arrivant pour qu'il matérialise l'état et déchiffre les messages.
    pub fn group_invite(&self, group_id: &[u8; 16], member: &[u8; 32]) -> Result<(), NodeError> {
        let (add_op, ops, key_epoch, sealed_key) = self.with_db(|db| {
            let add_op = group::author_op(
                db,
                &self.identity,
                group_id,
                &GroupOpBody::AddMember {
                    member: *member,
                    invite_id: None,
                },
                now_ms(),
            )?;
            let ops = group::ops_for_pull(db, group_id, 0)?;
            let (key_epoch, sealed_key) = group::seal_current_key_for(db, group_id, member)?;
            Ok((add_op, ops, key_epoch, sealed_key))
        })?;
        self.outbound.send(Outbound::GroupOp {
            op: Box::new(add_op),
        });
        for op in ops {
            self.outbound.send(Outbound::Core {
                to: *member,
                msg: Box::new(CoreMsg::GroupOpMsg { op }),
            });
        }
        self.outbound.send(Outbound::Core {
            to: *member,
            msg: Box::new(CoreMsg::GroupKey {
                group_id: *group_id,
                key_epoch,
                sealed_key,
            }),
        });
        self.emit_group_state(group_id);
        Ok(())
    }

    /// Historique d'un salon de groupe.
    pub fn group_history(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        before_lamport: u64,
        limit: usize,
    ) -> Result<Vec<accord_core::db::GroupMsgRecord>, NodeError> {
        self.with_db(|db| Ok(db.group_history(group_id, channel_id, before_lamport, limit)?))
    }

    /// Émet un indicateur de frappe éphémère dans un salon, vers les seuls
    /// membres présumés en ligne (jamais persisté, jamais mis en file — les
    /// membres injoignables sont silencieusement ignorés, SPEC §6).
    pub fn group_typing(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
    ) -> Result<(), NodeError> {
        let state = self.group_state(group_id)?;
        // Compose une fois (échoue si salon inconnu ou écriture refusée).
        let msg = self.with_db(|db| {
            Ok(group::compose_group_typing(
                db,
                &self.identity,
                group_id,
                channel_id,
                now_ms(),
            )?)
        })?;
        let me = self.identity.public_key();
        for member in state.members.keys() {
            if *member != me && self.is_online(member) {
                self.outbound.send(Outbound::Core {
                    to: *member,
                    msg: Box::new(msg.clone()),
                });
            }
        }
        Ok(())
    }

    /// Marque un salon lu jusqu'à `lamport` (position locale des non-lus,
    /// persistée dans les métadonnées).
    pub fn group_mark_read(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        lamport: u64,
    ) -> Result<(), NodeError> {
        self.with_db(|db| {
            Ok(db.set_meta(
                &group_mark_key(group_id, channel_id),
                &lamport.to_be_bytes(),
            )?)
        })
    }

    /// Non-lus par salon d'un groupe : `(channel_id, n)` pour chaque salon
    /// portant au moins un message d'autrui après la marque de lecture locale.
    pub fn group_unread(&self, group_id: &[u8; 16]) -> Result<Vec<([u8; 16], u64)>, NodeError> {
        let state = self.group_state(group_id)?;
        let me = self.identity.public_key();
        self.with_db(|db| {
            let mut out = Vec::new();
            for channel_id in state.channels.keys() {
                let mark = read_u64(db.meta(&group_mark_key(group_id, channel_id))?);
                let n = db.count_group_unread(group_id, channel_id, mark, &me)?;
                if n > 0 {
                    out.push((*channel_id, n));
                }
            }
            Ok(out)
        })
    }

    /// Offre de synchronisation anti-entropie d'un groupe (SPEC §6.3).
    pub fn group_sync_offer(&self, group_id: &[u8; 16]) -> Result<group::SyncOffer, NodeError> {
        self.with_db(|db| Ok(group::sync_offer(db, group_id)?))
    }
}

/// Valide couleur et permissions d'un rôle.
fn validate_role_fields(color: u32, permissions: u32) -> Result<(), NodeError> {
    if color > 0xFF_FF_FF {
        return Err(NodeError::Invalid("couleur hors bornes (0xRRGGBB)"));
    }
    if permissions & !accord_core::group::state::ALL_PERMS != 0 {
        return Err(NodeError::Invalid("bits de permission inconnus"));
    }
    Ok(())
}
