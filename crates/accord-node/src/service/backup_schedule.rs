//! `backup.*` methods (Lot F3): schedule settings, status and manual trigger.
//!
//! The node only schedules and detects due windows; the archive is written by
//! the host `backup_export` command (stopped node + passphrase). `run_now`
//! re-emits `event.backup_due` so the UI runs that path immediately.

use serde_json::{json, Value};

use crate::error::NodeError;
use crate::node::Node;

use super::helpers::{param_opt_str, param_str};

/// Routes the `backup.*` methods to the node.
pub(super) fn dispatch(node: &Node, method: &str, params: &Value) -> Result<Value, NodeError> {
    match method {
        "backup.schedule" => {
            let cadence = param_str(params, "cadence")?;
            let dir = param_opt_str(params, "dir")?;
            node.backup_schedule(cadence, dir)?;
            Ok(json!({ "ok": true }))
        }
        "backup.status" => {
            let status = node.backup_status()?;
            Ok(serde_json::to_value(status).unwrap_or_else(|_| json!({})))
        }
        "backup.record_done" => {
            let at = params.get("at").and_then(Value::as_u64);
            node.backup_record_done(at)?;
            Ok(json!({ "ok": true }))
        }
        "backup.run_now" => {
            node.backup_run_now()?;
            Ok(json!({ "ok": true }))
        }
        _ => Err(NodeError::Invalid("méthode inconnue")),
    }
}
