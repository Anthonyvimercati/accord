//! Test d'intégration voix bout-en-bout : deux nœuds complets (UDP réel)
//! rejoignent le salon vocal par défaut d'un groupe (channel_id == group_id),
//! échangent des trames en mode simulé (codec pur, capture injectée), et les
//! événements `event.voice_joined` / `event.voice_left` sont poussés sur
//! l'API WebSocket. Le plafond full mesh de 10 participants est vérifié.

use std::time::Duration;

use accord_node::{identity, run, NodeConfig, Paths, RunningNode, VoiceBackend};
use accord_voice::params::FRAME_SAMPLES;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

async fn boot(dir: &std::path::Path) -> RunningNode {
    let paths = Paths::new(dir);
    let unlocked = identity::create(&paths, "phrase-de-passe-test", 1).unwrap();
    let config = NodeConfig {
        paths,
        p2p_addr: "127.0.0.1:0".parse().unwrap(),
        api_port: 0,
        pow_bits: 1,
        voice_backend: VoiceBackend::Simule,
        ..NodeConfig::default()
    };
    run(unlocked, config).await.unwrap()
}

/// Attend qu'une condition asynchrone devienne vraie (borne dure ~10 s).
async fn eventually<F, Fut>(mut cond: F) -> bool
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    for _ in 0..200 {
        if cond().await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    cond().await
}

/// Trame de parole : alternance pleine d'amplitude, au-dessus du seuil VAD.
fn tone() -> Vec<i16> {
    (0..FRAME_SAMPLES)
        .map(|i| if i % 2 == 0 { 20_000 } else { -20_000 })
        .collect()
}

type WsClient =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Client WebSocket authentifié sur l'API d'un nœud (reçoit les événements).
async fn ws_client(node: &RunningNode) -> WsClient {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}", node.api_addr()))
        .await
        .unwrap();
    let auth = json!({
        "jsonrpc": "2.0", "id": 0, "method": "auth",
        "params": { "token": node.token.expose() },
    });
    ws.send(Message::Text(auth.to_string())).await.unwrap();
    // Réponse d'authentification consommée.
    loop {
        if let Message::Text(text) = ws.next().await.unwrap().unwrap() {
            let v: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(v["result"]["protocole"], 1);
            break;
        }
    }
    ws
}

/// Draine le WebSocket jusqu'à voir l'événement `method` avec ce `pubkey`
/// (borne dure ~10 s).
async fn wait_event(ws: &mut WsClient, method: &str, pubkey: &str) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let next = tokio::time::timeout_at(deadline, ws.next()).await;
        let Ok(Some(Ok(Message::Text(text)))) = next else {
            return false;
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if v["method"] == method && v["params"]["pubkey"] == pubkey {
            return true;
        }
    }
}

