//! État pur des participants d'un salon vocal : adhésion bornée (full mesh),
//! vivacité et détection « parle » avec hystérésis. Aucune E/S ni horloge
//! propre : l'appelant ([`super::engine`]) fournit le temps en millisecondes.

use std::collections::BTreeMap;

use accord_proto::limits::VOICE_MAX_PARTICIPANTS;

/// Maintien de l'état « parle » après la dernière trame audio (ms). Deux fois
/// le hangover de la VAD émettrice : évite le clignotement de l'indicateur.
pub(crate) const SPEAKING_HOLD_MS: u64 = 400;

/// Silence radio maximal d'un participant du salon actif (ms) : au-delà, il
/// est réputé parti (les pings de qualité arrivent chaque seconde).
pub(crate) const ACTIVE_TIMEOUT_MS: u64 = 10_000;

/// Durée de vie d'une entrée de présence passive (salon non rejoint), sans
/// signal d'état reçu (ms) : trois diffusions d'état manquées.
pub(crate) const PASSIVE_TTL_MS: u64 = 90_000;

/// Intervalle minimal entre deux événements mute/deafen émis pour un même
/// participant (ms). Anti-abus : un pair qui inonde de bascules d'état ne peut
/// pas noyer le bus d'événements local — l'état interne reste à jour (le
/// snapshot est correct), seules les émissions rapprochées sont coalescées.
pub(crate) const MUTE_EVENT_MIN_INTERVAL_MS: u64 = 300;

/// Transition observable de l'état du salon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RosterEvent {
    /// Un participant est entré dans le salon.
    Joined([u8; 32]),
    /// Un participant a quitté le salon (départ signalé ou vivacité échue).
    Left([u8; 32]),
    /// L'état « parle » d'un participant a changé.
    Speaking([u8; 32], bool),
    /// The broadcast mute/deafen state of a participant changed:
    /// `(pubkey, muted, deafened)`.
    MuteState([u8; 32], bool, bool),
}

/// Salon plein : le full mesh est borné.
#[derive(Debug, thiserror::Error)]
#[error("salon vocal plein ({VOICE_MAX_PARTICIPANTS} participants)")]
pub(crate) struct RosterFull;

/// État d'un participant.
#[derive(Debug)]
struct PeerState {
    last_seen_ms: u64,
    last_frame_ms: Option<u64>,
    speaking: bool,
    /// Microphone muted, as broadcast by the participant (VoiceSignal).
    muted: bool,
    /// Output deafened, as broadcast by the participant (VoiceSignal).
    deafened: bool,
    /// Wall-clock (ms) of the last EMITTED mute/deafen transition (throttle).
    last_mute_event_ms: u64,
}

/// Snapshot of a participant as exposed by [`Roster::participants`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RosterPeer {
    /// Participant public key.
    pub(crate) pubkey: [u8; 32],
    /// Speaking indicator (frame activity with hysteresis).
    pub(crate) speaking: bool,
    /// Microphone muted (broadcast state).
    pub(crate) muted: bool,
    /// Output deafened (broadcast state).
    pub(crate) deafened: bool,
}

/// Participants d'un salon vocal, ordonnés par clé publique.
#[derive(Debug, Default)]
pub(crate) struct Roster {
    peers: BTreeMap<[u8; 32], PeerState>,
}

impl Roster {
    /// Nombre de participants.
    pub(crate) fn len(&self) -> usize {
        self.peers.len()
    }

