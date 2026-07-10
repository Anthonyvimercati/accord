//! Tests end-to-end du relais côté serveur (SPEC §10) sur le mesh simulé.
//!
//! Topologie : A (initiateur) et B (cible) ne se joignent que via R (relais
//! publiquement joignable). On établit d'abord les sessions A↔R et B↔R, puis on
//! valide l'acheminement opaque des blobs, les refus, le plafond de débit et la
//! fermeture de circuit.

use accord_crypto::Identity;
use accord_proto::plaintext::{ChannelMsg, RelayMsg};
use accord_transport::clock::ManualClock;
use accord_transport::endpoint::{Endpoint, EndpointConfig, TransportEvent};
use accord_transport::socket::sim::{NetConditions, SimNet};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

const POW: u32 = 4;

fn config(relay_serving: bool) -> EndpointConfig {
    EndpointConfig {
        pow_bits: POW,
        relay_serving,
        ..EndpointConfig::default()
    }
}

struct Node {
    ep: Arc<Endpoint>,
    events: mpsc::UnboundedReceiver<TransportEvent>,
    addr: SocketAddr,
}

fn spawn_node(net: &SimNet, clock: &ManualClock, addr: &str, relay_serving: bool) -> Node {
    let addr: SocketAddr = addr.parse().unwrap();
    let socket = Arc::new(net.bind(addr));
    let id = Arc::new(Identity::generate_with_pow_bits(POW));
    let (ep, events) = Endpoint::new(
        socket,
        id,
        Arc::new(clock.clone()) as Arc<dyn accord_transport::Clock>,
        config(relay_serving),
    );
    ep.spawn();
    Node { ep, events, addr }
}

/// Établit une session `client → relais` (PING de contrôle porteur) et attend,
/// borné, que les deux extrémités l'aient enregistrée.
async fn establish(client: &Node, relay: &Node, expected_relay_sessions: usize) {
    client.ep.connect(relay.addr).await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if client.ep.session_count() >= 1 && relay.ep.session_count() >= expected_relay_sessions
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("session client↔relais établie");
}

fn open(target: &Node) -> ChannelMsg {
    ChannelMsg::Relay(RelayMsg::Open {
        target: target.ep.node_id().0,
    })
}

fn data(circuit: u32, blob: Vec<u8>) -> ChannelMsg {
    ChannelMsg::Relay(RelayMsg::Data { circuit, blob })
}

/// Attend un `RelayAccepted` et rend le circuit attribué.
async fn recv_accepted(node: &mut Node) -> u32 {
    loop {
        match tokio::time::timeout(Duration::from_secs(2), node.events.recv())
            .await
            .expect("timeout RelayAccepted")
            .expect("canal fermé")
        {
            TransportEvent::RelayAccepted { circuit, .. } => return circuit,
            _ => continue,
        }
    }
}

/// Attend un `RelayRejected` et rend le code de refus.
async fn recv_rejected(node: &mut Node) -> u8 {
    loop {
        match tokio::time::timeout(Duration::from_secs(2), node.events.recv())
            .await
            .expect("timeout RelayRejected")
            .expect("canal fermé")
        {
            TransportEvent::RelayRejected { code, .. } => return code,
            _ => continue,
        }
    }
}

/// Attend un blob relayé (remonté en `Message(Relay(Data))`) et le rend.
async fn recv_relayed_blob(node: &mut Node) -> Vec<u8> {
    loop {
        match tokio::time::timeout(Duration::from_secs(2), node.events.recv())
            .await
            .expect("timeout blob relayé")
            .expect("canal fermé")
        {
            TransportEvent::Message { msg, .. } => {
                if let ChannelMsg::Relay(RelayMsg::Data { blob, .. }) = *msg {
                    return blob;
                }
            }
            _ => continue,
        }
    }
}

/// Vrai si un blob relayé (`Message(Relay(Data))`) arrive avant l'échéance ;
/// faux si l'échéance expire sans aucun blob (utilisé pour les gardes négatives).
async fn relayed_blob_arrives(node: &mut Node, within: Duration) -> bool {
    tokio::time::timeout(within, async {
        loop {
            match node.events.recv().await {
                Some(TransportEvent::Message { msg, .. }) => {
                    if matches!(*msg, ChannelMsg::Relay(RelayMsg::Data { .. })) {
                        return true; // un blob a été relayé
                    }
                }
                Some(_) => continue,
                None => return false,
            }
        }
    })
    .await
    .unwrap_or(false) // échéance expirée : aucun blob relayé
}

#[tokio::test]
async fn relay_forwards_data_both_directions() {
    let clock = ManualClock::new(1_000_000);
    let net = SimNet::new(501, NetConditions::default());
    let mut alice = spawn_node(&net, &clock, "10.5.0.1:4000", false);
    let relay = spawn_node(&net, &clock, "10.5.0.2:4000", true);
    let mut bob = spawn_node(&net, &clock, "10.5.0.3:4000", false);

    // Sessions A↔R puis B↔R (R doit finir avec 2 sessions).
    establish(&alice, &relay, 1).await;
    establish(&bob, &relay, 2).await;

    // A ouvre un circuit vers B via R.
    alice.ep.send(relay.addr, &open(&bob)).await.unwrap();
    let circuit = recv_accepted(&mut alice).await;

    // A → (R) → B : le blob opaque arrive à l'identique.
    let blob_ab = b"paquet-DATA-bout-en-bout-A".to_vec();
    alice
        .ep
        .send(relay.addr, &data(circuit, blob_ab.clone()))
        .await
        .unwrap();
    assert_eq!(recv_relayed_blob(&mut bob).await, blob_ab);

    // B répond sur le même circuit : B → (R) → A.
    let blob_ba = b"reponse-de-B".to_vec();
    bob.ep
        .send(relay.addr, &data(circuit, blob_ba.clone()))
        .await
        .unwrap();
    assert_eq!(recv_relayed_blob(&mut alice).await, blob_ba);
}