#[tokio::test]
async fn two_nodes_join_voice_exchange_frames_and_respect_cap() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let alice = boot(dir_a.path()).await;
    let bob = boot(dir_b.path()).await;

    let alice_pub = alice.node.public_key();
    let bob_pub = bob.node.public_key();
    let alice_hex = accord_node::hex::encode(&alice_pub);
    let bob_hex = accord_node::hex::encode(&bob_pub);

    // Amorçage : chacun connaît l'adresse P2P de l'autre, amitié établie.
    alice.register_peer(bob_pub, bob.p2p_addr());
    bob.register_peer(alice_pub, alice.p2p_addr());
    alice.node.friend_request(&bob_pub, "Alice").unwrap();
    assert!(
        eventually(|| async {
            bob.node
                .contacts()
                .map(|cs| cs.iter().any(|c| c.pubkey == alice_pub))
                .unwrap_or(false)
        })
        .await
    );
    bob.node.friend_respond(&alice_pub, true).unwrap();

    // Groupe partagé ; le salon vocal par défaut a channel_id == group_id.
    let gid_hex = alice.node.group_create("Guilde").unwrap();
    let gid: [u8; 16] = accord_node::hex::decode(&gid_hex).unwrap();
    alice.node.group_invite(&gid, &bob_pub).unwrap();
    assert!(
        eventually(|| async {
            bob.node
                .group_state(&gid)
                .map(|s| s.is_member(&bob_pub))
                .unwrap_or(false)
        })
        .await,
        "Bob n'a pas matérialisé le groupe"
    );

    // Client WebSocket d'Alice : reçoit les événements voix.
    let mut ws_alice = ws_client(&alice).await;

    // Alice rejoint : seule dans le salon.
    let participants = alice.voice().join(gid, gid).await.unwrap();
    assert_eq!(participants, vec![alice_pub]);

    // Bob rejoint ; la signalisation traverse le réseau dans les deux sens.
    bob.voice().join(gid, gid).await.unwrap();
    assert!(
        eventually(|| async {
            match alice.voice().status().await {
                Ok(Some(s)) => s.participants.iter().any(|p| p.pubkey == bob_pub),
                _ => false,
            }
        })
        .await,
        "Alice ne voit pas Bob dans le salon"
    );
    assert!(
        eventually(|| async {
            match bob.voice().status().await {
                Ok(Some(s)) => s.participants.iter().any(|p| p.pubkey == alice_pub),
                _ => false,
            }
        })
        .await,
        "Bob ne voit pas Alice dans le salon"
    );
    assert!(
        wait_event(&mut ws_alice, "event.voice_joined", &bob_hex).await,
        "event.voice_joined de Bob non reçu sur l'API d'Alice"
    );

    // Échange de trames (codec pur) : la parole injectée chez Alice traverse
    // le réseau et ouvre l'indicateur « parle » d'Alice chez Bob.
    assert!(
        eventually(|| async {
            for _ in 0..5 {
                alice.voice().inject_pcm(tone());
            }
            match bob.voice().status().await {
                Ok(Some(s)) => s
                    .participants
                    .iter()
                    .any(|p| p.pubkey == alice_pub && p.speaking),
                _ => false,
            }
        })
        .await,
        "les trames d'Alice ne sont pas arrivées chez Bob"
    );

    // Micro coupé : l'indicateur de Bob se referme (hystérésis comprise).
    alice.voice().set_muted(true).await.unwrap();
    assert!(
        eventually(|| async {
            match bob.voice().status().await {
                Ok(Some(s)) => s
                    .participants
                    .iter()
                    .any(|p| p.pubkey == alice_pub && !p.speaking),
                _ => false,
            }
        })
        .await,
        "l'indicateur « parle » d'Alice ne s'est pas refermé chez Bob"
    );

    // Bob quitte : Alice le voit partir (statut + événement API).
    bob.voice().leave().await.unwrap();
    assert!(
        eventually(|| async {
            match alice.voice().status().await {
                Ok(Some(s)) => !s.participants.iter().any(|p| p.pubkey == bob_pub),
                _ => false,
            }
        })
        .await,
        "Alice voit toujours Bob après son départ"
    );
    assert!(
        wait_event(&mut ws_alice, "event.voice_left", &bob_hex).await,
        "event.voice_left de Bob non reçu sur l'API d'Alice"
    );
    let _ = alice_hex;

    // Plafond full mesh : 9 membres fantômes (invités par Alice, seule à
    // détenir INVITE) remplissent le salon vu de Bob — Alice y est toujours ;
    // sa jointure déborde et échoue explicitement.
    let mut ghosts = Vec::new();
    for _ in 0..9 {
        let ghost = accord_crypto::Identity::generate_with_pow_bits(1).public_key();
        alice.node.group_invite(&gid, &ghost).unwrap();
        ghosts.push(ghost);
    }
    assert!(
        eventually(|| async {
            bob.node
                .group_state(&gid)
                .map(|s| ghosts.iter().all(|g| s.is_member(g)))
                .unwrap_or(false)
        })
        .await,
        "les ops d'invitation ne sont pas arrivées chez Bob"
    );
    for ghost in &ghosts {
        bob.voice().peer_signal(*ghost, gid, gid, 0, 0x01, false);
    }
    let err = bob.voice().join(gid, gid).await.unwrap_err();
    assert!(
        err.to_string().contains("plein"),
        "erreur de plafond inattendue : {err}"
    );

    alice.shutdown();
    bob.shutdown();
}
