//! Reminders (Lot F2): node-side add / list / dismiss and firing.
//!
//! Purely local. A due reminder emits `event.reminder` exactly once — the
//! firing pass stamps `fired_at` in the same DB transaction that decides to
//! emit, so a restart mid-pass never double-fires. No wire byte.

use accord_core::db::Reminder;
use accord_core::group::new_id16;
use serde_json::json;

use crate::error::NodeError;
use crate::hex;

use super::{now_ms, Node};

/// Furthest a reminder may be set into the future: one year.
pub const MAX_REMINDER_HORIZON_MS: u64 = 365 * 24 * 3600 * 1000;

/// Longest accepted note, in characters.
pub const MAX_REMINDER_NOTE_CHARS: usize = 500;

/// Reminders fired per pass: bounds one pass on a large backlog.
const FIRE_BATCH: usize = 64;

impl Node {
    /// Adds a reminder. `scope` is `"dm"` or `"group"`; `scope_id` must be the
    /// peer public key (32 bytes) or group id (16 bytes) accordingly.
    /// Returns the new reminder id (hex).
    pub fn reminder_add(
        &self,
        scope: &str,
        scope_id: Vec<u8>,
        msg_ref: Option<[u8; 16]>,
        note: &str,
        fire_at: u64,
    ) -> Result<String, NodeError> {
        match (scope, scope_id.len()) {
            ("dm", 32) | ("group", 16) => {}
            _ => return Err(NodeError::Invalid("scope ou scope_id de rappel invalide")),
        }
        if note.chars().count() > MAX_REMINDER_NOTE_CHARS {
            return Err(NodeError::Invalid("note de rappel trop longue (max 500)"));
        }
        if fire_at > now_ms().saturating_add(MAX_REMINDER_HORIZON_MS) {
            return Err(NodeError::Invalid(
                "échéance de rappel trop lointaine (max 1 an)",
            ));
        }
        let id = new_id16();
        let r = Reminder {
            id,
            scope: scope.to_string(),
            scope_id,
            msg_ref,
            note: note.to_string(),
            fire_at,
            fired_at: None,
            created_at: now_ms(),
        };
        self.with_db(|db| Ok(db.insert_reminder(&r)?))?;
        Ok(hex::encode(&id))
    }

    /// Every reminder (pending and fired), soonest first.
    pub fn reminders(&self) -> Result<Vec<Reminder>, NodeError> {
        self.with_db(|db| Ok(db.reminders_all()?))
    }

    /// Dismisses (removes) a reminder. `NotFound` when the id is unknown.
    pub fn reminder_dismiss(&self, id: &[u8; 16]) -> Result<(), NodeError> {
        if self.with_db(|db| Ok(db.delete_reminder(id)?))? {
            Ok(())
        } else {
            Err(NodeError::NotFound("rappel inconnu"))
        }
    }

    /// Emits `event.reminder` for every due, still-pending reminder, marking
    /// each fired so it never re-fires. Bounded per pass. Returns the count.
    pub fn fire_due_reminders(&self, now_ms: u64) -> Result<usize, NodeError> {
        let due = self.with_db(|db| Ok(db.reminders_due_pending(now_ms, FIRE_BATCH)?))?;
        let mut fired = 0usize;
        for r in due {
            // The transition is the single source of truth: only the pass that
            // flips `fired_at` (returns true) emits the event.
            if self.with_db(|db| Ok(db.mark_reminder_fired(&r.id, now_ms)?))? {
                self.emit(
                    "event.reminder",
                    json!({
                        "id": hex::encode(&r.id),
                        "scope": r.scope,
                        "scope_id": hex::encode(&r.scope_id),
                        "msg_ref": r.msg_ref.map(|m| hex::encode(&m)),
                        "note": r.note,
                        "fire_at": r.fire_at,
                    }),
                );
                fired += 1;
            }
        }
        Ok(fired)
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
    fn add_validates_scope_and_note() {
        let n = node();
        assert!(n.reminder_add("dm", vec![9; 32], None, "ok", 1).is_ok());
        // Wrong scope_id length for the scope.
        assert!(n.reminder_add("dm", vec![9; 16], None, "ok", 1).is_err());
        assert!(n.reminder_add("group", vec![9; 32], None, "ok", 1).is_err());
        // Over-long note.
        let long = "x".repeat(MAX_REMINDER_NOTE_CHARS + 1);
        assert!(n
            .reminder_add("group", vec![7; 16], None, &long, 1)
            .is_err());
    }

    #[test]
    fn due_reminder_fires_once_then_marked() {
        let n = node();
        n.reminder_add("dm", vec![9; 32], Some([3; 16]), "call back", 1_000)
            .unwrap();
        n.reminder_add("dm", vec![9; 32], None, "future", now_ms() + 60_000)
            .unwrap();
        // Only the past-due one fires.
        assert_eq!(n.fire_due_reminders(2_000).unwrap(), 1);
        // Re-running the pass does not re-fire it.
        assert_eq!(n.fire_due_reminders(2_000).unwrap(), 0);
        // It is still listed, now stamped fired.
        let fired = n
            .reminders()
            .unwrap()
            .into_iter()
            .find(|r| r.note == "call back")
            .unwrap();
        assert!(fired.fired_at.is_some());
    }

    #[test]
    fn dismiss_reports_unknown() {
        let n = node();
        assert!(matches!(
            n.reminder_dismiss(&[0; 16]),
            Err(NodeError::NotFound(_))
        ));
        let id = n.reminder_add("dm", vec![9; 32], None, "x", 1).unwrap();
        let bytes = hex::decode::<16>(&id).unwrap();
        assert!(n.reminder_dismiss(&bytes).is_ok());
        assert!(n.reminders().unwrap().is_empty());
    }
}
