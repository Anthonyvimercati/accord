//! Machine d'états des appels vocaux 1-à-1 (sonnerie, acceptation, refus,
//! occupé, timeout). Pure : aucune E/S ni horloge propre — le moteur voix
//! ([`super::engine`]) fournit `now_ms` et exécute les [`CallAction`]
//! décidées ici, ce qui rend chaque transition testable au tick près.
//!
//! Sécurité (P2P public) :
//! - une offre entrante n'est honorée que d'un AMI confirmé (vérifié par le
//!   moteur AVANT d'appeler [`CallMachine::on_offer`]) ;
//! - cadence par pair : au plus une NOUVELLE sonnerie par
//!   [`NEW_RING_MIN_INTERVAL_MS`] et une réponse « occupé » par
//!   [`BUSY_REPLY_MIN_INTERVAL_MS`] (zéro amplification : un non-ami ne
//!   déclenche jamais aucune réponse, un ami au plus un petit message par
//!   fenêtre) ;
//! - anti-rejeu : `CallAnswer`/`CallDecline`/`CallHangup` ne sont honorés que
//!   s'ils corrèlent exactement l'appel courant (pair émetteur + `call_id`) ;
//!   tout le reste est ignoré en silence ;
//! - suivi par pair borné ([`PEER_TRACKING_MAX`]) : pas de croissance mémoire
//!   sous pseudo-identités.

use std::collections::HashMap;

use accord_proto::core_msg::CALL_DECLINE_BUSY;

/// Durée de sonnerie avant abandon, des deux côtés (ms).
pub(crate) const RING_TIMEOUT_MS: u64 = 45_000;

/// Période de réémission de l'offre pendant la sonnerie sortante (ms) : les
/// offres voyagent en datagrammes avec pertes, l'appelé déduplique par
/// `call_id`.
pub(crate) const OFFER_RESEND_MS: u64 = 2_000;

/// Intervalle minimal entre deux NOUVELLES sonneries entrantes d'un même pair
/// (ms) — anti sonnerie-spam ; les réémissions d'une même offre (`call_id`
/// identique) ne comptent pas.
pub(crate) const NEW_RING_MIN_INTERVAL_MS: u64 = 3_000;

/// Intervalle minimal entre deux réponses « occupé » à un même pair (ms) :
/// borne l'amplification à moins d'un petit message par offre reçue.
pub(crate) const BUSY_REPLY_MIN_INTERVAL_MS: u64 = 2_000;

/// Borne du suivi de cadence par pair (au-delà, table réinitialisée — même
/// motif que le suivi de débit du service de fichiers).
const PEER_TRACKING_MAX: usize = 256;

/// Phase d'un appel, exposée par `calls.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallPhase {
    /// Aucun appel.
    Idle,
    /// Notre offre sonne chez le pair.
    OutgoingRinging,
    /// L'offre d'un pair sonne chez nous.
    IncomingRinging,
    /// Appel accepté, session audio en cours.
    Active,
}

impl CallPhase {
    /// Libellé stable du contrat API (`calls.status`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::OutgoingRinging => "outgoing_ringing",
            Self::IncomingRinging => "incoming_ringing",
            Self::Active => "active",
        }
    }
}

/// Photographie de l'appel courant (`calls.status`).
#[derive(Debug, Clone, Copy)]
pub struct CallSnapshot {
    /// Phase courante.
    pub phase: CallPhase,
    /// Pair de l'appel (absent au repos).
    pub peer: Option<[u8; 32]>,
    /// Identifiant de l'appel (absent au repos).
    pub call_id: Option<[u8; 16]>,
    /// Début de la phase courante (ms de l'horloge du moteur).
    pub since_ms: Option<u64>,
}