#[tokio::test]
async fn relay_rejects_when_not_serving() {
    let clock = ManualClock::new(1_000_000);
    let net = SimNet::new(502, NetConditions::default());
    let mut alice = spawn_node(&net, &clock, "10.6.0.1:4000", false);
    // R n'assure PAS le service de relais.
    let relay = spawn_node(&net, &clock, "10.6.0.2:4000", false);
    let bob = spawn_node(&net, &clock, "10.6.0.3:4000", false);

    establish(&alice, &relay, 1).await;

    alice.ep.send(relay.addr, &open(&bob)).await.unwrap();
    let code = recv_rejected(&mut alice).await;
    assert_eq!(code, 0x01, "REJECT_NOT_RELAY attendu");
}

#[tokio::test]
async fn relay_rejects_unknown_target() {
    let clock = ManualClock::new(1_000_000);
    let net = SimNet::new(503, NetConditions::default());
    let mut alice = spawn_node(&net, &clock, "10.7.0.1:4000", false);
    let relay = spawn_node(&net, &clock, "10.7.0.2:4000", true);
    // Bob existe comme identité mais n'a AUCUNE session avec R.
    let bob = spawn_node(&net, &clock, "10.7.0.3:4000", false);

    establish(&alice, &relay, 1).await;

    alice.ep.send(relay.addr, &open(&bob)).await.unwrap();
    let code = recv_rejected(&mut alice).await;
    assert_eq!(code, 0x02, "REJECT_NO_TARGET attendu");
}

#[tokio::test]
async fn relay_throttles_over_bandwidth_cap() {
    // Plafond de la RelayTable : 1 Mo/s par circuit. L'horloge manuelle reste
    // figée : les deux blobs comptent dans la même fenêtre. Le premier passe, le
    // second fait déborder le plafond et n'est pas relayé.
    let clock = ManualClock::new(1_000_000);
    let net = SimNet::new(504, NetConditions::default());
    let mut alice = spawn_node(&net, &clock, "10.8.0.1:4000", false);
    let relay = spawn_node(&net, &clock, "10.8.0.2:4000", true);
    let mut bob = spawn_node(&net, &clock, "10.8.0.3:4000", false);

    establish(&alice, &relay, 1).await;
    establish(&bob, &relay, 2).await;

    alice.ep.send(relay.addr, &open(&bob)).await.unwrap();
    let circuit = recv_accepted(&mut alice).await;

    // 550 000 + 550 000 = 1 100 000 > 1 000 000 : le second dépasse.
    let blob1 = vec![0xAAu8; 550_000];
    let blob2 = vec![0xBBu8; 550_000];

    alice
        .ep
        .send(relay.addr, &data(circuit, blob1.clone()))
        .await
        .unwrap();
    assert_eq!(
        recv_relayed_blob(&mut bob).await,
        blob1,
        "le premier blob (sous le plafond) doit être relayé"
    );

    alice
        .ep
        .send(relay.addr, &data(circuit, blob2))
        .await
        .unwrap();
    assert!(
        !relayed_blob_arrives(&mut bob, Duration::from_millis(500)).await,
        "le second blob dépasse le plafond et ne doit PAS être relayé"
    );
}

#[tokio::test]
async fn relay_drops_data_after_close() {
    let clock = ManualClock::new(1_000_000);
    let net = SimNet::new(505, NetConditions::default());
    let mut alice = spawn_node(&net, &clock, "10.9.0.1:4000", false);
    let relay = spawn_node(&net, &clock, "10.9.0.2:4000", true);
    let mut bob = spawn_node(&net, &clock, "10.9.0.3:4000", false);

    establish(&alice, &relay, 1).await;
    establish(&bob, &relay, 2).await;

    alice.ep.send(relay.addr, &open(&bob)).await.unwrap();
    let circuit = recv_accepted(&mut alice).await;

    // Preuve de vivacité du circuit avant fermeture.
    let blob = b"avant-close".to_vec();
    alice
        .ep
        .send(relay.addr, &data(circuit, blob.clone()))
        .await
        .unwrap();
    assert_eq!(recv_relayed_blob(&mut bob).await, blob);

    // Fermeture, puis Data sur le même circuit : plus rien n'est relayé.
    alice
        .ep
        .send(relay.addr, &ChannelMsg::Relay(RelayMsg::Close { circuit }))
        .await
        .unwrap();
    alice
        .ep
        .send(relay.addr, &data(circuit, b"apres-close".to_vec()))
        .await
        .unwrap();
    assert!(
        !relayed_blob_arrives(&mut bob, Duration::from_millis(500)).await,
        "aucun blob ne doit être relayé après fermeture du circuit"
    );
}
