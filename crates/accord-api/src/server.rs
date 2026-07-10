//! Serveur WebSocket JSON-RPC local (SPEC API.md).
//!
//! Écoute uniquement sur `127.0.0.1`. Chaque connexion doit s'authentifier
//! par jeton (première requête, méthode `auth`) avant toute autre méthode.
//! Les événements du nœud sont poussés à tous les clients authentifiés via
//! des notifications JSON-RPC (`event.*`).

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Semaphore};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse as HandshakeErrorResponse, Request as HandshakeRequest,
    Response as HandshakeResponse,
};
use tokio_tungstenite::tungstenite::http;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use crate::auth::AuthToken;
use crate::rpc::{
    RpcError, RpcNotification, RpcRequest, RpcResponse, INVALID_REQUEST, PARSE_ERROR, UNAUTHORIZED,
};

/// Délai maximal pour s'authentifier après connexion.
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
/// Taille maximale d'un message WebSocket entrant (16 MiB) : doit laisser
/// passer `files.share_bytes`/`files.read` (8 Mio d'octets, ~11 Mio une fois
/// en base64 + enveloppe JSON). Canal local uniquement (127.0.0.1, jeton).
const MAX_WS_MESSAGE: usize = 16 * 1024 * 1024;
/// Capacité du canal de notifications (les clients lents perdent les
/// événements les plus anciens, jamais l'état : l'UI re-synchronise).
const NOTIFY_CAPACITY: usize = 1024;

/// Délai maximal d'établissement du WebSocket (acceptation TCP → upgrade WS).
/// Borne anti-slowloris : une connexion qui n'achève jamais le handshake est
/// abandonnée sans immobiliser de ressources (le jeton n'intervient qu'après).
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// Nombre maximal de connexions simultanées acceptées. Canal purement local,
/// mais borne de défense en profondeur contre l'épuisement mémoire/ressources ;
/// au-delà, la connexion est fermée immédiatement.
const MAX_CONNECTIONS: usize = 64;

/// Version du protocole API annoncée à l'authentification.
pub const API_VERSION: u32 = 1;

/// Bornes de durcissement du serveur local (défense en profondeur).
///
/// Le canal est local (`127.0.0.1`, protégé par jeton), mais ces bornes
/// limitent l'impact d'un client local malveillant ou défaillant.
#[derive(Debug, Clone, Copy)]
pub struct ServerLimits {
    /// Connexions simultanées maximales ; au-delà, fermeture immédiate.
    pub max_connections: usize,
    /// Délai maximal d'établissement du WebSocket (anti-slowloris pré-handshake).
    pub handshake_timeout: Duration,
    /// Délai maximal d'authentification après établissement.
    pub auth_timeout: Duration,
}

impl Default for ServerLimits {
    fn default() -> Self {
        Self {
            max_connections: MAX_CONNECTIONS,
            handshake_timeout: HANDSHAKE_TIMEOUT,
            auth_timeout: AUTH_TIMEOUT,
        }
    }
}

/// Implémentation des méthodes de l'API (fournie par `accord-node`).
pub trait Service: Send + Sync + 'static {
    /// Traite une méthode authentifiée avec ses paramètres nommés.
    fn call(
        &self,
        method: &str,
        params: Value,
    ) -> impl Future<Output = Result<Value, RpcError>> + Send;
}

/// Émetteur d'événements vers tous les clients authentifiés.
#[derive(Clone)]
pub struct NotificationHub {
    tx: broadcast::Sender<String>,
}

impl NotificationHub {
    /// Crée un hub d'événements autonome (partagé entre le nœud et le
    /// serveur API).
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(NOTIFY_CAPACITY);
        Self { tx }
    }

    /// Diffuse un événement `event.*` (sans effet si aucun client).
    pub fn notify(&self, method: &str, params: Value) {
        if let Ok(text) = serde_json::to_string(&RpcNotification::new(method, params)) {
            let _ = self.tx.send(text);
        }
    }

    /// Nombre de connexions API actuellement abonnées aux événements (0 :
    /// plus aucun client — le test micro s'arrête tout seul, D-029).
    pub fn subscriber_count(&self) -> usize {
        self.tx.receiver_count()
    }
}

