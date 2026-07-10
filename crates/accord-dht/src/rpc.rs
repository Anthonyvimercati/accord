//! Abstraction d'envoi de RPC DHT, et validation Sybil des NodeInfo reçus.

use accord_crypto::identity::node_id_of;
use accord_crypto::verify_pow;
use accord_proto::dht_msg::DhtBody;
use accord_proto::types::{NodeId, NodeInfo};
use async_trait::async_trait;

/// Envoi de RPC DHT vers un pair, avec corrélation et timeout gérés par
/// l'implémentation. Rend `None` en cas de non-réponse (timeout épuisé).
#[async_trait]
pub trait DhtRpc: Send + Sync {
    /// Envoie `body` à `to` et attend la réponse (ou `None` au timeout).
    async fn send_rpc(&self, to: &NodeInfo, body: DhtBody) -> Option<DhtBody>;

    /// Identifiant local.
    fn local_id(&self) -> NodeId;
}

/// Valide un NodeInfo reçu du réseau : cohérence `node_id == SHA-256(pubkey)`
/// et preuve de travail suffisante (barrière anti-Sybil — SPEC §4).
pub fn valid_node(info: &NodeInfo, pow_bits: u32) -> bool {
    if node_id_of(&info.static_pub) != info.node_id {
        return false;
    }
    if !verify_pow(&info.static_pub, info.pow_nonce, pow_bits) {
        return false;
    }
    !info.addrs.is_empty()
}

/// Filtre une liste de NodeInfo en ne gardant que les valides.
pub fn filter_valid(nodes: Vec<NodeInfo>, pow_bits: u32) -> Vec<NodeInfo> {
    nodes
        .into_iter()
        .filter(|n| valid_node(n, pow_bits))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use accord_crypto::Identity;
    use accord_proto::types::WireAddr;

    fn node(id: &Identity) -> NodeInfo {
        NodeInfo {
            node_id: id.node_id(),
            static_pub: id.public_key(),
            pow_nonce: id.pow_nonce(),
            flags: 0,
            addrs: vec![WireAddr("1.2.3.4:5".parse().unwrap())],
        }
    }

    #[test]
    fn valid_node_accepts_consistent() {
        let id = Identity::generate_with_pow_bits(8);
        assert!(valid_node(&node(&id), 8));
    }

    #[test]
    fn rejects_forged_node_id() {
        let id = Identity::generate_with_pow_bits(8);
        let mut n = node(&id);
        n.node_id = NodeId([0xFF; 32]);
        assert!(!valid_node(&n, 8));
    }

    #[test]
    fn rejects_insufficient_pow() {
        let id = Identity::generate_with_pow_bits(4);
        // Exiger 24 bits : l'identité 4 bits échoue presque sûrement.
        assert!(!valid_node(&node(&id), 24));
    }

    #[test]
    fn rejects_no_address() {
        let id = Identity::generate_with_pow_bits(8);
        let mut n = node(&id);
        n.addrs.clear();
        assert!(!valid_node(&n, 8));
    }
}
