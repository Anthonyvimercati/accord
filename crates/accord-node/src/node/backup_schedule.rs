//! Scheduled backup (Lot F3): cadence, destination and last-backup bookkeeping,
//! plus a due detector that emits `event.backup_due`.
//!
//! The node NEVER writes the archive itself: `backup::export_backup` requires a
//! STOPPED node (closed DB) and the profile passphrase, neither of which a
//! running maintenance loop holds. The proven host command (`backup_export`,
//! app/src-tauri) stops the node, re-verifies the passphrase and writes the
//! sealed `.accordbackup`. This module only schedules, detects due windows and
//! nudges the UI — purely local, zero wire byte.

use serde::Serialize;
use serde_json::json;

use crate::error::NodeError;

use super::{now_ms, Node};

const KEY_CADENCE: &str = "backup.cadence";
const KEY_DIR: &str = "backup.dir";
const KEY_LAST_AT: &str = "backup.last_at";
const KEY_NOTIFIED_AT: &str = "backup.notified_at";

/// Read-only snapshot of the backup schedule (frozen shape for the UI).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BackupStatus {
    /// `"off"`, `"weekly"` or `"monthly"`.
    pub cadence: String,
    /// Chosen destination folder, or `null` (reminder-only mode).
    pub dir: Option<String>,
    /// Wall-clock ms of the last recorded backup, or `null`.
    pub last_backup_at: Option<u64>,
    /// Wall-clock ms the next backup is due, or `null` when cadence is off.
    pub next_due_at: Option<u64>,
    /// True when a backup is currently overdue.
    pub due: bool,
}

/// Cadence period in milliseconds, or `None` for `"off"`/unknown.
fn cadence_interval_ms(cadence: &str) -> Option<u64> {
    match cadence {
        "weekly" => Some(7 * 24 * 3600 * 1000),
        "monthly" => Some(30 * 24 * 3600 * 1000),
        _ => None,
    }
}

impl Node {
    /// Sets the backup cadence and (optional) destination folder. An empty or
    /// absent `dir` means reminder-only. Enabling a cadence for the first time
    /// baselines `last_backup_at` to now, so the first nudge lands one full
    /// period later rather than immediately.
    pub fn backup_schedule(&self, cadence: &str, dir: Option<&str>) -> Result<(), NodeError> {
        if !matches!(cadence, "off" | "weekly" | "monthly") {
            return Err(NodeError::Invalid(
                "cadence inconnue (off, weekly ou monthly)",
            ));
        }
        let dir = dir.map(str::trim).filter(|d| !d.is_empty());
        self.set_str_meta(KEY_CADENCE, cadence)?;
        self.set_str_meta(KEY_DIR, dir.unwrap_or(""))?;
        if cadence_interval_ms(cadence).is_some() && self.get_u64_meta(KEY_LAST_AT)?.is_none() {
            self.set_u64_meta(KEY_LAST_AT, now_ms())?;
        }
        Ok(())
    }

    /// Current backup schedule and computed due state.
    pub fn backup_status(&self) -> Result<BackupStatus, NodeError> {
        let cadence = self
            .get_str_meta(KEY_CADENCE)?
            .unwrap_or_else(|| "off".to_string());
        let dir = self.get_str_meta(KEY_DIR)?.filter(|d| !d.is_empty());
        let last_backup_at = self.get_u64_meta(KEY_LAST_AT)?;
        let interval = cadence_interval_ms(&cadence);
        let next_due_at = match (interval, last_backup_at) {
            (Some(step), Some(last)) => Some(last.saturating_add(step)),
            (Some(_), None) => Some(now_ms()),
            (None, _) => None,
        };
        let due = next_due_at.is_some_and(|due_at| due_at <= now_ms());
        Ok(BackupStatus {
            cadence,
            dir,
            last_backup_at,
            next_due_at,
            due,
        })
    }

    /// Records that a backup just succeeded (advances `last_backup_at`). The
    /// UI calls this around a successful host export; a missing `at` uses now.
    pub fn backup_record_done(&self, at: Option<u64>) -> Result<(), NodeError> {
        self.set_u64_meta(KEY_LAST_AT, at.unwrap_or_else(now_ms))
    }