impl Default for NotificationHub {
    fn default() -> Self {
        Self::new()
    }
}

/// Serveur API en cours d'exécution.
pub struct ApiServer {
    local_addr: SocketAddr,
    hub: NotificationHub,
    accept_task: JoinHandle<()>,
}

impl ApiServer {
    /// Démarre le serveur sur `127.0.0.1:port` (`port = 0` : éphémère) avec un
    /// hub d'événements partagé et les bornes de durcissement par défaut.
    pub async fn bind<S: Service>(
        port: u16,
        token: AuthToken,
        service: Arc<S>,
        hub: NotificationHub,
    ) -> std::io::Result<Self> {
        Self::bind_with_limits(port, token, service, hub, ServerLimits::default()).await
    }

    /// Comme [`ApiServer::bind`], mais avec des bornes de durcissement
    /// explicites (connexions simultanées, délais de handshake et d'auth).
    pub async fn bind_with_limits<S: Service>(
        port: u16,
        token: AuthToken,
        service: Arc<S>,
        hub: NotificationHub,
        limits: ServerLimits,
    ) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", port)).await?;
        let local_addr = listener.local_addr()?;
        let tx = hub.tx.clone();
        let accept_task = tokio::spawn(accept_loop(listener, token, service, tx, limits));
        Ok(Self {
            local_addr,
            hub,
            accept_task,
        })
    }

    /// Adresse locale effective (port éphémère résolu).
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// Émetteur d'événements de ce serveur.
    pub fn hub(&self) -> NotificationHub {
        self.hub.clone()
    }

    /// Arrête l'acceptation de connexions (les connexions établies se
    /// terminent à leur fermeture).
    pub fn shutdown(&self) {
        self.accept_task.abort();
    }
}

impl Drop for ApiServer {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

async fn accept_loop<S: Service>(
    listener: TcpListener,
    token: AuthToken,
    service: Arc<S>,
    tx: broadcast::Sender<String>,
    limits: ServerLimits,
) {
    // Un permis par connexion active : borne les connexions simultanées.
    let connections = Arc::new(Semaphore::new(limits.max_connections));
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            tracing::warn!("api: écouteur local fermé");
            return;
        };
        // Au-delà de la borne : fermeture immédiate sans traiter la connexion.
        let permit = match Arc::clone(&connections).try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                tracing::debug!("api: limite de connexions atteinte, refus immédiat");
                drop(stream);
                continue;
            }
        };
        let token = token.clone();
        let service = Arc::clone(&service);
        let rx = tx.subscribe();
        tokio::spawn(async move {
            // Le permis est relâché à la fin de la connexion (Drop).
            let _permit = permit;
            if let Err(e) = handle_connection(stream, token, service, rx, limits).await {
                tracing::debug!(erreur = %e, "api: connexion terminée");
            }
        });
    }
}

type WsStream = tokio_tungstenite::WebSocketStream<TcpStream>;

