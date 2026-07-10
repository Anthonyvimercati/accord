//! Aide au NAT traversal (SPEC §11) : agrégation de candidats d'adresses et
//! détection de NAT symétrique par recoupement d'observations.

use std::collections::HashMap;
use std::net::SocketAddr;

/// Classe d'un candidat d'adresse, par ordre de préférence d'essai.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CandidateKind {
    /// Adresse locale directe (LAN).
    LocalDirect = 0,
    /// Adresse publique directe (port mappé stable).
    PublicDirect = 1,
    /// Candidat de hole punching.
    HolePunch = 2,
    /// Repli par relais.
    Relay = 3,
}

/// Candidat d'adresse pour l'établissement de session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Candidate {
    /// Adresse à essayer.
    pub addr: SocketAddr,
    /// Classe du candidat (ordre d'essai).
    pub kind: CandidateKind,
}

/// Agrège les observations d'adresse publique depuis plusieurs pairs pour
/// détecter un NAT symétrique (SPEC §11 : réponses croisées de 3 nœuds).
#[derive(Default)]
pub struct ObservedAddrs {
    votes: HashMap<SocketAddr, u32>,
}

impl ObservedAddrs {
    /// Crée un agrégateur vide.
    pub fn new() -> Self {
        Self::default()
    }

    /// Enregistre une adresse observée par un pair.
    pub fn observe(&mut self, addr: SocketAddr) {
        *self.votes.entry(addr).or_insert(0) += 1;
    }

    /// Adresse publique consensuelle si ≥ 2 pairs concordent (sur 3).
    pub fn consensus(&self) -> Option<SocketAddr> {
        self.votes
            .iter()
            .filter(|(_, &v)| v >= 2)
            .max_by_key(|(_, &v)| v)
            .map(|(addr, _)| *addr)
    }

    /// Vrai si les observations divergent : NAT symétrique probable
    /// (adresses/ports différents selon le pair interrogé).
    pub fn is_symmetric(&self) -> bool {
        self.votes.len() >= 2 && self.consensus().is_none()
    }

    /// Nombre total d'observations distinctes.
    pub fn distinct(&self) -> usize {
        self.votes.len()
    }
}

/// Construit la liste ordonnée des candidats à essayer (SPEC §11 étape 3).
pub fn ordered_candidates(
    local: &[SocketAddr],
    public: Option<SocketAddr>,
    relays: &[SocketAddr],
    symmetric: bool,
) -> Vec<Candidate> {
    let mut out = Vec::new();
    for a in local {
        out.push(Candidate {
            addr: *a,
            kind: CandidateKind::LocalDirect,
        });
    }
    if let Some(p) = public {
        // Sous NAT symétrique, l'adresse publique n'est pas réutilisable en
        // direct : on la classe comme hole punch plutôt que direct.
        out.push(Candidate {
            addr: p,
            kind: if symmetric {
                CandidateKind::HolePunch
            } else {
                CandidateKind::PublicDirect
            },
        });
    }
    for r in relays {
        out.push(Candidate {
            addr: *r,
            kind: CandidateKind::Relay,
        });
    }
    out.sort_by_key(|c| c.kind);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn consensus_needs_two_votes() {
        let mut o = ObservedAddrs::new();
        o.observe(addr("1.2.3.4:5"));
        assert_eq!(o.consensus(), None);
        o.observe(addr("1.2.3.4:5"));
        assert_eq!(o.consensus(), Some(addr("1.2.3.4:5")));
    }

    #[test]
    fn divergent_observations_flag_symmetric() {
        let mut o = ObservedAddrs::new();
        o.observe(addr("1.2.3.4:5"));
        o.observe(addr("1.2.3.4:6"));
        assert!(o.is_symmetric());
        assert_eq!(o.consensus(), None);
    }

    #[test]
    fn candidate_ordering() {
        let cands = ordered_candidates(
            &[addr("192.168.0.2:4000")],
            Some(addr("9.9.9.9:5000")),
            &[addr("50.50.50.50:443")],
            false,
        );
        assert_eq!(cands[0].kind, CandidateKind::LocalDirect);
        assert_eq!(cands[1].kind, CandidateKind::PublicDirect);
        assert_eq!(cands[2].kind, CandidateKind::Relay);
    }

    #[test]
    fn symmetric_downgrades_public_to_holepunch() {
        let cands = ordered_candidates(&[], Some(addr("9.9.9.9:5000")), &[], true);
        assert_eq!(cands[0].kind, CandidateKind::HolePunch);
    }
}
