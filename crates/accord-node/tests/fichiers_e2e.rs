//! Tests d'intégration du sous-système fichiers : contrat JSON-RPC `files.*`
//! sur un nœud local (partage, lecture en ligne, état, sauvegarde), puis
//! transfert réel entre deux nœuds complets à travers le réseau UDP
//! (manifest sondé, blocs vérifiés, événement `event.file_progress`).

use std::sync::Arc;
use std::time::Duration;

use accord_api::Service;
use accord_core::db::Db;
use accord_crypto::Identity;
use accord_node::outbound::OutboundSink;
use accord_node::{hex, identity, run, Node, NodeConfig, NodeService, Paths, RunningNode};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

/// Encode en base64 standard (référence indépendante de l'implémentation).
fn base64(data: &[u8]) -> String {
    const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        let quatre = [
            B64[(n >> 18) as usize & 63] as char,
            B64[(n >> 12) as usize & 63] as char,
            B64[(n >> 6) as usize & 63] as char,
            B64[n as usize & 63] as char,
        ];
        out.push(quatre[0]);
        out.push(quatre[1]);
        out.push(if chunk.len() >= 2 { quatre[2] } else { '=' });
        out.push(if chunk.len() == 3 { quatre[3] } else { '=' });
    }
    out
}

/// Service local adossé à une base sur disque (le magasin de fichiers vit à
/// côté de la base, dans le répertoire de profil).
fn service_sur_disque() -> (NodeService, Arc<Node>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(&dir.path().join("accord.db"), &[1u8; 32]).unwrap();
    let id = Identity::generate_with_pow_bits(1);
    let node = Arc::new(Node::new(id, db, OutboundSink::null()));
    (NodeService::new(Arc::clone(&node)), node, dir)
}

#[tokio::test]
async fn partage_lecture_statut_et_sauvegarde_locaux() {
    let (service, _node, dir) = service_sur_disque();
    let contenu: Vec<u8> = (0..3000u32).map(|i| (i % 251) as u8).collect();
    let source = dir.path().join("rapport.pdf");
    std::fs::write(&source, &contenu).unwrap();

    // files.share : manifeste signé, blob copié dans le magasin.
    let partage = service
        .call("files.share", json!({ "path": source.to_string_lossy() }))
        .await
        .unwrap();
    let fichier = &partage["file"];
    let racine = fichier["merkle_root"].as_str().unwrap().to_string();
    assert_eq!(racine.len(), 64);
    assert_eq!(fichier["name"], "rapport.pdf");
    assert_eq!(fichier["size"], 3000);
    assert_eq!(fichier["mime"], "application/pdf");

    // files.status : connu, complet (un seul bloc de 256 Kio).
    let statut = service
        .call("files.status", json!({ "merkle_root": racine }))
        .await
        .unwrap();
    assert_eq!(statut["known"], true);
    assert_eq!(statut["complete"], true);
    assert_eq!(statut["done"], 1);
    assert_eq!(statut["total"], 1);
    assert_eq!(statut["name"], "rapport.pdf");

    // files.read : contenu inline en base64.
    let lecture = service
        .call("files.read", json!({ "merkle_root": racine }))
        .await
        .unwrap();
    assert_eq!(lecture["data_b64"], base64(&contenu));
    assert_eq!(lecture["mime"], "application/pdf");
    assert_eq!(lecture["size"], 3000);

    // files.save : copie du blob complet vers un chemin choisi.
    let dest = dir.path().join("copie.pdf");
    let sauvegarde = service
        .call(
            "files.save",
            json!({ "merkle_root": racine, "path": dest.to_string_lossy() }),
        )
        .await
        .unwrap();
    assert_eq!(sauvegarde["ok"], true);
    assert_eq!(std::fs::read(&dest).unwrap(), contenu);

    // Racine inconnue : statut « non connu », sauvegarde refusée.
    let inconnu = hex::encode(&[7u8; 32]);
    let statut = service
        .call("files.status", json!({ "merkle_root": inconnu }))
        .await
        .unwrap();
    assert_eq!(statut["known"], false);
    assert_eq!(statut["total"], 0);
    assert!(service
        .call(
            "files.save",
            json!({ "merkle_root": inconnu, "path": dest.to_string_lossy() })
        )
        .await
        .is_err());
    // Racine illisible : refus franc.
    assert!(service
        .call("files.read", json!({ "merkle_root": "zz" }))
        .await
        .is_err());
}