/// Action décidée par la machine, exécutée par le moteur voix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CallAction {
    /// Émettre `CallOffer` au pair.
    SendOffer {
        /// Destinataire.
        to: [u8; 32],
        /// Appel offert.
        call_id: [u8; 16],
    },
    /// Émettre `CallAnswer` au pair.
    SendAnswer {
        /// Destinataire.
        to: [u8; 32],
        /// Appel accepté.
        call_id: [u8; 16],
    },
    /// Émettre `CallDecline` au pair.
    SendDecline {
        /// Destinataire.
        to: [u8; 32],
        /// Appel refusé.
        call_id: [u8; 16],
        /// 0 = refusé, 1 = occupé.
        reason: u8,
    },
    /// Émettre `CallHangup` au pair.
    SendHangup {
        /// Destinataire.
        to: [u8; 32],
        /// Appel terminé.
        call_id: [u8; 16],
    },
    /// Démarrer la session audio de l'appel (salon `room == call_id`).
    JoinAudio {
        /// Pair de l'appel.
        peer: [u8; 32],
        /// Salon audio de l'appel.
        call_id: [u8; 16],
    },
    /// Quitter la session audio de l'appel.
    LeaveAudio,
    /// Émettre `event.call_incoming`.
    EventIncoming {
        /// Appelant.
        peer: [u8; 32],
        /// Appel offert.
        call_id: [u8; 16],
    },
    /// Émettre `event.call_outgoing`.
    EventOutgoing {
        /// Appelé.
        peer: [u8; 32],
        /// Appel offert.
        call_id: [u8; 16],
    },
    /// Émettre `event.call_accepted`.
    EventAccepted {
        /// Pair de l'appel.
        peer: [u8; 32],
        /// Appel accepté.
        call_id: [u8; 16],
    },
    /// Émettre `event.call_ended`.
    EventEnded {
        /// Pair de l'appel.
        peer: [u8; 32],
        /// Appel terminé.
        call_id: [u8; 16],
        /// Raison stable du contrat API.
        reason: &'static str,
    },
}

/// État interne.
#[derive(Debug)]
enum State {
    Idle,
    Outgoing {
        peer: [u8; 32],
        call_id: [u8; 16],
        started_ms: u64,
        last_offer_ms: u64,
    },
    Incoming {
        peer: [u8; 32],
        call_id: [u8; 16],
        received_ms: u64,
    },
    Active {
        peer: [u8; 32],
        call_id: [u8; 16],
        connected_ms: u64,
    },
}

/// Machine d'états d'appel (un seul appel à la fois).
pub(crate) struct CallMachine {
    /// Clé publique locale (résolution déterministe des appels croisés).
    me: [u8; 32],
    state: State,
    /// Dernière NOUVELLE sonnerie créée par pair (cadence, borné).
    last_ring_ms: HashMap<[u8; 32], u64>,
    /// Dernière réponse « occupé » émise par pair (cadence, borné).
    last_busy_ms: HashMap<[u8; 32], u64>,
}

impl CallMachine {
    /// Machine au repos.
    pub(crate) fn new(me: [u8; 32]) -> Self {
        Self {
            me,
            state: State::Idle,
            last_ring_ms: HashMap::new(),
            last_busy_ms: HashMap::new(),
        }
    }

    /// Photographie de l'appel courant.
    pub(crate) fn snapshot(&self) -> CallSnapshot {
        match &self.state {
            State::Idle => CallSnapshot {
                phase: CallPhase::Idle,
                peer: None,
                call_id: None,
                since_ms: None,
            },
            State::Outgoing {
                peer,
                call_id,
                started_ms,
                ..
            } => CallSnapshot {
                phase: CallPhase::OutgoingRinging,
                peer: Some(*peer),
                call_id: Some(*call_id),
                since_ms: Some(*started_ms),
            },
            State::Incoming {
                peer,
                call_id,
                received_ms,
            } => CallSnapshot {
                phase: CallPhase::IncomingRinging,
                peer: Some(*peer),
                call_id: Some(*call_id),
                since_ms: Some(*received_ms),
            },
            State::Active {
                peer,
                call_id,
                connected_ms,
            } => CallSnapshot {
                phase: CallPhase::Active,
                peer: Some(*peer),
                call_id: Some(*call_id),
                since_ms: Some(*connected_ms),
            },
        }
    }

