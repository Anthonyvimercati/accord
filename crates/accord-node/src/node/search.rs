//! Recherche filtrée : grammaire `from:`/`in:`/`has:`/`before:`/`after:`
//! au-dessus de l'index aveugle (SPEC §9). Les filtres structurés sont résolus
//! côté nœud (contacts, état des groupes) puis appliqués aux candidats avant de
//! rendre chaque résultat avec ses métadonnées (conversation, auteur, lamport,
//! horodatage) pour un rendu et une navigation directs côté UI.

use std::collections::HashSet;

use accord_core::db::{DmRecord, GroupMsgRecord};
use accord_core::search::{self, HasKind, ParsedQuery};
use accord_crypto::FriendCode;
use accord_proto::core_msg::{FileRef, MsgBody};
use serde_json::{json, Value};

use crate::error::NodeError;
use crate::hex;

use super::{now_ms, Node};

/// Plafond de candidats hydratés d'une recherche filtrée sans mot-clé (l'index
/// aveugle borne déjà le cas avec mots-clés). Au-delà, seuls les plus récents
/// sont considérés.
const SEARCH_CANDIDATE_CAP: usize = 1_000;
/// Nombre maximal de résultats rendus (les plus récents d'abord).
const SEARCH_RESULT_CAP: usize = 200;

/// Conversation d'un résultat de recherche.
enum Conversation {
    /// Message direct avec un pair (clé publique).
    Dm { peer: [u8; 32] },
    /// Message d'un salon de groupe.
    Group {
        group_id: [u8; 16],
        channel_id: [u8; 16],
    },
}

impl Conversation {
    fn to_json(&self) -> Value {
        match self {
            Conversation::Dm { peer } => json!({ "type": "dm", "peer": hex::encode(peer) }),
            Conversation::Group {
                group_id,
                channel_id,
            } => json!({
                "type": "group",
                "group_id": hex::encode(group_id),
                "channel_id": hex::encode(channel_id),
            }),
        }
    }
}

/// Résultat hydraté (avec ce qu'il faut pour filtrer et pour l'UI).
struct SearchHit {
    msg_id: [u8; 16],
    conversation: Conversation,
    author: [u8; 32],
    lamport: u64,
    sent_ms: u64,
    /// Texte décodé (filtre `has:link`).
    text: String,
    /// Pièces jointes (filtres `has:image`/`has:file`).
    attachments: Vec<FileRef>,
}

/// Ensembles de conversations résolus depuis les opérandes `in:`.
#[derive(Default)]
struct InScope {
    peers: HashSet<[u8; 32]>,
    channels: HashSet<([u8; 16], [u8; 16])>,
}

impl InScope {
    fn matches(&self, conv: &Conversation) -> bool {
        match conv {
            Conversation::Dm { peer } => self.peers.contains(peer),
            Conversation::Group {
                group_id,
                channel_id,
            } => self.channels.contains(&(*group_id, *channel_id)),
        }
    }
}

impl Node {
    /// Recherche filtrée : rend les résultats les plus récents d'abord, avec
    /// leurs métadonnées. Une requête sans filtre se comporte comme la
    /// recherche par mots simple (rétrocompatibilité).
    pub fn search_filtered(&self, query: &str) -> Result<Vec<Value>, NodeError> {
        let parsed = search::parse_query(query);
        // Résolution des filtres nécessitant le carnet/les groupes, hors verrou
        // de la grande passe d'hydratation (le Mutex de la base n'est pas
        // réentrant).
        let from_authors = self.resolve_from(&parsed.from)?;
        let in_scope = self.resolve_in(&parsed.in_conversations)?;
        let now = now_ms();
        let before = parsed
            .before
            .as_deref()
            .and_then(|d| search::resolve_date(d, now));
        let after = parsed
            .after
            .as_deref()
            .and_then(|d| search::resolve_date(d, now));

        // A filter that was requested but resolved to nothing (unknown contact
        // or conversation) matches no message — it is strict, not ignored.
        let from_active = !parsed.from.is_empty();
        let in_active = !parsed.in_conversations.is_empty();
        let mut hits = self.gather_candidates(&parsed)?;
        hits.retain(|h| {
            (!from_active || from_authors.contains(&h.author))
                && (!in_active || in_scope.matches(&h.conversation))
                && parsed.has.iter().all(|k| has_kind(k, h))
                && before.map(|b| h.sent_ms < b).unwrap_or(true)
                && after.map(|a| h.sent_ms >= a).unwrap_or(true)
        });
        // Les plus récents d'abord, bornés.
        hits.sort_by(|a, b| b.sent_ms.cmp(&a.sent_ms).then(b.lamport.cmp(&a.lamport)));
        hits.truncate(SEARCH_RESULT_CAP);
        Ok(hits.iter().map(hit_json).collect())
    }

