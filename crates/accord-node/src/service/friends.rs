//! Méthodes `friends.*` et `search.query` : contacts, demandes d'amis,
//! blocage, résolution de codes amis et recherche locale.

use accord_crypto::FriendCode;
use serde_json::{json, Value};

use crate::error::NodeError;
use crate::hex;
use crate::node::Node;

use super::helpers::{contact_json, param_peer, param_str};
use super::NodeService;

impl NodeService {
    /// `friends.resolve` : code ami → clé publique (lookup DHT vérifié).
    pub(super) async fn resolve_code(&self, params: &Value) -> Result<Value, NodeError> {
        let raw = param_str(params, "friend_code")?;
        let code = FriendCode::parse(raw).map_err(|_| NodeError::Invalid("code ami invalide"))?;
        let resolver = self
            .resolver
            .as_ref()
            .ok_or(NodeError::NotFound("résolution réseau indisponible"))?;
        let pubkey = resolver.resolve(&code).await?;
        Ok(json!({ "pubkey": hex::encode(&pubkey) }))
    }
}

/// Aiguille les méthodes `friends.*` (hors `friends.resolve`, asynchrone) et
/// `search.query` vers le nœud.
pub(super) fn dispatch(node: &Node, method: &str, params: &Value) -> Result<Value, NodeError> {
    match method {
        "friends.list" => Ok(json!({
            "contacts": node
                .contacts()?
                .iter()
                .map(|c| {
                    let mut v = contact_json(c);
                    // Profil public annoncé par le pair (D-027, D-032) :
                    // bio + avatar + bannière.
                    let (bio, avatar, banner) = node.peer_public_profile(&c.node_id)?;
                    v["bio"] = json!(bio);
                    v["avatar"] = json!(avatar.map(|h| hex::encode(&h)));
                    v["banner"] = json!(banner.map(|h| hex::encode(&h)));
                    // Présence (best-effort) et non-lus de la conversation.
                    v["online"] = json!(node.is_online(&c.pubkey));
                    v["unread"] = json!(node.dm_unread(&c.pubkey)?);
                    Ok(v)
                })
                .collect::<Result<Vec<_>, NodeError>>()?
        })),
        "friends.request" => {
            let peer = param_peer(params)?;
            let name = param_str(params, "display_name").unwrap_or("");
            node.friend_request(&peer, name)?;
            Ok(json!({ "ok": true }))
        }
        "friends.respond" => {
            let peer = param_peer(params)?;
            let accept = params
                .get("accept")
                .and_then(Value::as_bool)
                .ok_or(NodeError::Invalid("accept booléen requis"))?;
            node.friend_respond(&peer, accept)?;
            Ok(json!({ "ok": true }))
        }
        "friends.block" => {
            node.friend_block(&param_peer(params)?)?;
            Ok(json!({ "ok": true }))
        }
        "friends.unblock" => {
            node.friend_unblock(&param_peer(params)?)?;
            Ok(json!({ "ok": true }))
        }
        "search.query" => {
            let q = param_str(params, "query")?;
            Ok(json!({ "msg_ids": node.search(q)? }))
        }
        _ => Err(NodeError::Invalid("méthode inconnue")),
    }
}
