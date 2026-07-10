//! Serveur WebSocket JSON-RPC 2.0 local d'Accord.
//!
//! Frontière UI ↔ nœud : l'interface (Tauri/WebView ou tout client local)
//! parle exclusivement à ce serveur, lié à `127.0.0.1`, authentifié par
//! jeton de session. Les méthodes elles-mêmes sont fournies par
//! `accord-node` via le trait [`Service`] ; ce crate ne connaît ni le
//! réseau P2P ni la base locale.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod auth;
pub mod rpc;
pub mod server;

pub use auth::AuthToken;
pub use rpc::{RpcError, RpcNotification, RpcRequest, RpcResponse};
pub use server::{ApiServer, NotificationHub, Service, API_VERSION};
