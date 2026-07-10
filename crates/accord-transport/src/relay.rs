//! Relais de repli décentralisé (SPEC §10) : gestion des circuits côté relais,
//! avec plafond de bande passante par circuit et équité round-robin.
//!
//! Le relais n'achemine que des blobs opaques : ce sont des paquets DATA d'une
//! session bout-en-bout entre les deux pairs. Le relais ne peut rien déchiffrer.

use accord_proto::types::NodeId;
use std::collections::HashMap;

/// Plafond de débit par circuit (octets/seconde), configurable (défaut 1 Mo/s).
pub const DEFAULT_RELAY_CAP_BPS: u64 = 1_000_000;

/// Nombre maximal de circuits simultanés hébergés par un relais.
pub const MAX_CIRCUITS: usize = 64;

/// État d'un circuit relayé.
struct Circuit {
    /// Pair A (initiateur du circuit).
    a: NodeId,
    /// Pair B (cible).
    b: NodeId,
    /// Octets transmis dans la fenêtre courante.
    bytes_in_window: u64,
    /// Début de la fenêtre de comptage (ms).
    window_start_ms: u64,
}

/// Table des circuits d'un relais.
pub struct RelayTable {
    circuits: HashMap<u32, Circuit>,
    next_id: u32,
    cap_bps: u64,
}

/// Résultat d'une tentative d'acheminement.
#[derive(Debug, PartialEq, Eq)]
pub enum RelayDecision {
    /// Acheminer vers ce pair.
    Forward(NodeId),
    /// Circuit inconnu.
    Unknown,
    /// Plafond de débit atteint : rejeter ce blob.
    Throttled,
}

impl RelayTable {
    /// Crée une table vide avec le plafond de débit donné.
    pub fn new(cap_bps: u64) -> Self {
        Self {
            circuits: HashMap::new(),
            next_id: 1,
            cap_bps,
        }
    }

    /// Nombre de circuits actifs.
    pub fn len(&self) -> usize {
        self.circuits.len()
    }

    /// Vrai si aucun circuit n'est actif.
    pub fn is_empty(&self) -> bool {
        self.circuits.is_empty()
    }

    /// Ouvre un circuit entre `a` et `b`. `None` si le relais est saturé.
    pub fn open(&mut self, a: NodeId, b: NodeId, now_ms: u64) -> Option<u32> {
        if self.circuits.len() >= MAX_CIRCUITS {
            return None;
        }
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        self.circuits.insert(
            id,
            Circuit {
                a,
                b,
                bytes_in_window: 0,
                window_start_ms: now_ms,
            },
        );
        Some(id)
    }

    /// Décide de l'acheminement d'un blob de `len` octets venant de `from`.
    pub fn forward(
        &mut self,
        circuit: u32,
        from: NodeId,
        len: usize,
        now_ms: u64,
    ) -> RelayDecision {
        let cap = self.cap_bps;
        let Some(c) = self.circuits.get_mut(&circuit) else {
            return RelayDecision::Unknown;
        };
        // Fenêtre glissante d'une seconde pour le plafond de débit.
        if now_ms.saturating_sub(c.window_start_ms) >= 1000 {
            c.bytes_in_window = 0;
            c.window_start_ms = now_ms;
        }
        if c.bytes_in_window + len as u64 > cap {
            return RelayDecision::Throttled;
        }
        c.bytes_in_window += len as u64;
        // Achemine vers l'autre extrémité du circuit.
        if from == c.a {
            RelayDecision::Forward(c.b)
        } else if from == c.b {
            RelayDecision::Forward(c.a)
        } else {
            RelayDecision::Unknown
        }
    }

    /// Ferme un circuit.
    pub fn close(&mut self, circuit: u32) {
        self.circuits.remove(&circuit);
    }

    /// Ferme un circuit UNIQUEMENT si `from` en est une extrémité (`a` ou `b`),
    /// à l'image de la vérification de provenance de [`RelayTable::forward`].
    /// Un pair tiers — même doté d'une session directe avec le relais — ne peut
    /// donc pas fermer un circuit hébergé entre deux autres nœuds en devinant son
    /// identifiant (FAILLE D). Rend `true` si un circuit a effectivement été fermé.
    pub fn close_by(&mut self, circuit: u32, from: NodeId) -> bool {
        match self.circuits.get(&circuit) {
            Some(c) if from == c.a || from == c.b => {
                self.circuits.remove(&circuit);
                true
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(n: u8) -> NodeId {
        NodeId([n; 32])
    }

    #[test]
    fn open_forward_both_directions() {
        let mut t = RelayTable::new(DEFAULT_RELAY_CAP_BPS);
        let id = t.open(node(1), node(2), 0).unwrap();
        assert_eq!(
            t.forward(id, node(1), 100, 0),
            RelayDecision::Forward(node(2))
        );
        assert_eq!(
            t.forward(id, node(2), 100, 0),
            RelayDecision::Forward(node(1))
        );
        assert_eq!(t.forward(id, node(3), 100, 0), RelayDecision::Unknown);
        assert_eq!(t.forward(999, node(1), 100, 0), RelayDecision::Unknown);
    }

    #[test]
    fn bandwidth_cap_enforced_and_resets() {
        let mut t = RelayTable::new(1000);
        let id = t.open(node(1), node(2), 0).unwrap();
        assert_eq!(
            t.forward(id, node(1), 800, 0),
            RelayDecision::Forward(node(2))
        );
        assert_eq!(t.forward(id, node(1), 300, 0), RelayDecision::Throttled);
        // Nouvelle fenêtre après 1 s.
        assert_eq!(
            t.forward(id, node(1), 300, 1000),
            RelayDecision::Forward(node(2))
        );
    }

    #[test]
    fn circuit_cap_enforced() {
        let mut t = RelayTable::new(DEFAULT_RELAY_CAP_BPS);
        for _ in 0..MAX_CIRCUITS {
            assert!(t.open(node(1), node(2), 0).is_some());
        }
        assert!(t.open(node(1), node(2), 0).is_none());
        assert_eq!(t.len(), MAX_CIRCUITS);
    }

    #[test]
    fn close_removes_circuit() {
        let mut t = RelayTable::new(DEFAULT_RELAY_CAP_BPS);
        let id = t.open(node(1), node(2), 0).unwrap();
        t.close(id);
        assert!(t.is_empty());
        assert_eq!(t.forward(id, node(1), 1, 0), RelayDecision::Unknown);
    }

    #[test]
    fn close_by_requires_endpoint_provenance() {
        // FAILLE D (côté serveur) : seule une extrémité du circuit peut le fermer.
        let mut t = RelayTable::new(DEFAULT_RELAY_CAP_BPS);
        let id = t.open(node(1), node(2), 0).unwrap();
        // Un tiers (node 3) ne peut pas fermer un circuit entre 1 et 2.
        assert!(!t.close_by(id, node(3)));
        assert_eq!(t.len(), 1, "le circuit tiers n'a pas été fermé");
        // Chaque extrémité, elle, le peut.
        assert!(t.close_by(id, node(2)));
        assert!(t.is_empty());
        // Fermer un circuit inconnu est un non-op sûr.
        assert!(!t.close_by(999, node(1)));
    }
}
