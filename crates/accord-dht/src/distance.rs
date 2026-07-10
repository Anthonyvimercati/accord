//! Métrique de distance XOR sur l'espace d'identifiants 256 bits (SPEC §4).

use accord_proto::types::NodeId;
use std::cmp::Ordering;

/// Distance XOR entre deux identifiants, comparable par ordre big-endian.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Distance(pub [u8; 32]);

impl Distance {
    /// Distance entre `a` et `b`.
    pub fn between(a: &NodeId, b: &NodeId) -> Self {
        Distance(a.distance(b))
    }

    /// Vrai si la distance est nulle (identifiants identiques).
    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|b| *b == 0)
    }
}

impl PartialOrd for Distance {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Distance {
    fn cmp(&self, other: &Self) -> Ordering {
        // Comparaison big-endian octet par octet.
        self.0.cmp(&other.0)
    }
}

/// Trie une liste d'identifiants par proximité croissante à `target`.
pub fn sort_by_distance<T>(items: &mut [T], target: &NodeId, id_of: impl Fn(&T) -> NodeId) {
    items.sort_by_key(|item| Distance::between(&id_of(item), target).0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_symmetry_and_zero() {
        let a = NodeId([0x0F; 32]);
        let b = NodeId([0xF0; 32]);
        assert_eq!(Distance::between(&a, &b), Distance::between(&b, &a));
        assert!(Distance::between(&a, &a).is_zero());
    }

    #[test]
    fn ordering_is_bitwise() {
        let target = NodeId([0; 32]);
        let mut close = [0u8; 32];
        close[31] = 1;
        let mut far = [0u8; 32];
        far[0] = 1;
        assert!(
            Distance::between(&NodeId(close), &target) < Distance::between(&NodeId(far), &target)
        );
    }

    #[test]
    fn sort_orders_by_proximity() {
        let target = NodeId([0; 32]);
        let mut ids = vec![NodeId([8; 32]), NodeId([1; 32]), NodeId([4; 32])];
        sort_by_distance(&mut ids, &target, |id| *id);
        assert_eq!(ids[0], NodeId([1; 32]));
        assert_eq!(ids[2], NodeId([8; 32]));
    }
}
