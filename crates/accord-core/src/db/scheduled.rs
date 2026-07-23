//! Scheduled messages (Lot F1): a composed message persisted with a firing
//! time and sent LOCALLY when due. No wire negotiation and no new message
//! format — the maintenance loop routes a due row through the ordinary send
//! path (the outbox already covers offline peers), then deletes it.

use super::Db;
use crate::error::CoreError;
use rusqlite::params;

/// A message queued for deferred local delivery.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledMessage {
    /// Random 16-byte identifier (cancel / reschedule handle).
    pub id: [u8; 16],
    /// `"dm"` or `"group"`.
    pub scope: String,
    /// Peer public key (32 bytes) for a DM, group id (16 bytes) for a group.
    pub scope_id: Vec<u8>,
    /// Group channel id (16 bytes); `None` for a DM.
    pub channel_id: Option<[u8; 16]>,
    /// Message text.
    pub body: String,
    /// Wall-clock firing time in milliseconds.
    pub fire_at: u64,
    /// Wall-clock creation time in milliseconds.
    pub created_at: u64,
}

/// Columns selected for a [`ScheduledMessage`], in struct order.
const COLS: &str = "id, scope, scope_id, channel_id, body, fire_at, created_at";

impl Db {
    /// Persists a scheduled message.
    pub fn insert_scheduled(&self, m: &ScheduledMessage) -> Result<(), CoreError> {
        self.conn().execute(
            "INSERT INTO scheduled_messages (id, scope, scope_id, channel_id, body, fire_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                m.id.to_vec(),
                m.scope,
                m.scope_id,
                m.channel_id.map(|c| c.to_vec()),
                m.body,
                clamp_i64(m.fire_at),
                clamp_i64(m.created_at),
            ],
        )?;
        Ok(())
    }

    /// Messages whose firing time has passed, oldest first, at most `limit`.
    pub fn scheduled_due(
        &self,
        now_ms: u64,
        limit: usize,
    ) -> Result<Vec<ScheduledMessage>, CoreError> {
        self.query_scheduled(
            &format!(
                "SELECT {COLS} FROM scheduled_messages
                 WHERE fire_at <= ?1 ORDER BY fire_at ASC LIMIT ?2"
            ),
            params![clamp_i64(now_ms), limit as i64],
        )
    }

    /// Every scheduled message, soonest first.
    pub fn scheduled_all(&self) -> Result<Vec<ScheduledMessage>, CoreError> {
        self.query_scheduled(
            &format!("SELECT {COLS} FROM scheduled_messages ORDER BY fire_at ASC"),
            [],
        )
    }

    /// Removes a scheduled message. Returns `true` when a row was deleted.
    pub fn delete_scheduled(&self, id: &[u8; 16]) -> Result<bool, CoreError> {
        let n = self.conn().execute(
            "DELETE FROM scheduled_messages WHERE id = ?1",
            [id.to_vec()],
        )?;
        Ok(n > 0)
    }

    /// Moves a scheduled message to a new firing time. Returns `true` when the
    /// message exists.
    pub fn reschedule_scheduled(&self, id: &[u8; 16], fire_at: u64) -> Result<bool, CoreError> {
        let n = self.conn().execute(
            "UPDATE scheduled_messages SET fire_at = ?2 WHERE id = ?1",
            params![id.to_vec(), clamp_i64(fire_at)],
        )?;
        Ok(n > 0)
    }

    fn query_scheduled(
        &self,
        sql: &str,
        args: impl rusqlite::Params,
    ) -> Result<Vec<ScheduledMessage>, CoreError> {
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
                    r.get::<_, i64>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .filter_map(
                |(id, scope, scope_id, channel_id, body, fire_at, created_at)| {
                    Some(ScheduledMessage {
                        id: id.try_into().ok()?,
                        scope,
                        scope_id,
                        channel_id: channel_id.and_then(|c| c.try_into().ok()),
                        body,
                        fire_at: fire_at.max(0) as u64,
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

    fn dm_msg(id: u8, fire_at: u64) -> ScheduledMessage {
        ScheduledMessage {
            id: [id; 16],
            scope: "dm".into(),
            scope_id: vec![9u8; 32],
            channel_id: None,
            body: "later".into(),
            fire_at,
            created_at: 1,
        }
    }

    #[test]
    fn insert_list_reschedule_and_delete_roundtrip() {
        let db = db();
        db.insert_scheduled(&dm_msg(1, 5_000)).unwrap();
        db.insert_scheduled(&dm_msg(2, 1_000)).unwrap();
        // Soonest first.
        let all = db.scheduled_all().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, [2; 16]);
        assert_eq!(all[1].id, [1; 16]);
        // Reschedule moves ordering.
        assert!(db.reschedule_scheduled(&[2; 16], 9_000).unwrap());
        assert_eq!(db.scheduled_all().unwrap()[0].id, [1; 16]);
        // Unknown id: no-op.
        assert!(!db.reschedule_scheduled(&[7; 16], 0).unwrap());
        assert!(db.delete_scheduled(&[1; 16]).unwrap());
        assert!(!db.delete_scheduled(&[1; 16]).unwrap());
        assert_eq!(db.scheduled_all().unwrap().len(), 1);
    }

    #[test]
    fn due_selects_only_past_firing_times_and_is_bounded() {
        let db = db();
        db.insert_scheduled(&dm_msg(1, 1_000)).unwrap();
        db.insert_scheduled(&dm_msg(2, 2_000)).unwrap();
        db.insert_scheduled(&dm_msg(3, 9_000)).unwrap();
        // Only the two past-due, oldest first.
        let due = db.scheduled_due(5_000, 100).unwrap();
        assert_eq!(
            due.iter().map(|m| m.id).collect::<Vec<_>>(),
            vec![[1; 16], [2; 16]]
        );
        // Bounded per pass.
        assert_eq!(db.scheduled_due(5_000, 1).unwrap().len(), 1);
        // Nothing due yet.
        assert!(db.scheduled_due(500, 100).unwrap().is_empty());
    }

    #[test]
    fn group_channel_id_roundtrips() {
        let db = db();
        let m = ScheduledMessage {
            id: [4; 16],
            scope: "group".into(),
            scope_id: vec![7u8; 16],
            channel_id: Some([8; 16]),
            body: "gm".into(),
            fire_at: 1,
            created_at: 1,
        };
        db.insert_scheduled(&m).unwrap();
        assert_eq!(db.scheduled_all().unwrap()[0], m);
    }
}