async fn handle_connection<S: Service>(
    stream: TcpStream,
    token: AuthToken,
    service: Arc<S>,
    mut notifications: broadcast::Receiver<String>,
    limits: ServerLimits,
) -> Result<(), tokio_tungstenite::tungstenite::Error> {
    let config = WebSocketConfig {
        max_message_size: Some(MAX_WS_MESSAGE),
        max_frame_size: Some(MAX_WS_MESSAGE),
        ..Default::default()
    };
    // Handshake borné dans le temps (anti-slowloris pré-handshake) et filtré
    // par en-tête `Origin` (anti-DNS-rebinding / CSRF WebSocket).
    let accept =
        tokio_tungstenite::accept_hdr_async_with_config(stream, enforce_origin, Some(config));
    let mut ws = match tokio::time::timeout(limits.handshake_timeout, accept).await {
        Ok(Ok(ws)) => ws,
        Ok(Err(e)) => return Err(e), // handshake échoué (origine refusée incluse)
        Err(_) => return Ok(()),     // délai dépassé : abandon silencieux
    };

    if !authenticate(&mut ws, &token, limits.auth_timeout).await? {
        let _ = ws.close(None).await;
        return Ok(());
    }

    loop {
        tokio::select! {
            incoming = ws.next() => {
                let Some(msg) = incoming else { return Ok(()) };
                match msg? {
                    Message::Text(text) => {
                        if let Some(reply) = dispatch(&*service, &text).await {
                            ws.send(Message::Text(reply)).await?;
                        }
                    }
                    Message::Close(_) => return Ok(()),
                    // Binaire non prévu par l'API : ignoré. Ping/Pong gérés
                    // par tungstenite.
                    _ => {}
                }
            }
            notif = notifications.recv() => {
                match notif {
                    Ok(text) => ws.send(Message::Text(text)).await?,
                    // Client trop lent : des événements ont été perdus,
                    // on l'informe pour qu'il re-synchronise.
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if let Ok(text) = serde_json::to_string(&RpcNotification::new(
                            "event.desynchronise",
                            json!({}),
                        )) {
                            ws.send(Message::Text(text)).await?;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => return Ok(()),
                }
            }
        }
    }
}

/// Première requête : `auth {token}`. Rend `true` si authentifié.
async fn authenticate(
    ws: &mut WsStream,
    token: &AuthToken,
    auth_timeout: Duration,
) -> Result<bool, tokio_tungstenite::tungstenite::Error> {
    let first = tokio::time::timeout(auth_timeout, ws.next()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        return Ok(false);
    };
    let (id, ok) = match serde_json::from_str::<RpcRequest>(&text) {
        Ok(req) if req.is_well_formed() && req.method == "auth" => {
            let presented = req
                .params
                .get("token")
                .and_then(Value::as_str)
                .unwrap_or("");
            (req.id.unwrap_or(Value::Null), token.verify(presented))
        }
        Ok(req) => (req.id.unwrap_or(Value::Null), false),
        Err(_) => (Value::Null, false),
    };
    let response = if ok {
        RpcResponse::ok(id, json!({ "protocole": API_VERSION }))
    } else {
        RpcResponse::err(id, RpcError::new(UNAUTHORIZED, "jeton invalide"))
    };
    if let Ok(reply) = serde_json::to_string(&response) {
        ws.send(Message::Text(reply)).await?;
    }
    Ok(ok)
}

/// Traite une trame texte authentifiée. Rend la réponse à émettre, ou
/// `None` pour une notification client (sans `id`).
async fn dispatch<S: Service>(service: &S, text: &str) -> Option<String> {
    let request = match serde_json::from_str::<RpcRequest>(text) {
        Ok(r) => r,
        Err(_) => {
            let resp = RpcResponse::err(Value::Null, RpcError::new(PARSE_ERROR, "JSON invalide"));
            return serde_json::to_string(&resp).ok();
        }
    };
    if !request.is_well_formed() {
        let resp = RpcResponse::err(
            request.id.unwrap_or(Value::Null),
            RpcError::new(INVALID_REQUEST, "requête malformée"),
        );
        return serde_json::to_string(&resp).ok();
    }
    let id = request.id.clone();
    // Ré-authentification idempotente d'un client déjà authentifié.
    let outcome = if request.method == "auth" {
        Ok(json!({ "protocole": API_VERSION }))
    } else {
        service.call(&request.method, request.params).await
    };
    let id = id?;
    let response = match outcome {
        Ok(result) => RpcResponse::ok(id, result),
        Err(error) => RpcResponse::err(id, error),
    };
    serde_json::to_string(&response).ok()
}

/// Décide si une origine est autorisée à ouvrir le WebSocket local (défense en
/// profondeur contre le DNS-rebinding et le CSRF WebSocket). L'application
/// légitime se connecte depuis `127.0.0.1`/`localhost`, le schéma `tauri://`,
/// ou sans en-tête `Origin` (WebView natif). Toute autre origine web explicite
/// est refusée.
///
/// Liste blanche :
/// - en-tête `Origin` absent → autorisé (WebView natif) ;
/// - `null` → autorisé (contexte opaque : fichier local / WebView) ;
/// - `tauri://localhost`, `https://tauri.localhost` ;
/// - `http(s)://localhost[:port]`, `http(s)://127.0.0.1[:port]`,
///   `http(s)://[::1][:port]`.
fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return true; // pas d'en-tête Origin : WebView natif
    };
    if origin.eq_ignore_ascii_case("null") {
        return true; // origine opaque
    }
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false; // origine malformée
    };
    let host = host_without_port(rest).to_ascii_lowercase();
    match scheme.to_ascii_lowercase().as_str() {
        "tauri" => host == "localhost",
        "http" | "https" => {
            matches!(
                host.as_str(),
                "localhost" | "127.0.0.1" | "::1" | "tauri.localhost"
            )
        }
        _ => false,
    }
}

