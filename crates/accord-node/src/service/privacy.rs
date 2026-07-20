//! `privacy.*` methods (Lot E3): read-only privacy dashboard report.

use serde_json::{json, Value};

use crate::error::NodeError;
use crate::node::Node;

/// Routes the `privacy.*` methods to the node.
pub(super) fn dispatch(node: &Node, method: &str, _params: &Value) -> Result<Value, NodeError> {
    match method {
        "privacy.report" => {
            let report = node.privacy_report()?;
            Ok(serde_json::to_value(report).unwrap_or_else(|_| json!({})))
        }
        _ => Err(NodeError::Invalid("méthode inconnue")),
    }
}
