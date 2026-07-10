//! État d'un salon vocal full-mesh (SPEC §8).
//!
//! Sans E/S ni horloge propre : l'hôte (démon/UI) fournit les trames PCM
//! capturées et l'horloge média, transmet les [`VoiceMsg`] produits à chaque
//! participant via sa session transport chiffrée, et pousse les trames
//! décodées vers la sortie audio. Le chiffrement est assuré par le transport
//! (canal VOICE) ; ce module ne manipule que du clair local.

use std::collections::BTreeMap;

use accord_proto::plaintext::VoiceMsg;

use crate::bitrate;
use crate::codec::{AudioCodec, CodecError};
use crate::jitter::{JitterBuffer, Playout};
use crate::loss::LossEstimator;
use crate::params::{BITRATE_MIN, FRAME_MS, MAX_PARTICIPANTS};
use crate::vad::Vad;

/// Type de média audio Opus (SPEC §8).
const MEDIA_AUDIO_OPUS: u8 = 0x01;

/// Fabrique de codecs (un décodeur par participant, un encodeur local).
pub type CodecFactory = Box<dyn Fn() -> Box<dyn AudioCodec> + Send>;

/// État d'un participant distant.
struct Peer {
    jitter: JitterBuffer,
    loss: LossEstimator,
    decoder: Box<dyn AudioCodec>,
}

/// Erreur d'opération de salon.
#[derive(Debug, thiserror::Error)]
pub enum RoomError {
    /// Salon plein (full mesh borné).
    #[error("salon vocal plein")]
    Full,
    /// Participant inconnu.
    #[error("participant inconnu")]
    UnknownPeer,
    /// Erreur de codec.
    #[error(transparent)]
    Codec(#[from] CodecError),
}

/// Salon vocal actif.
pub struct VoiceRoom {
    room_id: [u8; 16],
    make_codec: CodecFactory,
    encoder: Box<dyn AudioCodec>,
    bitrate: u32,
    vad: Vad,
    seq: u16,
    ts_ms: u32,
    peers: BTreeMap<[u8; 32], Peer>,
}

impl VoiceRoom {
    /// Crée un salon avec une fabrique de codecs (encodeur local créé aussitôt).
    pub fn new(room_id: [u8; 16], make_codec: CodecFactory) -> Self {
        let encoder = make_codec();
        Self {
            room_id,
            make_codec,
            encoder,
            bitrate: BITRATE_MIN,
            vad: Vad::default(),
            seq: 0,
            ts_ms: 0,
            peers: BTreeMap::new(),
        }
    }

    /// Identifiant du salon.
    pub fn room_id(&self) -> [u8; 16] {
        self.room_id
    }

    /// Débit d'encodage courant (bit/s).
    pub fn bitrate(&self) -> u32 {
        self.bitrate
    }

    /// Participants actuels.
    pub fn participant_count(&self) -> usize {
        self.peers.len()
    }

    /// Ajoute un participant (borne full mesh incluant soi-même).
    pub fn add_participant(&mut self, pubkey: [u8; 32]) -> Result<(), RoomError> {
        if self.peers.contains_key(&pubkey) {
            return Ok(());
        }
        if self.peers.len() + 1 >= MAX_PARTICIPANTS {
            return Err(RoomError::Full);
        }
        self.peers.insert(
            pubkey,
            Peer {
                jitter: JitterBuffer::new(),
                loss: LossEstimator::new(),
                decoder: (self.make_codec)(),
            },
        );
        Ok(())
    }

    /// Retire un participant.
    pub fn remove_participant(&mut self, pubkey: &[u8; 32]) {
        self.peers.remove(pubkey);
    }

    /// Capture une trame PCM locale : renvoie la trame à diffuser à tous les
    /// participants, ou `None` si la VAD la juge silencieuse. L'horloge média
    /// avance à chaque appel (cadence de 20 ms côté hôte).
    pub fn capture(&mut self, pcm: &[i16]) -> Result<Option<VoiceMsg>, RoomError> {
        let active = self.vad.is_active(pcm);
        self.ts_ms = self.ts_ms.wrapping_add(FRAME_MS);
        if !active {
            return Ok(None);
        }
        let payload = self.encoder.encode(pcm)?;
        let frame = VoiceMsg::AudioFrame {
            room: self.room_id,
            media_type: MEDIA_AUDIO_OPUS,
            seq: self.seq,
            ts_ms: self.ts_ms,
            payload,
        };
        self.seq = self.seq.wrapping_add(1);
        Ok(Some(frame))
    }

    /// Ingest une trame reçue d'un participant (dans sa session chiffrée).
    pub fn on_frame(&mut self, from: &[u8; 32], frame: VoiceMsg, now_ms: u32) {
        let VoiceMsg::AudioFrame {
            room, seq, payload, ..
        } = frame
        else {
            return;
        };
        if room != self.room_id {
            return;
        }
        if let Some(peer) = self.peers.get_mut(from) {
            peer.loss.observe(seq, now_ms);
            peer.jitter.push(seq, payload, now_ms);
        }
    }

    /// Produit la prochaine trame PCM à jouer pour un participant (cadence de
    /// 20 ms). `None` tant que le tampon s'amorce.
    pub fn play(&mut self, from: &[u8; 32]) -> Result<Option<Vec<i16>>, RoomError> {
        let peer = self.peers.get_mut(from).ok_or(RoomError::UnknownPeer)?;
        match peer.jitter.pop() {
            Playout::Frame(pkt) => Ok(Some(peer.decoder.decode(Some(&pkt))?)),
            Playout::Conceal => Ok(Some(peer.decoder.decode(None)?)),
            Playout::Starved => Ok(None),
        }
    }