/// Extrait l'hôte d'une autorité `host[:port]`, en gérant les littéraux IPv6
/// entre crochets (`[::1]:port`).
fn host_without_port(authority: &str) -> &str {
    if let Some(rest) = authority.strip_prefix('[') {
        // Littéral IPv6 : `[adresse]` éventuellement suivi de `:port`.
        return rest.split_once(']').map(|(host, _)| host).unwrap_or(rest);
    }
    let end = authority.find([':', '/']).unwrap_or(authority.len());
    &authority[..end]
}

/// Rappel de handshake WebSocket : autorise ou refuse la connexion selon
/// l'en-tête `Origin` (voir [`origin_allowed`]). Un refus renvoie `403`.
// Le type de retour (grand variant `Err`) est imposé par le trait `Callback`
// de tungstenite : on ne peut pas le réduire ni le boxer sans casser la
// signature attendue par `accept_hdr_async_with_config`.
#[allow(clippy::result_large_err)]
fn enforce_origin(
    request: &HandshakeRequest,
    response: HandshakeResponse,
) -> Result<HandshakeResponse, HandshakeErrorResponse> {
    let origin = request
        .headers()
        .get(http::header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin_allowed(origin) {
        Ok(response)
    } else {
        let mut refus = http::Response::new(Some("origine non autorisée".to_string()));
        *refus.status_mut() = http::StatusCode::FORBIDDEN;
        Err(refus)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::METHOD_NOT_FOUND;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    /// Service d'essai : `echo` renvoie ses paramètres, tout le reste est
    /// inconnu.
    struct Echo;

    impl Service for Echo {
        async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
            match method {
                "echo" => Ok(params),
                _ => Err(RpcError::new(METHOD_NOT_FOUND, "méthode inconnue")),
            }
        }
    }

    async fn connect(addr: SocketAddr) -> WsClient {
        let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
            .await
            .unwrap();
        ws
    }

    type WsClient =
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>;

    async fn send_recv(ws: &mut WsClient, payload: Value) -> Value {
        ws.send(Message::Text(payload.to_string())).await.unwrap();
        recv_json(ws).await
    }

    async fn recv_json(ws: &mut WsClient) -> Value {
        loop {
            match ws.next().await.unwrap().unwrap() {
                Message::Text(t) => return serde_json::from_str(&t).unwrap(),
                _ => continue,
            }
        }
    }

    fn auth_msg(token: &str) -> Value {
        json!({"jsonrpc":"2.0","id":0,"method":"auth","params":{"token":token}})
    }

    #[tokio::test]
    async fn full_session_auth_call_and_notification() {
        let token = AuthToken::generate();
        let server = ApiServer::bind(0, token.clone(), Arc::new(Echo), NotificationHub::new())
            .await
            .unwrap();
        let mut ws = connect(server.local_addr()).await;

        let auth = send_recv(&mut ws, auth_msg(token.expose())).await;
        assert_eq!(auth["result"]["protocole"], API_VERSION);

        let echo = send_recv(
            &mut ws,
            json!({"jsonrpc":"2.0","id":1,"method":"echo","params":{"v":42}}),
        )
        .await;
        assert_eq!(echo["result"]["v"], 42);

        let unknown = send_recv(
            &mut ws,
            json!({"jsonrpc":"2.0","id":2,"method":"nexiste.pas","params":{}}),
        )
        .await;
        assert_eq!(unknown["error"]["code"], METHOD_NOT_FOUND);

        server.hub().notify("event.test", json!({"n": 7}));
        let notif = recv_json(&mut ws).await;
        assert_eq!(notif["method"], "event.test");
        assert_eq!(notif["params"]["n"], 7);
        assert!(notif.get("id").is_none());
    }

    #[tokio::test]
    async fn subscriber_count_follows_connections() {
        let token = AuthToken::generate();
        let server = ApiServer::bind(0, token.clone(), Arc::new(Echo), NotificationHub::new())
            .await
            .unwrap();
        let hub = server.hub();
        assert_eq!(hub.subscriber_count(), 0);

        let mut ws = connect(server.local_addr()).await;
        send_recv(&mut ws, auth_msg(token.expose())).await;
        assert_eq!(hub.subscriber_count(), 1);

        // À la fermeture de la connexion, l'abonnement disparaît.
        ws.close(None).await.unwrap();
        for _ in 0..200 {
            if hub.subscriber_count() == 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("l'abonné n'a pas disparu après la fermeture");
    }

    #[tokio::test]
    async fn wrong_token_is_rejected_and_connection_closed() {
        let token = AuthToken::generate();
        let server = ApiServer::bind(0, token, Arc::new(Echo), NotificationHub::new())
            .await
            .unwrap();
        let mut ws = connect(server.local_addr()).await;
        let resp = send_recv(&mut ws, auth_msg("mauvais-jeton")).await;
        assert_eq!(resp["error"]["code"], UNAUTHORIZED);
        // La connexion est fermée par le serveur.
        loop {
            match ws.next().await {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                Some(Ok(_)) => continue,
            }
        }
    }

    #[tokio::test]
    async fn methods_require_authentication_first() {
        let token = AuthToken::generate();
        let server = ApiServer::bind(0, token, Arc::new(Echo), NotificationHub::new())
            .await
            .unwrap();
        let mut ws = connect(server.local_addr()).await;
        // Première requête ≠ auth : refusée, connexion fermée.
        let resp = send_recv(
            &mut ws,
            json!({"jsonrpc":"2.0","id":1,"method":"echo","params":{}}),
        )
        .await;
        assert_eq!(resp["error"]["code"], UNAUTHORIZED);
    }

    #[tokio::test]
    async fn malformed_json_yields_parse_error() {
        let token = AuthToken::generate();
        let server = ApiServer::bind(0, token.clone(), Arc::new(Echo), NotificationHub::new())
            .await
            .unwrap();
        let mut ws = connect(server.local_addr()).await;
        send_recv(&mut ws, auth_msg(token.expose())).await;
        ws.send(Message::Text("{pas du json".into())).await.unwrap();
        let resp = recv_json(&mut ws).await;
        assert_eq!(resp["error"]["code"], PARSE_ERROR);
    }

    #[test]
    fn origin_whitelist_accepts_app_and_rejects_foreign() {
        // Faille #7 : origines de l'application légitime acceptées.
        assert!(origin_allowed(None)); // WebView natif (pas d'en-tête)
        assert!(origin_allowed(Some("null"))); // contexte opaque
        assert!(origin_allowed(Some("tauri://localhost")));
        assert!(origin_allowed(Some("https://tauri.localhost")));
        assert!(origin_allowed(Some("http://localhost:1420")));
        assert!(origin_allowed(Some("http://127.0.0.1:5173")));
        assert!(origin_allowed(Some("http://[::1]:8080")));
        // Origines web étrangères refusées (y compris les leurres).
        assert!(!origin_allowed(Some("https://evil.example")));
        assert!(!origin_allowed(Some("http://localhost.evil.com")));
        assert!(!origin_allowed(Some("https://tauri.localhost.evil.com")));
        assert!(!origin_allowed(Some("ftp://localhost")));
        assert!(!origin_allowed(Some("pas-une-origine")));
    }

    #[tokio::test]
    async fn foreign_origin_is_rejected() {
        // Faille #7 : une page web arbitraire (Origin étranger) est refusée au
        // handshake WebSocket.
        let token = AuthToken::generate();
        let server = ApiServer::bind(0, token, Arc::new(Echo), NotificationHub::new())
            .await
            .unwrap();
        let mut request = format!("ws://{}", server.local_addr())
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Origin", "https://evil.example".parse().unwrap());
        assert!(
            tokio_tungstenite::connect_async(request).await.is_err(),
            "une origine web étrangère doit être refusée au handshake"
        );
    }

    #[tokio::test]
    async fn tauri_origin_is_accepted() {
        // Faille #7 : l'origine `tauri://localhost` (app légitime) est acceptée.
        let token = AuthToken::generate();
        let server = ApiServer::bind(0, token.clone(), Arc::new(Echo), NotificationHub::new())
            .await
            .unwrap();
        let mut request = format!("ws://{}", server.local_addr())
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Origin", "tauri://localhost".parse().unwrap());
        let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        let auth = send_recv(&mut ws, auth_msg(token.expose())).await;
        assert_eq!(auth["result"]["protocole"], API_VERSION);
    }

    #[tokio::test]
    async fn connection_limit_refuses_excess() {
        // Faille #5 : au-delà de la borne de connexions simultanées, toute
        // nouvelle connexion est refusée immédiatement.
        let token = AuthToken::generate();
        let limits = ServerLimits {
            max_connections: 2,
            ..ServerLimits::default()
        };
        let server = ApiServer::bind_with_limits(
            0,
            token.clone(),
            Arc::new(Echo),
            NotificationHub::new(),
            limits,
        )
        .await
        .unwrap();
        let addr = server.local_addr();

        // Deux connexions authentifiées occupent les deux permis.
        let mut a = connect(addr).await;
        send_recv(&mut a, auth_msg(token.expose())).await;
        let mut b = connect(addr).await;
        send_recv(&mut b, auth_msg(token.expose())).await;

        // La 3e connexion est refusée : soit connect échoue, soit elle est
        // fermée immédiatement sans pouvoir s'authentifier.
        match tokio_tungstenite::connect_async(format!("ws://{addr}")).await {
            Err(_) => {}
            Ok((mut c, _)) => match tokio::time::timeout(Duration::from_secs(2), c.next()).await {
                Ok(None) | Ok(Some(Err(_))) | Ok(Some(Ok(Message::Close(_)))) => {}
                other => panic!("3e connexion non refusée : {other:?}"),
            },
        }
        drop(a);
        drop(b);
    }

    #[tokio::test]
    async fn slow_handshake_times_out() {
        // Faille #6 : une connexion TCP qui n'achève jamais l'upgrade WebSocket
        // est abandonnée passé le délai de handshake.
        use tokio::io::AsyncReadExt;
        let token = AuthToken::generate();
        let limits = ServerLimits {
            handshake_timeout: Duration::from_millis(150),
            ..ServerLimits::default()
        };
        let server =
            ApiServer::bind_with_limits(0, token, Arc::new(Echo), NotificationHub::new(), limits)
                .await
                .unwrap();
        // Connexion TCP brute : n'envoie jamais l'upgrade WebSocket.
        let mut raw = TcpStream::connect(server.local_addr()).await.unwrap();
        let mut buf = [0u8; 1];
        match tokio::time::timeout(Duration::from_secs(2), raw.read(&mut buf)).await {
            Ok(Ok(0)) => {}  // EOF : le serveur a fermé après le délai
            Ok(Err(_)) => {} // reset
            Ok(Ok(_)) => panic!("le serveur a répondu au lieu d'abandonner"),
            Err(_) => panic!("le serveur n'a pas fermé la connexion lente"),
        }
    }
}
