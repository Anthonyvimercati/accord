//! Reminders (Lot F2): a local note pinned on a message that fires at a chosen
//! time. Purely local — a due reminder emits `event.reminder` once (`fired_at`
//! is stamped so it never re-fires); the user dismisses it afterwards (the row
//! is removed). No wire negotiation, no network message.

use super::Db;
use crate::error::CoreError;
use rusqlite::params;

/// A reminder awaiting or past its firing time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reminder {
    /// Random 16-byte identifier (dismiss handle).
    pub id: [u8; 16],
    /// `"dm"` or `"group"`.
    pub scope: String,
    /// Peer public key (32 bytes) for a DM, group id (16 bytes) for a group.
    pub scope_id: Vec<u8>,
    /// Referenced message id (16 bytes); `None` for a free-standing reminder.
    pub msg_ref: Option<[u8; 16]>,
    /// Free-text note.
    pub note: String,
    /// Wall-clock firing time in milliseconds.
    pub fire_at: u64,
    /// Wall-clock time the reminder fired, or `None` while still pending.
    pub fired_at: Option<u64>,
    /// Wall-clock creation time in milliseconds.
    pub created_at: u64,
}

/// Columns selected for a [`Reminder`], in struct order.
const COLS: &str = "id, scope, scope_id, msg_ref, note, fire_at, fired_at, created_at";

impl Db {
    /// Persists a reminder (pending: `fired_at` is `None`).
    pub fn insert_reminder(&self, r: &Reminder) -> Result<(), CoreError> {
        self.conn().execute(
            "INSERT INTO reminders (id, scope, scope_id, msg_ref, note, fire_at, fired_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                r.id.to_vec(),
                r.scope,
                r.scope_id,
                r.msg_ref.map(|m| m.to_vec()),
                r.note,
                clamp_i64(r.fire_at),
                r.fired_at.map(clamp_i64),
                clamp_i64(r.created_at),
            ],
        )?;
        Ok(())
    }

    /// Pending reminders whose firing time has passed, oldest first, at most
    /// `limit`.
    pub fn reminders_due_pending(
        &self,
        now_ms: u64,
        limit: usize,
    ) -> Result<Vec<Reminder>, CoreError> {
        self.query_reminders(
            &format!(
                "SELECT {COLS} FROM reminders
                 WHERE fired_at IS NULL AND fire_at <= ?1 ORDER BY fire_at ASC LIMIT ?2"
            ),
            params![clamp_i64(now_ms), limit as i64],
        )
    }

    /// Every reminder (pending and fired), soonest first.
    pub fn reminders_all(&self) -> Result<Vec<Reminder>, CoreError> {
        self.query_reminders(
            &format!("SELECT {COLS} FROM reminders ORDER BY fire_at ASC"),
            [],
        )
    }

    /// Stamps a reminder as fired. Only a pending reminder transitions, so the
    /// returned count is 1 exactly once — the caller emits the event only then.
    pub fn mark_reminder_fired(&self, id: &[u8; 16], fired_at: u64) -> Result<bool, CoreError> {
        let n = self.conn().execute(
            "UPDATE reminders SET fired_at = ?2 WHERE id = ?1 AND fired_at IS NULL",
            params![id.to_vec(), clamp_i64(fired_at)],
        )?;
        Ok(n > 0)
    }

    /// Removes a reminder (dismiss). Returns `true` when a row was deleted.
    pub fn delete_reminder(&self, id: &[u8; 16]) -> Result<bool, CoreError> {
        let n = self
            .conn()
            .execute("DELETE FROM reminders WHERE id = ?1", [id.to_vec()])?;
        Ok(n > 0)
    }

    fn query_reminders(
        &self,
        sql: &str,
        args: impl rusqlite::Params,
    ) -> Result<Vec<Reminder>, CoreError> {
        let mut stmt = self.conn().prepare(sql)?;
        let rows = stmt
            .query_map(args, |r| {
                Ok((
                    r.get::<_, Vec<u8>>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                    r.get::<_, Option<Vec<u8>>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, Option<i64>>(6)?,
                    r.get::<_, i64>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .filter_map(
                |(id, scope, scope_id, msg_ref, note, fire_at, fired_at, created_at)| {
                    Some(Reminder {
                        id: id.try_into().ok()?,
                        scope,
                        scope_id,
                        msg_ref: msg_ref.and_then(|m| m.try_into().ok()),
                        note,
                        fire_at: fire_at.max(0) as u64,
                        fired_at: fired_at.map(|v| v.max(0) as u64),
                        created_at: created_at.max(0) as u64,
                    })
                },
            )
            .collect())
    }
}

/// Clamps a `u64` timestamp into SQLite's signed range without overflow.
fn clamp_i64(v: u64) -> i64 {
    v.min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Db {
        Db::open_in_memory(&[1; 32]).unwrap()
    }

    fn reminder(id: u8, fire_at: u64) -> Reminder {
        Reminder {
            id: [id; 16],
            scope: "dm".into(),
            scope_id: vec![9u8; 32],
            msg_ref: Some([id; 16]),
            note: "ping".into(),
            fire_at,
            fired_at: None,
            created_at: 1,
        }
    }

    #[test]
    fn insert_list_and_dismiss_roundtrip() {
        let db = db();
        db.insert_reminder(&reminder(1, 5_000)).unwrap();
        db.insert_reminder(&reminder(2, 1_000)).unwrap();
        let all = db.reminders_all().unwrap();
        assert_eq!(
            all.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![[2; 16], [1; 16]]
        );
        assert!(db.delete_reminder(&[1; 16]).unwrap());
        assert!(!db.delete_reminder(&[1; 16]).unwrap());
        assert_eq!(db.reminders_all().unwrap().len(), 1);
    }

    #[test]
    fn due_pending_fires_once_then_excluded() {
        let db = db();
        db.insert_reminder(&reminder(1, 1_000)).unwrap();
        db.insert_reminder(&reminder(2, 9_000)).unwrap();
        let due = db.reminders_due_pending(5_000, 100).unwrap();
        assert_eq!(due.iter().map(|r| r.id).collect::<Vec<_>>(), vec![[1; 16]]);
        // First mark transitions, second is a no-op (single fire).
        assert!(db.mark_reminder_fired(&[1; 16], 5_000).unwrap());
        assert!(!db.mark_reminder_fired(&[1; 16], 6_000).unwrap());
        // No longer pending.
        assert!(db.reminders_due_pending(5_000, 100).unwrap().is_empty());
        // Still visible in the list, now stamped fired.
        let fired = db
            .reminders_all()
            .unwrap()
            .into_iter()
            .find(|r| r.id == [1; 16])
            .unwrap();
        assert_eq!(fired.fired_at, Some(5_000));
    }

    #[test]
    fn bounded_per_pass() {
        let db = db();
        for i in 0..4u8 {
            db.insert_reminder(&reminder(i + 1, 100)).unwrap();
        }
        assert_eq!(db.reminders_due_pending(1_000, 2).unwrap().len(), 2);
    }
}
