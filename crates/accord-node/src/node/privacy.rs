//! Privacy dashboard (Lot E3): read-only report of what this device stores
//! (all of it local, encrypted at rest) and of the only kinds of endpoints
//! the node ever talks to (bootstrap peers, DHT nodes, relays — all of them
//! ordinary peers, never a central server). Nothing here mutates state and
//! nothing leaves the device.

use serde::Serialize;

use crate::error::NodeError;

use super::Node;

/// JSON contract of `privacy.report` (additive fields only from now on).
#[derive(Debug, Clone, Serialize)]
pub struct PrivacyReport {
    /// What is stored on THIS device.
    pub counts: PrivacyCounts,
    /// Where and how it is stored.
    pub storage: PrivacyStorage,
    /// What kinds of endpoints the node talks to.
    pub egress: PrivacyEgress,
}

/// Local data counts.
#[derive(Debug, Clone, Serialize)]
pub struct PrivacyCounts {
    /// Confirmed friends.
    pub friends: u64,
    /// Direct messages kept locally.
    pub dm_messages: u64,
    /// Groups joined.
    pub groups: u64,
    /// Group messages kept locally.
    pub group_messages: u64,
    /// Files in the local store (attachments, media).
    pub files: u64,
    /// Pinned direct messages.
    pub pins: u64,
}

/// Local storage facts.
#[derive(Debug, Clone, Serialize)]
pub struct PrivacyStorage {
    /// Size of the database file on disk (bytes), `null` if unknown.
    pub db_bytes: Option<u64>,
    /// Declared total size of stored files (bytes).
    pub file_bytes: u64,
    /// The database is encrypted at rest (SQLCipher) — always true, stated
    /// explicitly so the UI can show it as a verified fact, not a slogan.
    pub db_encrypted_at_rest: bool,
}

/// Kinds of endpoints contacted, with live counts when the network runtime
/// is up. Every endpoint is an ordinary peer: `central_servers` is 0 by
/// construction and will stay 0.
#[derive(Debug, Clone, Serialize)]
pub struct PrivacyEgress {
    /// False when the node runs without its network runtime (tests, tools):
    /// the remaining fields are then all zero.
    pub available: bool,
    /// Configured bootstrap peers (first-contact seeding only).
    pub bootstrap_peers: u64,
    /// Nodes currently known in the Kademlia routing table.
    pub dht_nodes: u64,
    /// Peers with a learned session (address book).
    pub connected_peers: u64,
    /// Relay circuits opened since startup (E2E-encrypted fallback links).
    pub relay_circuits: u64,
    /// Central servers contacted. Always 0: there are none in the protocol.
    pub central_servers: u64,
}

impl Node {
    /// Builds the read-only privacy report.
    pub fn privacy_report(&self) -> Result<PrivacyReport, NodeError> {
        let stats = self.with_db(|db| Ok(db.storage_stats()?))?;
        let egress = match self.network_control() {
            Some(ctrl) => {
                let status = ctrl.status();
                let counters = ctrl.counters();
                PrivacyEgress {
                    available: true,
                    bootstrap_peers: status.bootstrap.len() as u64,
                    dht_nodes: status.dht_nodes as u64,
                    connected_peers: status.connected_peers as u64,
                    relay_circuits: counters.relay.open_ok,
                    central_servers: 0,
                }
            }
            None => PrivacyEgress {
                available: false,
                bootstrap_peers: 0,
                dht_nodes: 0,
                connected_peers: 0,
                relay_circuits: 0,
                central_servers: 0,
            },
        };
        Ok(PrivacyReport {
            counts: PrivacyCounts {
                friends: stats.friends,
                dm_messages: stats.dm_messages,
                groups: stats.groups,
                group_messages: stats.group_messages,
                files: stats.files,
                pins: stats.pins,
            },
            storage: PrivacyStorage {
                db_bytes: stats.db_bytes,
                file_bytes: stats.file_bytes,
                db_encrypted_at_rest: true,
            },
            egress,
        })
    }
}
