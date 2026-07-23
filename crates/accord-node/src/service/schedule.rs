//! Cross-scope `schedule.*` methods (Lot F1): list, cancel and reschedule the
//! locally scheduled messages created by `dm.schedule` / `groups.schedule`.

use accord_core::db::ScheduledMessage;
use serde_json::{json, Value};

use crate::error::NodeError;
use crate::hex;
use crate::node::Node;

/// Characters of the body surfaced in a list preview.
const PREVIEW_CHARS: usize = 80;

fn scheduled_json(m: &ScheduledMessage) -> Value {
    json!({
        "id": hex::encode(&m.id),
        "scope": m.scope,
        "scope_id": hex::encode(&m.scope_id),
        "channel_id": m.channel_id.map(|c| hex::encode(&c)),
        "fire_at": m.fire_at,
        "created_at": m.created_at,
        "preview": m.body.chars().take(PREVIEW_CHARS).collect::<String>(),
    })
}

/// Required wall-clock firing time in milliseconds.
fn param_fire_at(params: &Value) -> Result<u64, NodeError> {
    params
        .get("fire_at")
        .and_then(Value::as_u64)
        .ok_or(NodeError::Invalid("fire_at (ms) requis"))
}

/// Routes the `schedule.*` methods to the node.
pub(super) fn dispatch(node: &Node, method: &str, params: &Value) -> Result<Value, NodeError> {
    match method {
        "schedule.list" => {
            let items: Vec<Value> = node
                .scheduled_messages()?
                .iter()
                .map(scheduled_json)
                .collect();
            Ok(json!({ "scheduled": items }))
        }
        "schedule.cancel" => {
            let id = super::helpers::param_id16(params, "id")?;
            node.scheduled_cancel(&id)?;
            Ok(json!({ "ok": true }))
        }
        "schedule.reschedule" => {
            let id = super::helpers::param_id16(params, "id")?;
            node.scheduled_reschedule(&id, param_fire_at(params)?)?;
            Ok(json!({ "ok": true }))
        }
        _ => Err(NodeError::Invalid("méthode inconnue")),
    }
}

/// Required wall-clock firing time (shared by `dm.schedule`/`groups.schedule`).
pub(super) fn param_fire_at_ms(params: &Value) -> Result<u64, NodeError> {
    param_fire_at(params)
}