#[tokio::test]
async fn lecture_en_ligne_refusee_au_dela_de_8_mio() {
    let (service, node, dir) = service_sur_disque();
    let contenu = vec![0x42u8; 8 * 1024 * 1024 + 1];
    let f = node
        .files_publish_bytes("gros.bin", "application/octet-stream", contenu.clone())
        .unwrap();
    let racine = hex::encode(&f.merkle_root);

    // Lecture en ligne refusée net…
    let err = service
        .call("files.read", json!({ "merkle_root": racine }))
        .await
        .unwrap_err();
    assert!(err.message.contains("files.save"), "erreur : {err:?}");
    // … mais la sauvegarde directe fonctionne.
    let dest = dir.path().join("gros-copie.bin");
    service
        .call(
            "files.save",
            json!({ "merkle_root": racine, "path": dest.to_string_lossy() }),
        )
        .await
        .unwrap();
    assert_eq!(std::fs::read(&dest).unwrap().len(), contenu.len());
}

#[tokio::test]
async fn lecture_d_un_fichier_absent_declenche_le_telechargement() {
    let (service, _node, _dir) = service_sur_disque();
    let racine = [3u8; 32];
    let indice = [9u8; 32];
    let params = json!({
        "merkle_root": hex::encode(&racine),
        "hint": hex::encode(&indice),
    });
    // Fichier inconnu : lecture en attente, téléchargement déclenché
    // (l'intention persistée est vérifiée par les tests unitaires du nœud).
    let lecture = service.call("files.read", params.clone()).await.unwrap();
    assert_eq!(lecture["pending"], true);
    // Idempotent : redemander ne casse rien.
    let lecture = service.call("files.read", params).await.unwrap();
    assert_eq!(lecture["pending"], true);
    // Un indice illisible est refusé à la frontière.
    assert!(service
        .call(
            "files.read",
            json!({ "merkle_root": hex::encode(&racine), "hint": "pas-un-hex" })
        )
        .await
        .is_err());
}

// ---- Transfert réel entre deux nœuds ----

async fn boot(dir: &std::path::Path) -> RunningNode {
    let paths = Paths::new(dir);
    let unlocked = identity::create(&paths, "phrase-de-passe-test", 1).unwrap();
    let config = NodeConfig {
        paths,
        p2p_addr: "127.0.0.1:0".parse().unwrap(),
        api_port: 0,
        pow_bits: 1,
        ..NodeConfig::default()
    };
    run(unlocked, config).await.unwrap()
}

type WsClient =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Client WebSocket authentifié sur l'API d'un nœud.
async fn ws_client(node: &RunningNode) -> WsClient {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}", node.api_addr()))
        .await
        .unwrap();
    let auth = json!({
        "jsonrpc": "2.0", "id": 0, "method": "auth",
        "params": { "token": node.token.expose() },
    });
    ws.send(Message::Text(auth.to_string())).await.unwrap();
    loop {
        if let Message::Text(text) = ws.next().await.unwrap().unwrap() {
            let v: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(v["result"]["protocole"], 1);
            break;
        }
    }
    ws
}

/// Appelle une méthode JSON-RPC et attend sa réponse (les événements croisés
/// sont ignorés).
async fn appel(ws: &mut WsClient, id: u64, method: &str, params: Value) -> Value {
    let req = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    ws.send(Message::Text(req.to_string())).await.unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let next = tokio::time::timeout_at(deadline, ws.next())
            .await
            .expect("réponse RPC attendue");
        let Some(Ok(Message::Text(text))) = next else {
            continue;
        };
        let v: Value = serde_json::from_str(&text).unwrap();
        if v["id"] == id {
            assert!(v.get("error").is_none(), "erreur RPC : {v}");
            return v["result"].clone();
        }
    }
}

/// Attend l'événement `event.file_progress` final d'une racine.
async fn attendre_fin_de_transfert(ws: &mut WsClient, racine_hex: &str) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let next = tokio::time::timeout_at(deadline, ws.next()).await;
        let Ok(Some(Ok(Message::Text(text)))) = next else {
            return false;
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if v["method"] == "event.file_progress"
            && v["params"]["merkle_root"] == racine_hex
            && v["params"]["complete"] == true
        {
            return true;
        }
    }
}

