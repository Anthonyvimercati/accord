//! Scheduled messages (Lot F1): node-side scheduling and firing.
//!
//! Purely local. A due message is routed through the ordinary send path
//! (`dm_send`/`group_send`) — which already queues to the outbox for an
//! offline peer — then its row is dropped. No wire negotiation, no new
//! network format.

use accord_core::db::ScheduledMessage;
use accord_core::group::new_id16;

use crate::error::NodeError;
use crate::hex;

use super::{now_ms, Node};

/// Furthest a message may be scheduled into the future: one year. Keeps a
/// stray timestamp from parking a row effectively forever.
pub const MAX_SCHEDULE_HORIZON_MS: u64 = 365 * 24 * 3600 * 1000;

/// Messages sent per firing pass: bounds one pass on a large backlog.
const FIRE_BATCH: usize = 64;

impl Node {
    /// Schedules a direct message. `fire_at` is wall-clock milliseconds.
    /// Returns the new scheduled-message id (hex).
    pub fn schedule_dm(
        &self,
        peer: &[u8; 32],
        body: &str,
        fire_at: u64,
    ) -> Result<String, NodeError> {
        self.schedule_insert("dm", peer.to_vec(), None, body, fire_at)
    }

    /// Schedules a group-channel message. Returns the new id (hex).
    pub fn schedule_group(
        &self,
        group_id: &[u8; 16],
        channel_id: &[u8; 16],
        body: &str,
        fire_at: u64,
    ) -> Result<String, NodeError> {
        self.schedule_insert("group", group_id.to_vec(), Some(*channel_id), body, fire_at)
    }

    fn schedule_insert(
        &self,
        scope: &str,
        scope_id: Vec<u8>,
        channel_id: Option<[u8; 16]>,
        body: &str,
        fire_at: u64,
    ) -> Result<String, NodeError> {
        if body.trim().is_empty() {
            return Err(NodeError::Invalid("message programmé vide"));
        }
        self.check_horizon(fire_at)?;
        let id = new_id16();
        let m = ScheduledMessage {
            id,
            scope: scope.to_string(),
            scope_id,
            channel_id,
            body: body.to_string(),
            fire_at,
            created_at: now_ms(),
        };
        self.with_db(|db| Ok(db.insert_scheduled(&m)?))?;
        Ok(hex::encode(&id))
    }

    /// Every scheduled message, soonest first.
    pub fn scheduled_messages(&self) -> Result<Vec<ScheduledMessage>, NodeError> {
        self.with_db(|db| Ok(db.scheduled_all()?))
    }

    /// Cancels a scheduled message. `NotFound` when the id is unknown.
    pub fn scheduled_cancel(&self, id: &[u8; 16]) -> Result<(), NodeError> {
        if self.with_db(|db| Ok(db.delete_scheduled(id)?))? {
            Ok(())
        } else {
            Err(NodeError::NotFound("message programmé inconnu"))
        }
    }

    /// Moves a scheduled message to a new firing time. `NotFound` when unknown.
    pub fn scheduled_reschedule(&self, id: &[u8; 16], fire_at: u64) -> Result<(), NodeError> {
        self.check_horizon(fire_at)?;
        if self.with_db(|db| Ok(db.reschedule_scheduled(id, fire_at)?))? {
            Ok(())
        } else {
            Err(NodeError::NotFound("message programmé inconnu"))
        }
    }

    /// Sends every due scheduled message through the normal send path, then
    /// drops its row. Bounded per pass. An offline peer is not an error (the
    /// send path queues to the outbox); a genuine error is permanent (group
    /// gone, no send permission), so the one-shot row is dropped rather than
    /// retried forever. Returns the number actually sent.
    pub fn fire_due_scheduled(&self, now_ms: u64) -> Result<usize, NodeError> {
        let due = self.with_db(|db| Ok(db.scheduled_due(now_ms, FIRE_BATCH)?))?;
        let mut sent = 0usize;
        for m in due {
            match self.send_scheduled(&m) {
                Ok(()) => sent += 1,
                Err(e) => tracing::debug!(erreur = %e, "programmé : envoi abandonné"),
            }
            self.with_db(|db| Ok(db.delete_scheduled(&m.id)?))?;
        }
        Ok(sent)
    }

