//! Réseau DHT simulé en mémoire pour les tests : N [`KademliaNode`] reliés
//! par un [`TestNetRpc`] qui dispatch les RPC directement (sans transport),
//! avec une horloge logique partagée pour rester déterministe.

use crate::node::{DhtConfig, KademliaNode};
use crate::rpc::DhtRpc;
use accord_crypto::{FriendCode, Identity};
use accord_proto::dht_msg::{DhtBody, DhtMessage};
use accord_proto::types::{DhtRecord, NodeId, NodeInfo, RecordKind, WireAddr};
use async_trait::async_trait;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Réseau de test : les nœuds sont amorcés via le nœud 0 puis rafraîchis,
/// comme le ferait un vrai join Kademlia.
pub struct TestNet {
    nodes: Vec<Arc<KademliaNode>>,
    directory: Arc<HashMap<NodeId, Arc<KademliaNode>>>,
    clock: Arc<AtomicU64>,
}

/// Client RPC d'un nœud du réseau de test : trouve la cible par `node_id`
/// dans l'annuaire et appelle son `handle_rpc` directement.
#[derive(Clone)]
pub struct TestNetRpc {
    caller: NodeInfo,
    directory: Arc<HashMap<NodeId, Arc<KademliaNode>>>,
    clock: Arc<AtomicU64>,
}

#[async_trait]
impl DhtRpc for TestNetRpc {
    async fn send_rpc(&self, to: &NodeInfo, body: DhtBody) -> Option<DhtBody> {
        let node = self.directory.get(&to.node_id)?;
        // Chaque RPC avance l'horloge logique de 100 ms, ce qui recharge les
        // token buckets anti-abus au fil de l'eau (déterministe).
        let now_ms = self.clock.fetch_add(100, Ordering::Relaxed);
        let msg = DhtMessage {
            rpc_id: [0x42; 20],
            body,
        };
        node.handle_rpc(&self.caller, msg, now_ms).map(|m| m.body)
    }

    fn local_id(&self) -> NodeId {
        self.caller.node_id
    }
}

impl TestNet {
    /// Construit un réseau de `n` nœuds avec la difficulté PoW donnée, puis
    /// les amorce en deux passes (join + rafraîchissement de voisinage).
    pub async fn new(n: usize, pow_bits: u32) -> Self {
        let mut infos = Vec::with_capacity(n);
        let mut nodes = Vec::with_capacity(n);
        for i in 0..n {
            let id = Identity::generate_with_pow_bits(pow_bits);
            // Un /24 distinct par nœud pour ne pas déclencher la limite de
            // diversité IP de la table de routage.
            let addr: SocketAddr = format!("10.{i}.0.1:4433").parse().expect("addr test");
            let info = NodeInfo {
                node_id: id.node_id(),
                static_pub: id.public_key(),
                pow_nonce: id.pow_nonce(),
                flags: 0,
                addrs: vec![WireAddr(addr)],
            };
            let config = DhtConfig {
                pow_bits,
                ..DhtConfig::default()
            };
            nodes.push(Arc::new(KademliaNode::new(info.clone(), config)));
            infos.push(info);
        }
        let directory: Arc<HashMap<NodeId, Arc<KademliaNode>>> = Arc::new(
            nodes
                .iter()
                .map(|node| (node.node_id(), Arc::clone(node)))
                .collect(),
        );
        let net = Self {
            nodes,
            directory,
            clock: Arc::new(AtomicU64::new(1_000)),
        };

        // Passe 1 : chaque nœud rejoint via le nœud 0 (join séquentiel).
        // Passe 2 : chacun se relocalise pour s'enregistrer auprès de son
        // voisinage définitif, maintenant que tout le monde est présent.
        for _ in 0..2 {
            for (i, node) in net.nodes.iter().enumerate() {
                let (rpc, _) = net.client(i);
                node.bootstrap(&rpc, vec![infos[0].clone()], net.now())
                    .await;
            }
        }
        net
    }

    /// Horloge logique courante.
    pub fn now(&self) -> u64 {
        self.clock.load(Ordering::Relaxed)
    }

