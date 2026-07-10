//! Types JSON-RPC 2.0 (requêtes, réponses, erreurs, notifications).
//!
//! Sous-ensemble strict de la spécification : requêtes unitaires (pas de
//! lots), identifiants numériques ou chaînes, notifications serveur → client
//! pour les événements temps réel.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Code d'erreur : JSON invalide.
pub const PARSE_ERROR: i64 = -32700;
/// Code d'erreur : requête malformée.
pub const INVALID_REQUEST: i64 = -32600;
/// Code d'erreur : méthode inconnue.
pub const METHOD_NOT_FOUND: i64 = -32601;
/// Code d'erreur : paramètres invalides.
pub const INVALID_PARAMS: i64 = -32602;
/// Code d'erreur : erreur applicative du nœud.
pub const APP_ERROR: i64 = -32000;
/// Code d'erreur : jeton d'authentification absent ou invalide.
pub const UNAUTHORIZED: i64 = -32001;

/// Requête JSON-RPC 2.0 entrante.
#[derive(Debug, Clone, Deserialize)]
pub struct RpcRequest {
    /// Doit valoir `"2.0"`.
    pub jsonrpc: String,
    /// Identifiant de corrélation (absent pour une notification client).
    #[serde(default)]
    pub id: Option<Value>,
    /// Nom de méthode (`domaine.action`).
    pub method: String,
    /// Paramètres nommés.
    #[serde(default)]
    pub params: Value,
}

impl RpcRequest {
    /// Valide la structure minimale d'une requête.
    pub fn is_well_formed(&self) -> bool {
        self.jsonrpc == "2.0"
            && !self.method.is_empty()
            && match &self.id {
                None => true,
                Some(Value::Number(_) | Value::String(_) | Value::Null) => true,
                Some(_) => false,
            }
    }
}

/// Erreur JSON-RPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    /// Code numérique (voir constantes du module).
    pub code: i64,
    /// Message lisible (français, sans données sensibles).
    pub message: String,
}

impl RpcError {
    /// Construit une erreur.
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Erreur applicative (code -32000).
    pub fn app(message: impl Into<String>) -> Self {
        Self::new(APP_ERROR, message)
    }

    /// Paramètres invalides (code -32602).
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(INVALID_PARAMS, message)
    }
}

/// Réponse JSON-RPC 2.0 sortante.
#[derive(Debug, Clone, Serialize)]
pub struct RpcResponse {
    /// Toujours `"2.0"`.
    pub jsonrpc: &'static str,
    /// Identifiant de la requête corrélée.
    pub id: Value,
    /// Résultat en cas de succès.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Erreur en cas d'échec.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl RpcResponse {
    /// Réponse de succès.
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Réponse d'erreur.
    pub fn err(id: Value, error: RpcError) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(error),
        }
    }
}

/// Notification serveur → client (événement temps réel, sans `id`).
#[derive(Debug, Clone, Serialize)]
pub struct RpcNotification {
    /// Toujours `"2.0"`.
    pub jsonrpc: &'static str,
    /// Nom d'événement (`event.*`).
    pub method: String,
    /// Charge utile de l'événement.
    pub params: Value,
}

impl RpcNotification {
    /// Construit une notification d'événement.
    pub fn new(method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            method: method.into(),
            params,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_parses_and_validates() {
        let r: RpcRequest =
            serde_json::from_str(r#"{"jsonrpc":"2.0","id":1,"method":"a.b","params":{}}"#).unwrap();
        assert!(r.is_well_formed());
        let bad: RpcRequest =
            serde_json::from_str(r#"{"jsonrpc":"1.0","id":1,"method":"a.b"}"#).unwrap();
        assert!(!bad.is_well_formed());
        let bad_id: RpcRequest =
            serde_json::from_str(r#"{"jsonrpc":"2.0","id":[1],"method":"a.b"}"#).unwrap();
        assert!(!bad_id.is_well_formed());
    }

    #[test]
    fn responses_serialize_exclusively() {
        let ok = serde_json::to_value(RpcResponse::ok(json!(1), json!({"x": 2}))).unwrap();
        assert_eq!(ok["result"]["x"], 2);
        assert!(ok.get("error").is_none());
        let err = serde_json::to_value(RpcResponse::err(
            json!(1),
            RpcError::new(METHOD_NOT_FOUND, "inconnue"),
        ))
        .unwrap();
        assert_eq!(err["error"]["code"], METHOD_NOT_FOUND);
        assert!(err.get("result").is_none());
    }
}