    /// Construit le retour de qualité à envoyer à un participant.
    pub fn quality_ping(&self, to: &[u8; 32], rtt_ms: u16) -> Option<VoiceMsg> {
        self.peers.get(to).map(|peer| VoiceMsg::VoicePing {
            loss_pct: peer.loss.loss_pct(),
            rtt_ms,
        })
    }

    /// Applique un retour de qualité reçu : adapte le débit d'encodage.
    pub fn on_ping(&mut self, ping: &VoiceMsg) {
        if let VoiceMsg::VoicePing { loss_pct, .. } = ping {
            self.bitrate = bitrate::adapt(self.bitrate, *loss_pct);
            self.encoder.set_bitrate(self.bitrate);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::PassthroughCodec;
    use crate::params::FRAME_SAMPLES;

    fn room() -> VoiceRoom {
        VoiceRoom::new([7u8; 16], Box::new(|| Box::new(PassthroughCodec)))
    }

    fn tone(a: i16) -> Vec<i16> {
        (0..FRAME_SAMPLES)
            .map(|i| if i % 2 == 0 { a } else { -a })
            .collect()
    }

    #[test]
    fn capture_gates_on_vad_and_sequences() {
        let mut r = room();
        // Silence : rien à diffuser.
        assert!(r.capture(&vec![0i16; FRAME_SAMPLES]).unwrap().is_none());
        // Parole : trame séquencée.
        let f0 = r.capture(&tone(20_000)).unwrap().unwrap();
        let f1 = r.capture(&tone(20_000)).unwrap().unwrap();
        match (f0, f1) {
            (VoiceMsg::AudioFrame { seq: s0, .. }, VoiceMsg::AudioFrame { seq: s1, .. }) => {
                assert_eq!(s0, 0);
                assert_eq!(s1, 1);
            }
            _ => panic!("trames audio attendues"),
        }
    }

    #[test]
    fn end_to_end_capture_transport_playback() {
        let mut sender = room();
        let mut receiver = room();
        let spk = [1u8; 32];
        receiver.add_participant(spk).unwrap();

        // L'émetteur capture 3 trames de parole ; le récepteur les rejoue.
        let mut frames = Vec::new();
        for _ in 0..3 {
            frames.push(sender.capture(&tone(15_000)).unwrap().unwrap());
        }
        for (i, f) in frames.into_iter().enumerate() {
            receiver.on_frame(&spk, f, i as u32 * 20);
        }
        // Amorçage puis lecture : au moins une trame décodée non silencieuse.
        let mut decoded = None;
        for _ in 0..5 {
            if let Some(pcm) = receiver.play(&spk).unwrap() {
                if pcm.iter().any(|&s| s != 0) {
                    decoded = Some(pcm);
                    break;
                }
            }
        }
        assert!(decoded.is_some(), "aucune trame rejouée");
    }

    #[test]
    fn ping_drives_bitrate_adaptation() {
        let mut r = room();
        assert_eq!(r.bitrate(), BITRATE_MIN);
        // Réseau sain : le débit remonte.
        r.on_ping(&VoiceMsg::VoicePing {
            loss_pct: 0,
            rtt_ms: 30,
        });
        assert!(r.bitrate() > BITRATE_MIN);
        // Perte forte : chute immédiate au plancher.
        r.on_ping(&VoiceMsg::VoicePing {
            loss_pct: 20,
            rtt_ms: 30,
        });
        assert_eq!(r.bitrate(), BITRATE_MIN);
    }

    #[test]
    fn quality_ping_reports_measured_loss() {
        let mut r = room();
        let spk = [2u8; 32];
        r.add_participant(spk).unwrap();
        // 1 trame sur 2 reçue.
        for i in 0..40u16 {
            r.on_frame(
                &spk,
                VoiceMsg::AudioFrame {
                    room: [7u8; 16],
                    media_type: MEDIA_AUDIO_OPUS,
                    seq: i * 2,
                    ts_ms: 0,
                    payload: vec![0u8; FRAME_SAMPLES * 2],
                },
                i as u32 * 40,
            );
        }
        let ping = r.quality_ping(&spk, 50).unwrap();
        match ping {
            VoiceMsg::VoicePing { loss_pct, .. } => assert!(loss_pct >= 40),
            _ => panic!("ping attendu"),
        }
    }

    #[test]
    fn mesh_is_bounded() {
        let mut r = room();
        for i in 0..(MAX_PARTICIPANTS - 1) {
            let mut pk = [0u8; 32];
            pk[0] = i as u8;
            r.add_participant(pk).unwrap();
        }
        // La place pour soi-même est réservée : le suivant déborde.
        assert!(matches!(
            r.add_participant([200u8; 32]),
            Err(RoomError::Full)
        ));
    }

    #[test]
    fn frames_from_other_rooms_are_ignored() {
        let mut r = room();
        let spk = [3u8; 32];
        r.add_participant(spk).unwrap();
        r.on_frame(
            &spk,
            VoiceMsg::AudioFrame {
                room: [99u8; 16],
                media_type: MEDIA_AUDIO_OPUS,
                seq: 0,
                ts_ms: 0,
                payload: vec![0u8; FRAME_SAMPLES * 2],
            },
            0,
        );
        assert!(r.play(&spk).unwrap().is_none());
    }
}
