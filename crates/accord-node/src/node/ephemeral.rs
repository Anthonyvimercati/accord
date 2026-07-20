//! Disappearing messages (Lot E2): per-conversation TTL honoured locally.
//! No wire negotiation, no control message — the timer only trims THIS
//! device's store (see `accord_core::db` `conversation_ephemeral`).

use crate::error::NodeError;

use super::{now_ms, Node};

/// Lowest accepted timer: below one minute the purge cadence (minutes)
/// makes the setting meaningless.
pub const MIN_EPHEMERAL_TTL_SECS: u64 = 60;

/// Highest accepted timer: one year.
pub const MAX_EPHEMERAL_TTL_SECS: u64 = 365 * 24 * 3600;

/// Messages deleted per conversation per purge pass: keeps a single pass
/// bounded on a huge backlog (the next pass finishes the job).
const PURGE_BATCH_PER_SCOPE: usize = 512;

impl Node {
    /// Sets or clears (`None`) the disappearing-message timer of a
    /// conversation. `scope`: peer public key (DM) or group id.
    pub fn set_conversation_ephemeral(
        &self,
        scope: &[u8],
        ttl_secs: Option<u64>,
    ) -> Result<(), NodeError> {
        if let Some(ttl) = ttl_secs {
            if !(MIN_EPHEMERAL_TTL_SECS..=MAX_EPHEMERAL_TTL_SECS).contains(&ttl) {
                return Err(NodeError::Invalid(
                    "ttl_secs hors bornes (60 s à 365 jours), ou null pour désactiver",
                ));
            }
        }
        self.with_db(|db| Ok(db.set_conversation_ttl(scope, ttl_secs)?))
    }

    /// Current timer of a conversation (`None` = disabled).
    pub fn conversation_ephemeral(&self, scope: &[u8]) -> Result<Option<u64>, NodeError> {
        self.with_db(|db| Ok(db.conversation_ttl(scope)?))
    }

    /// One bounded purge pass over every timed conversation. Returns the
    /// number of deleted messages. Called at startup and periodically by the
    /// maintenance loop; safe to call at any time.
    pub fn purge_ephemeral(&self) -> Result<u64, NodeError> {
        self.with_db(|db| Ok(db.purge_ephemeral(now_ms(), PURGE_BATCH_PER_SCOPE)?))
    }
}

#[cfg(test)]
mod tests {
    use accord_core::db::{Db, DmRecord};
    use accord_crypto::Identity;

    use super::*;
    use crate::outbound::OutboundSink;

    fn node() -> Node {
        let id = Identity::generate_with_pow_bits(1);
        let db = Db::open_in_memory(&[1u8; 32]).unwrap();
        Node::new(id, db, OutboundSink::null())
    }

    #[test]
    fn ttl_bounds_are_enforced_at_the_node_boundary() {
        let n = node();
        let peer = [9u8; 32];
        assert!(n.set_conversation_ephemeral(&peer, Some(0)).is_err());
        assert!(n.set_conversation_ephemeral(&peer, Some(59)).is_err());
        assert!(n
            .set_conversation_ephemeral(&peer, Some(MAX_EPHEMERAL_TTL_SECS + 1))
            .is_err());
        assert_eq!(n.conversation_ephemeral(&peer).unwrap(), None);
        n.set_conversation_ephemeral(&peer, Some(3600)).unwrap();
        assert_eq!(n.conversation_ephemeral(&peer).unwrap(), Some(3600));
        n.set_conversation_ephemeral(&peer, None).unwrap();
        assert_eq!(n.conversation_ephemeral(&peer).unwrap(), None);
    }

    #[test]
    fn purge_deletes_expired_and_keeps_recent() {
        let n = node();
        let peer = [9u8; 32];
        n.set_conversation_ephemeral(&peer, Some(3600)).unwrap();
        let dm = |id: u8, sent_ms: u64| DmRecord {
            msg_id: [id; 16],
            peer,
            author: peer,
            lamport: id as u64,
            sent_ms,
            kind: 0,
            body: b"corps".to_vec(),
            acked: false,
            deleted: false,
            edited: None,
        };
        n.with_db(|db| {
            db.insert_dm(&dm(1, 1))?;
            db.insert_dm(&dm(2, now_ms()))?;
            Ok(())
        })
        .unwrap();
        assert_eq!(n.purge_ephemeral().unwrap(), 1);
        n.with_db(|db| {
            assert!(db.dm_message(&[1; 16])?.is_none());
            assert!(db.dm_message(&[2; 16])?.is_some());
            Ok(())
        })
        .unwrap();
    }
}