    /// `calls.start` : lance un appel sortant (la vérification d'amitié est
    /// faite par le moteur AVANT cet appel). Erreur explicite si un appel est
    /// déjà en cours.
    pub(crate) fn start(
        &mut self,
        peer: [u8; 32],
        call_id: [u8; 16],
        now_ms: u64,
    ) -> Result<Vec<CallAction>, &'static str> {
        if !matches!(self.state, State::Idle) {
            return Err("appel déjà en cours");
        }
        self.state = State::Outgoing {
            peer,
            call_id,
            started_ms: now_ms,
            last_offer_ms: now_ms,
        };
        Ok(vec![
            CallAction::SendOffer { to: peer, call_id },
            CallAction::EventOutgoing { peer, call_id },
        ])
    }

    /// `calls.accept` : accepte la sonnerie entrante identifiée par `call_id`.
    pub(crate) fn accept(
        &mut self,
        call_id: [u8; 16],
        now_ms: u64,
    ) -> Result<Vec<CallAction>, &'static str> {
        let State::Incoming {
            peer,
            call_id: ringing,
            ..
        } = self.state
        else {
            return Err("aucun appel entrant à accepter");
        };
        if ringing != call_id {
            return Err("identifiant d'appel inconnu");
        }
        self.state = State::Active {
            peer,
            call_id,
            connected_ms: now_ms,
        };
        Ok(vec![
            CallAction::SendAnswer { to: peer, call_id },
            CallAction::JoinAudio { peer, call_id },
            CallAction::EventAccepted { peer, call_id },
        ])
    }

    /// `calls.decline` : refuse la sonnerie entrante identifiée par `call_id`.
    pub(crate) fn decline(&mut self, call_id: [u8; 16]) -> Result<Vec<CallAction>, &'static str> {
        let State::Incoming {
            peer,
            call_id: ringing,
            ..
        } = self.state
        else {
            return Err("aucun appel entrant à refuser");
        };
        if ringing != call_id {
            return Err("identifiant d'appel inconnu");
        }
        self.state = State::Idle;
        Ok(vec![
            CallAction::SendDecline {
                to: peer,
                call_id,
                reason: accord_proto::core_msg::CALL_DECLINE_REJECTED,
            },
            CallAction::EventEnded {
                peer,
                call_id,
                reason: "declined",
            },
        ])
    }

    /// `calls.hangup` : termine l'appel courant quelle que soit sa phase
    /// (annulation d'une sonnerie sortante, refus d'une entrante, raccrochage
    /// d'un appel actif). Idempotent au repos.
    pub(crate) fn hangup(&mut self) -> Vec<CallAction> {
        match std::mem::replace(&mut self.state, State::Idle) {
            State::Idle => vec![],
            State::Outgoing { peer, call_id, .. } => vec![
                CallAction::SendHangup { to: peer, call_id },
                CallAction::EventEnded {
                    peer,
                    call_id,
                    reason: "hangup",
                },
            ],
            State::Incoming { peer, call_id, .. } => vec![
                CallAction::SendDecline {
                    to: peer,
                    call_id,
                    reason: accord_proto::core_msg::CALL_DECLINE_REJECTED,
                },
                CallAction::EventEnded {
                    peer,
                    call_id,
                    reason: "declined",
                },
            ],
            State::Active { peer, call_id, .. } => vec![
                CallAction::SendHangup { to: peer, call_id },
                CallAction::LeaveAudio,
                CallAction::EventEnded {
                    peer,
                    call_id,
                    reason: "hangup",
                },
            ],
        }
    }

    /// Offre entrante d'un pair DÉJÀ vérifié ami par le moteur. Applique la
    /// cadence par pair, la déduplication par `call_id`, la réponse
    /// « occupé » bornée et la résolution déterministe des appels croisés.
    pub(crate) fn on_offer(
        &mut self,
        from: [u8; 32],
        call_id: [u8; 16],
        now_ms: u64,
    ) -> Vec<CallAction> {
        match &self.state {
            State::Idle => self.try_new_ring(from, call_id, now_ms),
            State::Incoming {
                peer,
                call_id: ringing,
                ..
            } => {
                if *peer == from && *ringing == call_id {
                    // Réémission de la même offre (pertes UDP) : dédupliquée,
                    // l'échéance d'origine est conservée (pas de sonnerie
                    // infinie en rejouant la même offre).
                    return vec![];
                }
                if *peer == from {
                    // Nouvelle offre du même pair : l'ancienne sonnerie est
                    // périmée (annulation perdue en route). Remplacement,
                    // sous la même cadence qu'une sonnerie neuve.
                    let (old_peer, old_call) = (*peer, *ringing);
                    let mut actions = self.try_new_ring(from, call_id, now_ms);
                    if !actions.is_empty() {
                        actions.insert(
                            0,
                            CallAction::EventEnded {
                                peer: old_peer,
                                call_id: old_call,
                                reason: "canceled",
                            },
                        );
                    }
                    return actions;
                }
                // Un autre pair appelle pendant qu'on sonne déjà : occupé.
                self.busy_reply(from, call_id, now_ms)
            }
            State::Outgoing {
                peer,
                call_id: ours,
                ..
            } => {
                if *peer != from {
                    return self.busy_reply(from, call_id, now_ms);
                }
                // Appel croisé (chacun appelle l'autre) : les deux côtés
                // convergent déterministiquement vers l'appel de la plus
                // petite clé publique — l'un accepte l'offre de l'autre,
                // l'autre ignore l'offre reçue et verra arriver la réponse.
                if from < self.me {
                    let ours = *ours;
                    self.state = State::Active {
                        peer: from,
                        call_id,
                        connected_ms: now_ms,
                    };
                    vec![
                        CallAction::EventEnded {
                            peer: from,
                            call_id: ours,
                            reason: "superseded",
                        },
                        CallAction::SendAnswer { to: from, call_id },
                        CallAction::JoinAudio {
                            peer: from,
                            call_id,
                        },
                        CallAction::EventAccepted {
                            peer: from,
                            call_id,
                        },
                    ]
                } else {
                    vec![] // Notre appel gagne : leur machine l'acceptera.
                }
            }
            State::Active {
                peer,
                call_id: current,
                ..
            } => {
                if *peer == from && *current == call_id {
                    // Notre réponse s'est perdue : le pair réémet son offre.
                    // On réémet la réponse (idempotent).
                    return vec![CallAction::SendAnswer { to: from, call_id }];
                }
                self.busy_reply(from, call_id, now_ms)
            }
        }
    }

    /// Réponse à notre offre : uniquement si elle corrèle l'appel sortant
    /// courant (pair + `call_id`), sinon ignorée (forgée, rejouée, périmée).
    pub(crate) fn on_answer(
        &mut self,
        from: [u8; 32],
        call_id: [u8; 16],
        now_ms: u64,
    ) -> Vec<CallAction> {
        let State::Outgoing {
            peer,
            call_id: ours,
            ..
        } = self.state
        else {
            return vec![];
        };
        if peer != from || ours != call_id {
            return vec![];
        }
        self.state = State::Active {
            peer,
            call_id,
            connected_ms: now_ms,
        };
        vec![
            CallAction::JoinAudio { peer, call_id },
            CallAction::EventAccepted { peer, call_id },
        ]
    }

    /// Refus de notre offre : mêmes corrélations strictes que la réponse.
    pub(crate) fn on_decline(
        &mut self,
        from: [u8; 32],
        call_id: [u8; 16],
        reason: u8,
    ) -> Vec<CallAction> {
        let State::Outgoing {
            peer,
            call_id: ours,
            ..
        } = self.state
        else {
            return vec![];
        };
        if peer != from || ours != call_id {
            return vec![];
        }
        self.state = State::Idle;
        vec![CallAction::EventEnded {
            peer,
            call_id,
            reason: if reason == CALL_DECLINE_BUSY {
                "busy"
            } else {
                "declined"
            },
        }]
    }

    /// Fin d'appel émise par le pair : corrélation stricte (pair + `call_id`)
    /// sur chaque phase, sinon ignorée.
    pub(crate) fn on_hangup(&mut self, from: [u8; 32], call_id: [u8; 16]) -> Vec<CallAction> {
        match &self.state {
            State::Outgoing {
                peer,
                call_id: ours,
                ..
            } if *peer == from && *ours == call_id => {
                self.state = State::Idle;
                vec![CallAction::EventEnded {
                    peer: from,
                    call_id,
                    reason: "hangup",
                }]
            }
            State::Incoming {
                peer,
                call_id: ringing,
                ..
            } if *peer == from && *ringing == call_id => {
                self.state = State::Idle;
                vec![CallAction::EventEnded {
                    peer: from,
                    call_id,
                    reason: "canceled",
                }]
            }
            State::Active {
                peer,
                call_id: current,
                ..
            } if *peer == from && *current == call_id => {
                self.state = State::Idle;
                vec![
                    CallAction::LeaveAudio,
                    CallAction::EventEnded {
                        peer: from,
                        call_id,
                        reason: "hangup",
                    },
                ]
            }
            _ => vec![],
        }
    }

    /// Vivacité audio perdue pendant un appel actif (le pair a disparu) :
    /// l'appel se termine proprement (le raccrochage émis est best-effort).
    pub(crate) fn on_audio_lost(&mut self) -> Vec<CallAction> {
        let State::Active { peer, call_id, .. } = self.state else {
            return vec![];
        };
        self.state = State::Idle;
        vec![
            CallAction::SendHangup { to: peer, call_id },
            CallAction::LeaveAudio,
            CallAction::EventEnded {
                peer,
                call_id,
                reason: "lost",
            },
        ]
    }

    /// L'utilisateur rejoint un salon vocal de groupe : un appel ACTIF se
    /// termine (le salon prend la session audio) ; une sonnerie survit.
    pub(crate) fn on_room_takeover(&mut self) -> Vec<CallAction> {
        match self.state {
            State::Active { peer, call_id, .. } => {
                self.state = State::Idle;
                vec![
                    CallAction::SendHangup { to: peer, call_id },
                    CallAction::EventEnded {
                        peer,
                        call_id,
                        reason: "hangup",
                    },
                ]
            }
            _ => vec![],
        }
    }

    /// Passe d'horloge : timeout des sonneries et réémission de l'offre.
    pub(crate) fn tick(&mut self, now_ms: u64) -> Vec<CallAction> {
        match &mut self.state {
            State::Outgoing {
                peer,
                call_id,
                started_ms,
                last_offer_ms,
            } => {
                let (peer, call_id) = (*peer, *call_id);
                if now_ms.saturating_sub(*started_ms) >= RING_TIMEOUT_MS {
                    self.state = State::Idle;
                    return vec![
                        CallAction::SendHangup { to: peer, call_id },
                        CallAction::EventEnded {
                            peer,
                            call_id,
                            reason: "timeout",
                        },
                    ];
                }
                if now_ms.saturating_sub(*last_offer_ms) >= OFFER_RESEND_MS {
                    *last_offer_ms = now_ms;
                    return vec![CallAction::SendOffer { to: peer, call_id }];
                }
                vec![]
            }
            State::Incoming {
                peer,
                call_id,
                received_ms,
            } => {
                if now_ms.saturating_sub(*received_ms) >= RING_TIMEOUT_MS {
                    let (peer, call_id) = (*peer, *call_id);
                    self.state = State::Idle;
                    return vec![CallAction::EventEnded {
                        peer,
                        call_id,
                        reason: "missed",
                    }];
                }
                vec![]
            }
            _ => vec![],
        }
    }

    /// Crée une nouvelle sonnerie entrante si la cadence du pair le permet
    /// (sinon : silence, aucune réponse — zéro amplification).
    fn try_new_ring(&mut self, from: [u8; 32], call_id: [u8; 16], now_ms: u64) -> Vec<CallAction> {
        if !Self::cadence_ok(
            &mut self.last_ring_ms,
            from,
            now_ms,
            NEW_RING_MIN_INTERVAL_MS,
        ) {
            return vec![];
        }
        self.state = State::Incoming {
            peer: from,
            call_id,
            received_ms: now_ms,
        };
        vec![CallAction::EventIncoming {
            peer: from,
            call_id,
        }]
    }

    /// Réponse « occupé » bornée par pair (au plus une par fenêtre).
    fn busy_reply(&mut self, from: [u8; 32], call_id: [u8; 16], now_ms: u64) -> Vec<CallAction> {
        if !Self::cadence_ok(
            &mut self.last_busy_ms,
            from,
            now_ms,
            BUSY_REPLY_MIN_INTERVAL_MS,
        ) {
            return vec![];
        }
        vec![CallAction::SendDecline {
            to: from,
            call_id,
            reason: CALL_DECLINE_BUSY,
        }]
    }

    /// Vrai si l'action est due pour ce pair (et l'enregistre). Table bornée.
    fn cadence_ok(
        table: &mut HashMap<[u8; 32], u64>,
        peer: [u8; 32],
        now_ms: u64,
        min_interval_ms: u64,
    ) -> bool {
        if table.len() > PEER_TRACKING_MAX {
            table.clear();
        }
        match table.get(&peer) {
            Some(&last) if now_ms.saturating_sub(last) < min_interval_ms => false,
            _ => {
                table.insert(peer, now_ms);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use accord_proto::core_msg::CALL_DECLINE_REJECTED;

    const ME: [u8; 32] = [0x50; 32];
    const ALICE: [u8; 32] = [0x10; 32]; // < ME : son appel gagne les croisés.
    const BOB: [u8; 32] = [0x90; 32]; // > ME : notre appel gagne les croisés.
    const CALL: [u8; 16] = [0xC1; 16];
    const CALL2: [u8; 16] = [0xC2; 16];

    fn machine() -> CallMachine {
        CallMachine::new(ME)
    }

    #[test]
    fn outgoing_call_rings_resends_and_times_out() {
        let mut m = machine();
        let actions = m.start(BOB, CALL, 0).unwrap();
        assert!(actions.contains(&CallAction::SendOffer {
            to: BOB,
            call_id: CALL
        }));
        assert!(actions.contains(&CallAction::EventOutgoing {
            peer: BOB,
            call_id: CALL
        }));
        assert_eq!(m.snapshot().phase, CallPhase::OutgoingRinging);

        // Un second appel simultané est refusé explicitement.
        assert!(m.start(ALICE, CALL2, 10).is_err());

        // Réémission de l'offre à cadence fixe.
        assert!(m.tick(OFFER_RESEND_MS - 1).is_empty());
        assert_eq!(
            m.tick(OFFER_RESEND_MS),
            vec![CallAction::SendOffer {
                to: BOB,
                call_id: CALL
            }]
        );

        // Timeout : raccrochage émis et événement de fin.
        let actions = m.tick(RING_TIMEOUT_MS);
        assert!(actions.contains(&CallAction::SendHangup {
            to: BOB,
            call_id: CALL
        }));
        assert!(actions.contains(&CallAction::EventEnded {
            peer: BOB,
            call_id: CALL,
            reason: "timeout",
        }));
        assert_eq!(m.snapshot().phase, CallPhase::Idle);
    }

    #[test]
    fn answer_connects_only_when_it_correlates() {
        let mut m = machine();
        m.start(BOB, CALL, 0).unwrap();
        // Réponse forgée : mauvais pair, mauvais call_id → ignorées.
        assert!(m.on_answer(ALICE, CALL, 10).is_empty());
        assert!(m.on_answer(BOB, CALL2, 10).is_empty());
        assert_eq!(m.snapshot().phase, CallPhase::OutgoingRinging);
        // Réponse corrélée : la session audio démarre.
        let actions = m.on_answer(BOB, CALL, 20);
        assert!(actions.contains(&CallAction::JoinAudio {
            peer: BOB,
            call_id: CALL
        }));
        assert_eq!(m.snapshot().phase, CallPhase::Active);
        // Rejouer la réponse une fois actif : sans effet.
        assert!(m.on_answer(BOB, CALL, 30).is_empty());
    }

    #[test]
    fn decline_and_busy_end_the_outgoing_call() {
        let mut m = machine();
        m.start(BOB, CALL, 0).unwrap();
        let actions = m.on_decline(BOB, CALL, CALL_DECLINE_REJECTED);
        assert_eq!(
            actions,
            vec![CallAction::EventEnded {
                peer: BOB,
                call_id: CALL,
                reason: "declined",
            }]
        );
        let mut m = machine();
        m.start(BOB, CALL, 0).unwrap();
        let actions = m.on_decline(BOB, CALL, CALL_DECLINE_BUSY);
        assert_eq!(
            actions[0],
            CallAction::EventEnded {
                peer: BOB,
                call_id: CALL,
                reason: "busy",
            }
        );
    }

    #[test]
    fn incoming_ring_accept_flow() {
        let mut m = machine();
        let actions = m.on_offer(ALICE, CALL, 0);
        assert_eq!(
            actions,
            vec![CallAction::EventIncoming {
                peer: ALICE,
                call_id: CALL
            }]
        );
        // Réémission de la même offre : dédupliquée, pas de nouvel événement.
        assert!(m.on_offer(ALICE, CALL, 500).is_empty());
        // Acceptation : réponse + session audio.
        let actions = m.accept(CALL, 1_000).unwrap();
        assert!(actions.contains(&CallAction::SendAnswer {
            to: ALICE,
            call_id: CALL
        }));
        assert!(actions.contains(&CallAction::JoinAudio {
            peer: ALICE,
            call_id: CALL
        }));
        assert_eq!(m.snapshot().phase, CallPhase::Active);
        // L'offre rejouée pendant l'appel actif réémet la réponse (perte).
        assert_eq!(
            m.on_offer(ALICE, CALL, 2_000),
            vec![CallAction::SendAnswer {
                to: ALICE,
                call_id: CALL
            }]
        );
    }

    #[test]
    fn incoming_ring_expires_as_missed() {
        let mut m = machine();
        m.on_offer(ALICE, CALL, 0);
        assert!(m.tick(RING_TIMEOUT_MS - 1).is_empty());
        assert_eq!(
            m.tick(RING_TIMEOUT_MS),
            vec![CallAction::EventEnded {
                peer: ALICE,
                call_id: CALL,
                reason: "missed",
            }]
        );
    }

    #[test]
    fn ring_spam_is_rate_limited_and_replay_does_not_extend_deadline() {
        let mut m = machine();
        m.on_offer(ALICE, CALL, 0);
        m.decline(CALL).unwrap();
        // Nouvelle sonnerie immédiate du même pair : sous la cadence, muette.
        assert!(m.on_offer(ALICE, CALL2, 100).is_empty());
        assert_eq!(m.snapshot().phase, CallPhase::Idle);
        // Après la fenêtre de cadence, une nouvelle sonnerie repasse.
        let actions = m.on_offer(ALICE, CALL2, NEW_RING_MIN_INTERVAL_MS);
        assert_eq!(actions.len(), 1);
        // Rejouer la même offre n'étend jamais l'échéance de sonnerie.
        for t in (NEW_RING_MIN_INTERVAL_MS..RING_TIMEOUT_MS).step_by(1_000) {
            assert!(m.on_offer(ALICE, CALL2, t).is_empty());
        }
        let expiry = m.tick(NEW_RING_MIN_INTERVAL_MS + RING_TIMEOUT_MS);
        assert_eq!(
            expiry,
            vec![CallAction::EventEnded {
                peer: ALICE,
                call_id: CALL2,
                reason: "missed",
            }]
        );
    }

    #[test]
    fn busy_reply_is_sent_once_per_window_and_only_when_busy() {
        let mut m = machine();
        m.start(BOB, CALL, 0).unwrap();
        // Alice appelle pendant notre appel sortant : occupé (une fois).
        let actions = m.on_offer(ALICE, CALL2, 10);
        assert_eq!(
            actions,
            vec![CallAction::SendDecline {
                to: ALICE,
                call_id: CALL2,
                reason: CALL_DECLINE_BUSY,
            }]
        );
        // Réémissions dans la fenêtre : silence (pas d'amplification).
        assert!(m.on_offer(ALICE, CALL2, 500).is_empty());
        assert!(m.on_offer(ALICE, CALL2, 1_999).is_empty());
        // Fenêtre écoulée : une seule nouvelle réponse.
        assert_eq!(
            m.on_offer(ALICE, CALL2, 10 + BUSY_REPLY_MIN_INTERVAL_MS)
                .len(),
            1
        );
    }

    #[test]
    fn cross_calls_converge_deterministically() {
        // Alice (clé plus petite) et nous nous appelons mutuellement.
        // Côté nous : notre sortant vers Alice + offre d'Alice → son appel
        // gagne, on l'accepte automatiquement.
        let mut m = machine();
        m.start(ALICE, CALL, 0).unwrap();
        let actions = m.on_offer(ALICE, CALL2, 10);
        assert!(actions.contains(&CallAction::SendAnswer {
            to: ALICE,
            call_id: CALL2
        }));
        assert!(actions.contains(&CallAction::EventEnded {
            peer: ALICE,
            call_id: CALL,
            reason: "superseded",
        }));
        assert_eq!(m.snapshot().phase, CallPhase::Active);
        assert_eq!(m.snapshot().call_id, Some(CALL2));

        // Côté symétrique : sortant vers Bob (clé plus grande) + offre de
        // Bob → notre appel gagne, son offre est ignorée.
        let mut m = machine();
        m.start(BOB, CALL, 0).unwrap();
        assert!(m.on_offer(BOB, CALL2, 10).is_empty());
        assert_eq!(m.snapshot().phase, CallPhase::OutgoingRinging);
    }

    #[test]
    fn hangup_covers_every_phase_and_is_idempotent() {
        // Au repos : rien.
        assert!(machine().hangup().is_empty());
        // Sonnerie sortante : annulation.
        let mut m = machine();
        m.start(BOB, CALL, 0).unwrap();
        let actions = m.hangup();
        assert!(actions.contains(&CallAction::SendHangup {
            to: BOB,
            call_id: CALL
        }));
        // Sonnerie entrante : refus.
        let mut m = machine();
        m.on_offer(ALICE, CALL, 0);
        let actions = m.hangup();
        assert!(actions.contains(&CallAction::SendDecline {
            to: ALICE,
            call_id: CALL,
            reason: CALL_DECLINE_REJECTED,
        }));
        // Appel actif : raccrochage + sortie audio.
        let mut m = machine();
        m.on_offer(ALICE, CALL, 0);
        m.accept(CALL, 10).unwrap();
        let actions = m.hangup();
        assert!(actions.contains(&CallAction::LeaveAudio));
        assert_eq!(m.snapshot().phase, CallPhase::Idle);
    }

    #[test]
    fn peer_hangup_correlates_strictly() {
        let mut m = machine();
        m.on_offer(ALICE, CALL, 0);
        m.accept(CALL, 10).unwrap();
        // Forgé : mauvais pair ou mauvais call_id → ignoré.
        assert!(m.on_hangup(BOB, CALL).is_empty());
        assert!(m.on_hangup(ALICE, CALL2).is_empty());
        assert_eq!(m.snapshot().phase, CallPhase::Active);
        // Corrélé : l'appel se termine.
        let actions = m.on_hangup(ALICE, CALL);
        assert!(actions.contains(&CallAction::LeaveAudio));
        assert_eq!(m.snapshot().phase, CallPhase::Idle);
    }

    #[test]
    fn caller_cancel_replaces_stale_ring_with_new_offer() {
        let mut m = machine();
        m.on_offer(ALICE, CALL, 0);
        // L'annulation d'Alice s'est perdue ; elle rappelle avec un nouveau
        // call_id après la fenêtre de cadence : l'ancienne sonnerie se ferme,
        // la nouvelle s'ouvre.
        let actions = m.on_offer(ALICE, CALL2, NEW_RING_MIN_INTERVAL_MS + 1);
        assert_eq!(
            actions[0],
            CallAction::EventEnded {
                peer: ALICE,
                call_id: CALL,
                reason: "canceled",
            }
        );
        assert_eq!(
            actions[1],
            CallAction::EventIncoming {
                peer: ALICE,
                call_id: CALL2,
            }
        );
        assert_eq!(m.snapshot().call_id, Some(CALL2));
    }

    #[test]
    fn audio_loss_and_room_takeover_end_active_calls_only() {
        let mut m = machine();
        assert!(m.on_audio_lost().is_empty());
        assert!(m.on_room_takeover().is_empty());
        m.on_offer(ALICE, CALL, 0);
        // Une sonnerie survit à l'entrée dans un salon de groupe.
        assert!(m.on_room_takeover().is_empty());
        assert_eq!(m.snapshot().phase, CallPhase::IncomingRinging);
        m.accept(CALL, 10).unwrap();
        let actions = m.on_room_takeover();
        assert!(actions.contains(&CallAction::SendHangup {
            to: ALICE,
            call_id: CALL
        }));
        assert_eq!(m.snapshot().phase, CallPhase::Idle);

        let mut m = machine();
        m.on_offer(ALICE, CALL, 0);
        m.accept(CALL, 10).unwrap();
        let actions = m.on_audio_lost();
        assert!(actions.contains(&CallAction::EventEnded {
            peer: ALICE,
            call_id: CALL,
            reason: "lost",
        }));
    }
}