    /// Emits `event.backup_due` immediately (the UI then runs the host export
    /// path). Used by `backup.run_now`.
    pub fn backup_run_now(&self) -> Result<(), NodeError> {
        let status = self.backup_status()?;
        self.emit_backup_due(&status);
        Ok(())
    }

    /// Nudges the UI when a backup is overdue, at most once per cadence period
    /// (rate-limited via a stored notified-at). Returns whether it emitted.
    pub fn backup_check_due(&self, now_ms: u64) -> Result<bool, NodeError> {
        let status = self.backup_status()?;
        let Some(interval) = cadence_interval_ms(&status.cadence) else {
            return Ok(false);
        };
        if !status.due {
            return Ok(false);
        }
        let notified = self.get_u64_meta(KEY_NOTIFIED_AT)?;
        let quiet = notified.is_some_and(|last| now_ms.saturating_sub(last) < interval);
        if quiet {
            return Ok(false);
        }
        self.set_u64_meta(KEY_NOTIFIED_AT, now_ms)?;
        self.emit_backup_due(&status);
        Ok(true)
    }

    fn emit_backup_due(&self, status: &BackupStatus) {
        self.emit(
            "event.backup_due",
            json!({
                // A configured folder unlocks the streamlined "auto" flow (the
                // destination is pre-chosen); without one it is a plain nudge.
                "auto": status.dir.is_some(),
                "dir": status.dir,
            }),
        );
    }

    fn get_str_meta(&self, key: &str) -> Result<Option<String>, NodeError> {
        self.with_db(|db| {
            Ok(db
                .meta(key)?
                .map(|b| String::from_utf8_lossy(&b).into_owned()))
        })
    }

    fn set_str_meta(&self, key: &str, value: &str) -> Result<(), NodeError> {
        self.with_db(|db| Ok(db.set_meta(key, value.as_bytes())?))
    }

    fn get_u64_meta(&self, key: &str) -> Result<Option<u64>, NodeError> {
        Ok(self.get_str_meta(key)?.and_then(|s| s.parse::<u64>().ok()))
    }

    fn set_u64_meta(&self, key: &str, value: u64) -> Result<(), NodeError> {
        self.set_str_meta(key, &value.to_string())
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
    fn schedule_validates_cadence_and_baselines_last_backup() {
        let n = node();
        assert!(n.backup_schedule("yearly", None).is_err());
        let before = now_ms();
        n.backup_schedule("weekly", Some("/tmp/backups")).unwrap();
        let s = n.backup_status().unwrap();
        assert_eq!(s.cadence, "weekly");
        assert_eq!(s.dir.as_deref(), Some("/tmp/backups"));
        // Enabling baselines last_backup_at to ~now, so nothing is due yet.
        assert!(s.last_backup_at.unwrap() >= before);
        assert!(!s.due);
        // Off clears due entirely.
        n.backup_schedule("off", None).unwrap();
        let s = n.backup_status().unwrap();
        assert_eq!(s.cadence, "off");
        assert_eq!(s.next_due_at, None);
        assert!(!s.due);
        assert_eq!(s.dir, None);
    }

    #[test]
    fn becomes_due_after_a_period_and_record_done_clears_it() {
        let n = node();
        n.backup_schedule("weekly", None).unwrap();
        // Rewind the baseline well past one week.
        let week = 7 * 24 * 3600 * 1000u64;
        n.backup_record_done(Some(now_ms() - week - 10_000))
            .unwrap();
        assert!(n.backup_status().unwrap().due);
        // First check emits, the immediate re-check is rate-limited.
        assert!(n.backup_check_due(now_ms()).unwrap());
        assert!(!n.backup_check_due(now_ms()).unwrap());
        // Recording a fresh backup clears the due state.
        n.backup_record_done(None).unwrap();
        assert!(!n.backup_status().unwrap().due);
    }

    #[test]
    fn off_cadence_never_fires() {
        let n = node();
        n.backup_schedule("off", None).unwrap();
        assert!(!n.backup_check_due(now_ms()).unwrap());
        assert_eq!(n.backup_status().unwrap().next_due_at, None);
    }
}