    fn send_scheduled(&self, m: &ScheduledMessage) -> Result<(), NodeError> {
        match m.scope.as_str() {
            "dm" => {
                let peer: [u8; 32] = m
                    .scope_id
                    .clone()
                    .try_into()
                    .map_err(|_| NodeError::Invalid("scope_id de DM programmé invalide"))?;
                self.dm_send(&peer, &m.body, None)?;
                Ok(())
            }
            "group" => {
                let gid: [u8; 16] = m
                    .scope_id
                    .clone()
                    .try_into()
                    .map_err(|_| NodeError::Invalid("scope_id de groupe programmé invalide"))?;
                let cid = m.channel_id.ok_or(NodeError::Invalid(
                    "channel_id de groupe programmé manquant",
                ))?;
                self.group_send(&gid, &cid, &m.body)?;
                Ok(())
            }
            _ => Err(NodeError::Invalid("scope de message programmé inconnu")),
        }
    }

    fn check_horizon(&self, fire_at: u64) -> Result<(), NodeError> {
        if fire_at > now_ms().saturating_add(MAX_SCHEDULE_HORIZON_MS) {
            return Err(NodeError::Invalid("date d'envoi trop lointaine (max 1 an)"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use accord_core::db::Db;
    use accord_crypto::Identity;

    use super::*;
    use crate::outbound::OutboundSink;

    fn node() -> Node {
        let id = Identity::generate_with_pow_bits(1);
        let db = Db::open_in_memory(&[1u8; 32]).unwrap();
        Node::new(id, db, OutboundSink::null())
    }

    #[test]
    fn schedule_rejects_empty_body_and_far_horizon() {
        let n = node();
        let peer = [9u8; 32];
        assert!(n.schedule_dm(&peer, "   ", 1).is_err());
        assert!(n
            .schedule_dm(&peer, "hi", now_ms() + MAX_SCHEDULE_HORIZON_MS + 10_000)
            .is_err());
    }

    #[test]
    fn cancel_and_reschedule_report_unknown_ids() {
        let n = node();
        assert!(matches!(
            n.scheduled_cancel(&[0; 16]),
            Err(NodeError::NotFound(_))
        ));
        assert!(matches!(
            n.scheduled_reschedule(&[0; 16], 1),
            Err(NodeError::NotFound(_))
        ));
    }

    #[test]
    fn fires_only_due_messages_through_send_path_and_drops_them() {
        let n = node();
        // The send path requires an established friend.
        let peer_id = Identity::generate_with_pow_bits(1);
        let peer = peer_id.public_key();
        n.friend_request(&peer, "Pair").unwrap();
        n.ingest_core(
            &peer,
            accord_proto::core_msg::CoreMsg::FriendResponse { accepted: true },
        )
        .unwrap();
        // One due (past), one not due (future).
        let due_id = n.schedule_dm(&peer, "due now", 1_000).unwrap();
        n.schedule_dm(&peer, "later", now_ms() + 60_000).unwrap();
        // Fire at a time past the first but before the second.
        assert_eq!(n.fire_due_scheduled(2_000).unwrap(), 1);
        // The due message was actually sent (persisted as our outgoing DM);
        // the not-yet-due one was not.
        let history = n.dm_history(&peer, u64::MAX, 50).unwrap();
        assert_eq!(history.len(), 1);
        // The due row is gone; the future one remains.
        let remaining = n.scheduled_messages().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].body, "later");
        // The fired id is no longer cancellable.
        let due_bytes = hex::decode::<16>(&due_id).unwrap();
        assert!(n.scheduled_cancel(&due_bytes).is_err());
    }
}