    /// Résout les opérandes `from:` en clés publiques d'auteurs. `me`/`moi`
    /// désigne notre propre identité ; les autres sont comparées au nom
    /// d'affichage (fragment) et au code ami des contacts.
    fn resolve_from(&self, operands: &[String]) -> Result<HashSet<[u8; 32]>, NodeError> {
        let mut set = HashSet::new();
        if operands.is_empty() {
            return Ok(set);
        }
        let me = self.public_key();
        let contacts = self.contacts()?;
        for op in operands {
            if op == "me" || op == "moi" {
                set.insert(me);
                continue;
            }
            for c in &contacts {
                let code = FriendCode::of_pubkey(&c.pubkey).display().to_lowercase();
                if c.display_name.to_lowercase().contains(op) || code.contains(op) {
                    set.insert(c.pubkey);
                }
            }
        }
        Ok(set)
    }

    /// Résout les opérandes `in:` en conversations : contact (DM), salon ou
    /// groupe (tous les salons du groupe correspondant).
    fn resolve_in(&self, operands: &[String]) -> Result<InScope, NodeError> {
        let mut scope = InScope::default();
        if operands.is_empty() {
            return Ok(scope);
        }
        let contacts = self.contacts()?;
        let group_ids = self.group_ids()?;
        for op in operands {
            for c in &contacts {
                if c.display_name.to_lowercase().contains(op) {
                    scope.peers.insert(c.pubkey);
                }
            }
            for gid_hex in &group_ids {
                let Some(gid) = hex::decode::<16>(gid_hex) else {
                    continue;
                };
                let Ok(state) = self.group_state(&gid) else {
                    continue;
                };
                let group_match = state.name.to_lowercase().contains(op);
                for (cid, ch) in &state.channels {
                    if group_match || ch.name.to_lowercase().contains(op) {
                        scope.channels.insert((gid, *cid));
                    }
                }
            }
        }
        Ok(scope)
    }

    /// Construit les candidats hydratés : intersection de l'index aveugle si des
    /// mots simples sont présents, sinon les messages les plus récents (bornés).
    fn gather_candidates(&self, parsed: &ParsedQuery) -> Result<Vec<SearchHit>, NodeError> {
        self.with_db(|db| {
            let mut hits = Vec::new();
            if parsed.text.is_empty() {
                for rec in db.dm_recent(SEARCH_CANDIDATE_CAP)? {
                    hits.push(dm_hit(db, rec)?);
                }
                for rec in db.group_recent(SEARCH_CANDIDATE_CAP)? {
                    hits.push(group_hit(db, rec)?);
                }
            } else {
                for id in search::search(db, &self.search_key, &parsed.text)? {
                    if let Some(rec) = db.dm_message(&id)? {
                        hits.push(dm_hit(db, rec)?);
                    } else if let Some(rec) = db.group_msg(&id)? {
                        hits.push(group_hit(db, rec)?);
                    }
                }
            }
            Ok(hits)
        })
    }
}

/// Texte brut d'un corps encodé (vide si non textuel ou indécodable) — sert au
/// filtre `has:link`.
fn body_text(kind: u8, body: &[u8]) -> String {
    match MsgBody::decode_body(kind, body) {
        Ok(MsgBody::Text { text, .. }) => text,
        _ => String::new(),
    }
}

fn dm_hit(db: &accord_core::Db, rec: DmRecord) -> Result<SearchHit, NodeError> {
    let attachments = db.msg_attachments(&rec.msg_id)?;
    Ok(SearchHit {
        conversation: Conversation::Dm { peer: rec.peer },
        text: body_text(rec.kind, &rec.body),
        msg_id: rec.msg_id,
        author: rec.author,
        lamport: rec.lamport,
        sent_ms: rec.sent_ms,
        attachments,
    })
}

fn group_hit(db: &accord_core::Db, rec: GroupMsgRecord) -> Result<SearchHit, NodeError> {
    let attachments = db.msg_attachments(&rec.msg_id)?;
    Ok(SearchHit {
        conversation: Conversation::Group {
            group_id: rec.group_id,
            channel_id: rec.channel_id,
        },
        text: body_text(rec.kind, &rec.body),
        msg_id: rec.msg_id,
        author: rec.author,
        lamport: rec.lamport,
        sent_ms: rec.sent_ms,
        attachments,
    })
}

/// Vrai si un résultat satisfait un filtre `has:`.
fn has_kind(kind: &HasKind, hit: &SearchHit) -> bool {
    match kind {
        HasKind::Link => hit.text.contains("http://") || hit.text.contains("https://"),
        HasKind::Image => hit
            .attachments
            .iter()
            .any(|a| a.mime.to_lowercase().starts_with("image/")),
        HasKind::File => !hit.attachments.is_empty(),
    }
}

fn hit_json(hit: &SearchHit) -> Value {
    json!({
        "msg_id": hex::encode(&hit.msg_id),
        "author": hex::encode(&hit.author),
        "lamport": hit.lamport,
        "timestamp": hit.sent_ms,
        "conversation": hit.conversation.to_json(),
    })
}