    /// Identifiant du nœud `i`.
    pub fn node_id(&self, i: usize) -> NodeId {
        self.nodes[i].node_id()
    }

    /// Client RPC agissant comme le nœud `i`, et seeds issus de sa table.
    pub fn client(&self, i: usize) -> (TestNetRpc, Vec<NodeInfo>) {
        let rpc = TestNetRpc {
            caller: self.nodes[i].local().clone(),
            directory: Arc::clone(&self.directory),
            clock: Arc::clone(&self.clock),
        };
        let mut seeds = self.nodes[i].peers_snapshot();
        if seeds.is_empty() {
            // Avant amorçage, le nœud 0 sert de seed universel.
            seeds = vec![self.nodes[0].local().clone()];
        }
        (rpc, seeds)
    }

    /// Accès direct au nœud `i` (assertions d'état).
    pub fn node(&self, i: usize) -> &KademliaNode {
        &self.nodes[i]
    }

    /// Publie le record IDENTITY du code ami de `publisher` via le nœud
    /// `via` ; rend la clé DHT et le record signé.
    pub async fn publish_identity(
        &self,
        publisher: &Identity,
        via: usize,
    ) -> ([u8; 32], DhtRecord) {
        let code = FriendCode::of_pubkey(&publisher.public_key());
        let key = code.dht_key();
        let mut value = code.payload().to_vec();
        value.extend_from_slice(&publisher.public_key());
        let mut record = DhtRecord {
            key,
            kind: RecordKind::Identity,
            value,
            publisher: publisher.public_key(),
            timestamp_ms: self.now(),
            expiry_s: 3600,
            sig: [0; 64],
        };
        record.sig = publisher.sign(&record.signable_bytes());
        let (rpc, _) = self.client(via);
        let stored = self.nodes[via].put(&rpc, record.clone(), self.now()).await;
        assert!(stored > 0, "le record doit atteindre au moins un pair");
        (key, record)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use accord_proto::limits::DHT_K;

    #[tokio::test]
    async fn network_populates_routing_tables() {
        let net = TestNet::new(20, 8).await;
        for i in 0..20 {
            assert!(
                net.node(i).peer_count() >= DHT_K.min(10),
                "le nœud {i} ne connaît que {} pairs",
                net.node(i).peer_count()
            );
        }
    }

    #[tokio::test]
    async fn node_get_finds_published_record() {
        let net = TestNet::new(30, 8).await;
        let publisher = Identity::generate_with_pow_bits(8);
        let (key, record) = net.publish_identity(&publisher, 3).await;
        // Un nœud éloigné du publieur retrouve le record via la DHT.
        let (rpc, _) = net.client(17);
        let got = net.node(17).get(&rpc, key, net.now()).await;
        assert_eq!(got, Some(record));
    }

    #[tokio::test]
    async fn expired_records_are_purged_everywhere() {
        let net = TestNet::new(10, 8).await;
        let publisher = Identity::generate_with_pow_bits(8);
        let (key, _) = net.publish_identity(&publisher, 0).await;
        let far_future = net.now() + 3_600_000 + 1;
        let mut purged = 0;
        for i in 0..10 {
            purged += net.node(i).expire_records(far_future);
        }
        assert!(purged > 0, "au moins une copie devait expirer");
        let (rpc, _) = net.client(4);
        assert_eq!(net.node(4).get(&rpc, key, far_future).await, None);
    }

    #[tokio::test]
    async fn rate_limiter_silently_drops_floods() {
        let net = TestNet::new(2, 8).await;
        let caller = net.node(0).local().clone();
        let target = net.node(1);
        // Rafale au même instant logique : le bucket (40) s'épuise.
        let now = net.now();
        let mut refused = 0;
        for _ in 0..100 {
            let msg = DhtMessage {
                rpc_id: [1; 20],
                body: DhtBody::Ping,
            };
            if target.handle_rpc(&caller, msg, now).is_none() {
                refused += 1;
            }
        }
        assert!(refused >= 50, "le flood doit être rejeté ({refused} refus)");
    }
}
