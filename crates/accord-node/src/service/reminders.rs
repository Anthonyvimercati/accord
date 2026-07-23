//! `reminders.*` methods (Lot F2): add, list and dismiss local reminders.

use accord_core::db::Reminder;
use serde_json::{json, Value};

use crate::error::NodeError;
use crate::hex;
use crate::node::Node;

use super::helpers::{param_opt_str, param_str};

fn reminder_json(r: &Reminder) -> Value {
    json!({
        "id": hex::encode(&r.id),
        "scope": r.scope,
        "scope_id": hex::encode(&r.scope_id),
        "msg_ref": r.msg_ref.map(|m| hex::encode(&m)),
        "note": r.note,
        "fire_at": r.fire_at,
        "fired": r.fired_at.is_some(),
        "created_at": r.created_at,
    })
}

/// Decodes `scope_id` against `scope`: 32-byte peer key for a DM, 16-byte group
/// id for a group.
fn param_scope_id(scope: &str, params: &Value) -> Result<Vec<u8>, NodeError> {
    let raw = param_str(params, "scope_id")?;
    let bytes = match scope {
        "dm" => hex::decode::<32>(raw).map(|a| a.to_vec()),
        "group" => hex::decode::<16>(raw).map(|a| a.to_vec()),
        _ => None,
    };
    bytes.ok_or(NodeError::Invalid("scope ou scope_id de rappel invalide"))
}

/// Routes the `reminders.*` methods to the node.
pub(super) fn dispatch(node: &Node, method: &str, params: &Value) -> Result<Value, NodeError> {
    match method {
        "reminders.add" => {
            let scope = param_str(params, "scope")?;
            let scope_id = param_scope_id(scope, params)?;
            let msg_ref = params
                .get("msg_ref")
                .and_then(Value::as_str)
                .and_then(hex::decode::<16>);
            let note = param_opt_str(params, "note")?.unwrap_or("");
            let fire_at = params
                .get("fire_at")
                .and_then(Value::as_u64)
                .ok_or(NodeError::Invalid("fire_at (ms) requis"))?;
            let id = node.reminder_add(scope, scope_id, msg_ref, note, fire_at)?;
            Ok(json!({ "id": id }))
        }
        "reminders.list" => {
            let items: Vec<Value> = node.reminders()?.iter().map(reminder_json).collect();
            Ok(json!({ "reminders": items }))
        }
        "reminders.dismiss" => {
            let id = super::helpers::param_id16(params, "id")?;
            node.reminder_dismiss(&id)?;
            Ok(json!({ "ok": true }))
        }
        _ => Err(NodeError::Invalid("méthode inconnue")),
    }
}
