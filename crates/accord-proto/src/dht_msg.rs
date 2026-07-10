//! RPC Kademlia du canal DHT (SPEC §4).

use crate::limits;
use crate::types::{DhtRecord, NodeInfo};
use crate::wire::{DecodeError, Reader, WireDecode, WireEncode, Writer};

/// Corps d'un RPC DHT.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DhtBody {
    /// Sonde de vivacité DHT.
    Ping,
    /// Réponse à [`DhtBody::Ping`].
    Pong,
    /// Recherche des k nœuds les plus proches d'une cible.
    FindNode {
        /// Identifiant cible (256 bits).
        target: [u8; 32],
    },
    /// Réponse à [`DhtBody::FindNode`].
    FoundNodes {
        /// Jusqu'à k nœuds proches.
        nodes: Vec<NodeInfo>,
    },
    /// Recherche d'une valeur par clé.
    FindValue {
        /// Clé de stockage.
        key: [u8; 32],
    },
    /// Réponse à [`DhtBody::FindValue`].
    FoundValue {
        /// Record si trouvé localement.
        value: Option<DhtRecord>,
        /// Sinon, nœuds plus proches connus.
        nodes: Vec<NodeInfo>,
    },
    /// Demande de stockage d'un record signé.
    Store {
        /// Record à répliquer.
        record: DhtRecord,
    },
    /// Accusé de stockage.
    StoreOk,
    /// Erreur protocolaire (SPEC §12).
    Error {
        /// Code d'erreur.
        code: u8,
    },
}

/// RPC DHT complet : identifiant de corrélation + corps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DhtMessage {
    /// Identifiant aléatoire de 160 bits ; la réponse porte le même.
    pub rpc_id: [u8; 20],
    /// Corps du RPC.
    pub body: DhtBody,
}

impl WireEncode for DhtMessage {
    fn encode(&self, w: &mut Writer) {
        w.put_arr(&self.rpc_id);
        match &self.body {
            DhtBody::Ping => w.put_u8(0x01),
            DhtBody::Pong => w.put_u8(0x02),
            DhtBody::FindNode { target } => {
                w.put_u8(0x03);
                w.put_arr(target);
            }
            DhtBody::FoundNodes { nodes } => {
                w.put_u8(0x04);
                w.put_list(nodes, |w, n| n.encode(w));
            }
            DhtBody::FindValue { key } => {
                w.put_u8(0x05);
                w.put_arr(key);
            }
            DhtBody::FoundValue { value, nodes } => {
                w.put_u8(0x06);
                w.put_opt(value.as_ref(), |w, v| v.encode(w));
                w.put_list(nodes, |w, n| n.encode(w));
            }
            DhtBody::Store { record } => {
                w.put_u8(0x07);
                record.encode(w);
            }
            DhtBody::StoreOk => w.put_u8(0x08),
            DhtBody::Error { code } => {
                w.put_u8(0x7F);
                w.put_u8(*code);
            }
        }
    }
}

impl WireDecode for DhtMessage {
    fn decode(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let rpc_id = r.arr()?;
        let body = match r.u8()? {
            0x01 => DhtBody::Ping,
            0x02 => DhtBody::Pong,
            0x03 => DhtBody::FindNode { target: r.arr()? },
            0x04 => DhtBody::FoundNodes {
                nodes: r.list(limits::DHT_K, "found_nodes", NodeInfo::decode)?,
            },
            0x05 => DhtBody::FindValue { key: r.arr()? },
            0x06 => DhtBody::FoundValue {
                value: r.opt(DhtRecord::decode)?,
                nodes: r.list(limits::DHT_K, "found_value.nodes", NodeInfo::decode)?,
            },
            0x07 => DhtBody::Store {
                record: DhtRecord::decode(r)?,
            },
            0x08 => DhtBody::StoreOk,
            0x7F => DhtBody::Error { code: r.u8()? },
            _ => return Err(DecodeError::InvalidValue("dht kind")),
        };
        Ok(DhtMessage { rpc_id, body })
    }
}
