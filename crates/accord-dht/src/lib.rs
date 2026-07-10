//! DHT Kademlia d'Accord (SPEC §4).
//!
//! Table de routage à 256 seaux (k = 20, diversité IP par préfixe), magasin
//! de records signés à expiration bornée, lookups itératifs α-parallèles
//! ([`find_node`] / [`find_value`] avec croisement de chemins disjoints), et
//! défenses anti-Sybil (validation PoW des [`NodeInfo`], anti-abus par IP).
//!
//! Le nœud complet est [`KademliaNode`] : traitement synchrone des RPC
//! entrants (`handle_rpc`) et opérations itératives asynchrones via
//! l'abstraction [`DhtRpc`], indépendante du transport réel.
//!
//! [`NodeInfo`]: accord_proto::types::NodeInfo

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod distance;
pub mod lookup;
pub mod node;
pub mod routing;
pub mod rpc;
pub mod store;

#[cfg(test)]
mod testnet;

pub use distance::Distance;
pub use lookup::{find_node, find_value, find_value_bounded, ValueResult};
pub use node::{DhtConfig, KademliaNode};
pub use routing::{InsertOutcome, RoutingTable};
pub use rpc::{filter_valid, valid_node, DhtRpc};
pub use store::{RecordStore, StoreError};