#[tokio::test]
async fn transfert_d_un_fichier_entre_deux_noeuds() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let alice = boot(dir_a.path()).await;
    let bob = boot(dir_b.path()).await;
    let alice_pub = alice.node.public_key();
    let bob_pub = bob.node.public_key();
    alice.register_peer(bob_pub, bob.p2p_addr());
    bob.register_peer(alice_pub, alice.p2p_addr());

    // Alice publie une petite note (un unique bloc de fichier, transporté en un
    // seul cadre de session — le multi-blocs fragmenté est couvert plus bas).
    let contenu: Vec<u8> = (0..700u32).map(|i| (i % 199) as u8).collect();
    let f = alice
        .node
        .files_publish_bytes("note.txt", "text/plain", contenu.clone())
        .unwrap();
    let racine_hex = hex::encode(&f.merkle_root);

    // Bob demande la lecture : téléchargement déclenché (indice = Alice).
    let mut ws = ws_client(&bob).await;
    let lecture = appel(
        &mut ws,
        1,
        "files.read",
        json!({ "merkle_root": racine_hex, "hint": hex::encode(&alice_pub) }),
    )
    .await;
    assert_eq!(lecture["pending"], true);

    // Le transfert traverse le réseau : manifest sondé chez Alice, bloc
    // vérifié, événement de complétion émis vers l'UI.
    assert!(
        attendre_fin_de_transfert(&mut ws, &racine_hex).await,
        "event.file_progress final non reçu"
    );

    // Deuxième lecture : le contenu est là, identique à l'original.
    let lecture = appel(
        &mut ws,
        2,
        "files.read",
        json!({ "merkle_root": racine_hex }),
    )
    .await;
    assert_eq!(lecture["data_b64"], base64(&contenu));
    assert_eq!(lecture["name"], "note.txt");
    assert_eq!(lecture["mime"], "text/plain");
    assert_eq!(lecture["size"], 700);

    // L'état local de Bob est cohérent (blob complet dans son magasin).
    let statut = appel(
        &mut ws,
        3,
        "files.status",
        json!({ "merkle_root": racine_hex }),
    )
    .await;
    assert_eq!(statut["complete"], true);
    assert_eq!(statut["done"], statut["total"]);
    let chemin = bob.node.files_local_path(&f.merkle_root).unwrap().unwrap();
    assert_eq!(std::fs::read(chemin).unwrap(), contenu);

    alice.shutdown();
    bob.shutdown();
}

#[tokio::test]
async fn transfert_d_un_fichier_multi_blocs_entre_deux_noeuds() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let alice = boot(dir_a.path()).await;
    let bob = boot(dir_b.path()).await;
    let alice_pub = alice.node.public_key();
    let bob_pub = bob.node.public_key();
    alice.register_peer(bob_pub, bob.p2p_addr());
    bob.register_peer(alice_pub, alice.p2p_addr());

    // 600 KiB = 3 blocs de 256 KiB : chaque bloc (FileMsg::Block) dépasse
    // largement la MTU applicative de 1 200 o et transite donc fragmenté sur
    // l'UDP réel, puis est réassemblé de bout en bout par le transport.
    let contenu: Vec<u8> = (0..600 * 1024u32).map(|i| (i % 251) as u8).collect();
    let f = alice
        .node
        .files_publish_bytes("gros.bin", "application/octet-stream", contenu.clone())
        .unwrap();
    let racine_hex = hex::encode(&f.merkle_root);

    // Bob demande la lecture : téléchargement déclenché (indice = Alice).
    let mut ws = ws_client(&bob).await;
    let lecture = appel(
        &mut ws,
        1,
        "files.read",
        json!({ "merkle_root": racine_hex, "hint": hex::encode(&alice_pub) }),
    )
    .await;
    assert_eq!(lecture["pending"], true);

    // Le transfert complet (manifest + 3 blocs fragmentés/réassemblés) aboutit.
    assert!(
        attendre_fin_de_transfert(&mut ws, &racine_hex).await,
        "event.file_progress final non reçu pour le fichier multi-blocs"
    );

    // L'état local de Bob est cohérent et le contenu identique à l'original.
    let statut = appel(
        &mut ws,
        2,
        "files.status",
        json!({ "merkle_root": racine_hex }),
    )
    .await;
    assert_eq!(statut["complete"], true);
    assert_eq!(statut["done"], statut["total"]);
    assert_eq!(statut["total"], 3);
    let chemin = bob.node.files_local_path(&f.merkle_root).unwrap().unwrap();
    assert_eq!(std::fs::read(chemin).unwrap(), contenu);

    alice.shutdown();
    bob.shutdown();
}