    /// Vrai si le salon n'a aucun participant.
    pub(crate) fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }

    /// Vrai si `pubkey` est dans le salon.
    pub(crate) fn contains(&self, pubkey: &[u8; 32]) -> bool {
        self.peers.contains_key(pubkey)
    }

    /// Clés publiques des participants (ordre stable).
    pub(crate) fn pubkeys(&self) -> Vec<[u8; 32]> {
        self.peers.keys().copied().collect()
    }

    /// Participants avec leur état « parle » et micro/sortie (ordre stable).
    pub(crate) fn participants(&self) -> Vec<RosterPeer> {
        self.peers
            .iter()
            .map(|(k, p)| RosterPeer {
                pubkey: *k,
                speaking: p.speaking,
                muted: p.muted,
                deafened: p.deafened,
            })
            .collect()
    }

    /// Ajoute un participant (idempotent : rafraîchit sa vivacité s'il est
    /// déjà là). Rend `true` s'il vient d'entrer, erreur si le salon est plein.
    pub(crate) fn join(&mut self, pubkey: [u8; 32], now_ms: u64) -> Result<bool, RosterFull> {
        if let Some(peer) = self.peers.get_mut(&pubkey) {
            peer.last_seen_ms = now_ms;
            return Ok(false);
        }
        if self.peers.len() >= VOICE_MAX_PARTICIPANTS {
            return Err(RosterFull);
        }
        self.peers.insert(
            pubkey,
            PeerState {
                last_seen_ms: now_ms,
                last_frame_ms: None,
                speaking: false,
                muted: false,
                deafened: false,
                last_mute_event_ms: 0,
            },
        );
        Ok(true)
    }

    /// Records the broadcast mute/deafen state of a participant. Returns the
    /// transition event when the state changed AND at least
    /// [`MUTE_EVENT_MIN_INTERVAL_MS`] elapsed since the last emitted one
    /// (anti-abuse throttle). The internal state is always updated so the
    /// [`Roster::participants`] snapshot stays correct even when coalesced.
    pub(crate) fn set_mute_state(
        &mut self,
        pubkey: &[u8; 32],
        muted: bool,
        deafened: bool,
        now_ms: u64,
    ) -> Option<RosterEvent> {
        let peer = self.peers.get_mut(pubkey)?;
        if peer.muted == muted && peer.deafened == deafened {
            return None;
        }
        peer.muted = muted;
        peer.deafened = deafened;
        if now_ms.saturating_sub(peer.last_mute_event_ms) < MUTE_EVENT_MIN_INTERVAL_MS {
            return None; // état enregistré, émission coalescée (anti-flood)
        }
        peer.last_mute_event_ms = now_ms;
        Some(RosterEvent::MuteState(*pubkey, muted, deafened))
    }

    /// Retire un participant ; rend `true` s'il était présent.
    pub(crate) fn leave(&mut self, pubkey: &[u8; 32]) -> bool {
        self.peers.remove(pubkey).is_some()
    }

    /// Rafraîchit la vivacité d'un participant (ping, signal d'état).
    pub(crate) fn touch(&mut self, pubkey: &[u8; 32], now_ms: u64) {
        if let Some(peer) = self.peers.get_mut(pubkey) {
            peer.last_seen_ms = now_ms;
        }
    }

    /// Rafraîchit la vivacité de tous les participants (grâce à l'entrée dans
    /// le salon : les entrées passives repartent d'un délai complet).
    pub(crate) fn refresh_all(&mut self, now_ms: u64) {
        for peer in self.peers.values_mut() {
            peer.last_seen_ms = now_ms;
        }
    }

    /// Enregistre une trame audio d'un participant : il parle. Rend la
    /// transition « parle » si elle vient de s'ouvrir.
    pub(crate) fn on_frame(&mut self, pubkey: &[u8; 32], now_ms: u64) -> Option<RosterEvent> {
        let peer = self.peers.get_mut(pubkey)?;
        peer.last_seen_ms = now_ms;
        peer.last_frame_ms = Some(now_ms);
        if peer.speaking {
            return None;
        }
        peer.speaking = true;
        Some(RosterEvent::Speaking(*pubkey, true))
    }

    /// Force l'état silencieux d'un participant (micro local coupé). Rend la
    /// transition si l'indicateur était ouvert.
    pub(crate) fn force_silent(&mut self, pubkey: &[u8; 32]) -> Option<RosterEvent> {
        let peer = self.peers.get_mut(pubkey)?;
        peer.last_frame_ms = None;
        if !peer.speaking {
            return None;
        }
        peer.speaking = false;
        Some(RosterEvent::Speaking(*pubkey, false))
    }

    /// Passe d'horloge : referme les indicateurs « parle » après
    /// [`SPEAKING_HOLD_MS`] sans trame, et retire les participants muets
    /// depuis plus de `timeout_ms` (`exempt` — soi-même — n'expire jamais).
    pub(crate) fn tick(
        &mut self,
        now_ms: u64,
        timeout_ms: u64,
        exempt: Option<&[u8; 32]>,
    ) -> Vec<RosterEvent> {
        let mut events = Vec::new();
        let mut gone = Vec::new();
        for (pubkey, peer) in &mut self.peers {
            if peer.speaking
                && peer
                    .last_frame_ms
                    .is_none_or(|t| now_ms.saturating_sub(t) >= SPEAKING_HOLD_MS)
            {
                peer.speaking = false;
                events.push(RosterEvent::Speaking(*pubkey, false));
            }
            if Some(pubkey) != exempt && now_ms.saturating_sub(peer.last_seen_ms) >= timeout_ms {
                gone.push(*pubkey);
            }
        }
        for pubkey in gone {
            self.peers.remove(&pubkey);
            events.push(RosterEvent::Left(pubkey));
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> [u8; 32] {
        [n; 32]
    }

    #[test]
    fn join_is_idempotent_and_bounded_to_ten() {
        let mut r = Roster::default();
        for i in 0..VOICE_MAX_PARTICIPANTS {
            assert!(r.join(pk(i as u8), 0).unwrap());
        }
        assert_eq!(r.len(), VOICE_MAX_PARTICIPANTS);
        // Re-jointure : pas une nouvelle entrée.
        assert!(!r.join(pk(0), 5).unwrap());
        // Le onzième déborde : erreur explicite.
        assert!(r.join(pk(200), 5).is_err());
    }

    #[test]
    fn leave_removes_and_reports_presence() {
        let mut r = Roster::default();
        r.join(pk(1), 0).unwrap();
        assert!(r.leave(&pk(1)));
        assert!(!r.leave(&pk(1)));
        assert!(r.is_empty());
    }

    #[test]
    fn speaking_opens_on_frame_and_closes_after_hold() {
        let mut r = Roster::default();
        r.join(pk(1), 0).unwrap();
        // Première trame : transition « parle ».
        assert_eq!(
            r.on_frame(&pk(1), 100),
            Some(RosterEvent::Speaking(pk(1), true))
        );
        // Trames suivantes : pas de nouvelle transition.
        assert_eq!(r.on_frame(&pk(1), 120), None);
        // Avant l'hystérésis : toujours « parle ».
        assert!(r
            .tick(120 + SPEAKING_HOLD_MS - 1, ACTIVE_TIMEOUT_MS, None)
            .is_empty());
        // Après l'hystérésis : referme.
        let events = r.tick(120 + SPEAKING_HOLD_MS, ACTIVE_TIMEOUT_MS, None);
        assert_eq!(events, vec![RosterEvent::Speaking(pk(1), false)]);
    }

    #[test]
    fn silent_peer_times_out_but_exempt_survives() {
        let mut r = Roster::default();
        let me = pk(9);
        r.join(me, 0).unwrap();
        r.join(pk(1), 0).unwrap();
        let events = r.tick(ACTIVE_TIMEOUT_MS, ACTIVE_TIMEOUT_MS, Some(&me));
        assert_eq!(events, vec![RosterEvent::Left(pk(1))]);
        assert!(r.contains(&me));
    }

    #[test]
    fn touch_keeps_peer_alive() {
        let mut r = Roster::default();
        r.join(pk(1), 0).unwrap();
        r.touch(&pk(1), 9_000);
        assert!(r.tick(10_000, ACTIVE_TIMEOUT_MS, None).is_empty());
        let events = r.tick(9_000 + ACTIVE_TIMEOUT_MS, ACTIVE_TIMEOUT_MS, None);
        assert_eq!(events, vec![RosterEvent::Left(pk(1))]);
    }

    #[test]
    fn mute_state_transitions_are_reported_once() {
        let mut r = Roster::default();
        r.join(pk(1), 0).unwrap();
        // Initial state: unmuted, undeafened — setting it again is a no-op.
        assert_eq!(r.set_mute_state(&pk(1), false, false, 0), None);
        assert_eq!(
            r.set_mute_state(&pk(1), true, false, 1_000),
            Some(RosterEvent::MuteState(pk(1), true, false))
        );
        // Idempotent while unchanged.
        assert_eq!(r.set_mute_state(&pk(1), true, false, 2_000), None);
        assert_eq!(
            r.set_mute_state(&pk(1), true, true, 2_000),
            Some(RosterEvent::MuteState(pk(1), true, true))
        );
        // Unknown participant: ignored.
        assert_eq!(r.set_mute_state(&pk(9), true, true, 2_000), None);
        let peers = r.participants();
        assert_eq!(peers.len(), 1);
        assert!(peers[0].muted && peers[0].deafened);
    }

    #[test]
    fn rapid_mute_flips_are_throttled_but_state_stays_current() {
        let mut r = Roster::default();
        r.join(pk(1), 0).unwrap();
        // First change emits.
        assert_eq!(
            r.set_mute_state(&pk(1), true, false, 1_000),
            Some(RosterEvent::MuteState(pk(1), true, false))
        );
        // A flip within the interval is coalesced (no event) but recorded.
        assert_eq!(r.set_mute_state(&pk(1), false, false, 1_100), None);
        assert!(!r.participants()[0].muted);
        // Another flip still within the interval: still coalesced.
        assert_eq!(r.set_mute_state(&pk(1), true, true, 1_200), None);
        assert!(r.participants()[0].muted && r.participants()[0].deafened);
        // After the interval, the next change emits the settled state.
        assert_eq!(
            r.set_mute_state(&pk(1), false, false, 1_600),
            Some(RosterEvent::MuteState(pk(1), false, false))
        );
    }

    #[test]
    fn force_silent_closes_indicator() {
        let mut r = Roster::default();
        r.join(pk(1), 0).unwrap();
        r.on_frame(&pk(1), 10);
        assert_eq!(
            r.force_silent(&pk(1)),
            Some(RosterEvent::Speaking(pk(1), false))
        );
        assert_eq!(r.force_silent(&pk(1)), None);
    }
}
