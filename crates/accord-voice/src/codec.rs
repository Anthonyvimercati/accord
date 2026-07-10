//! Abstraction de codec audio (SPEC §8, D-020).
//!
//! La logique voix ne dépend pas d'un codec concret : elle passe par le trait
//! [`AudioCodec`]. Les tests utilisent [`PassthroughCodec`] (PCM `i16` ↔
//! octets, déterministe, sans dépendance native) ; la vraie liaison Opus vit
//! derrière la feature `hardware`.

use crate::params::FRAME_SAMPLES;

/// Encodeur/décodeur d'une trame audio de 20 ms.
pub trait AudioCodec: Send {
    /// Encode une trame PCM mono (`FRAME_SAMPLES` échantillons) en paquet.
    fn encode(&mut self, pcm: &[i16]) -> Result<Vec<u8>, CodecError>;

    /// Décode un paquet en trame PCM. `None` = trame perdue : le décodeur
    /// produit une dissimulation de perte (PLC).
    fn decode(&mut self, packet: Option<&[u8]>) -> Result<Vec<i16>, CodecError>;

    /// Ajuste le débit cible (bit/s) — sans effet pour un codec sans débit.
    fn set_bitrate(&mut self, _bitrate: u32) {}
}

/// Erreur de codec.
#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    /// Trame de taille inattendue.
    #[error("trame audio de taille invalide")]
    BadFrame,
    /// Erreur interne du codec natif.
    #[error("codec : {0}")]
    Backend(String),
}

/// Codec d'identité pour les tests : PCM `i16` little-endian ↔ octets. Le PLC
/// rend une trame de silence.
#[derive(Debug, Default)]
pub struct PassthroughCodec;

impl AudioCodec for PassthroughCodec {
    fn encode(&mut self, pcm: &[i16]) -> Result<Vec<u8>, CodecError> {
        if pcm.len() != FRAME_SAMPLES {
            return Err(CodecError::BadFrame);
        }
        let mut out = Vec::with_capacity(pcm.len() * 2);
        for &s in pcm {
            out.extend_from_slice(&s.to_le_bytes());
        }
        Ok(out)
    }

    fn decode(&mut self, packet: Option<&[u8]>) -> Result<Vec<i16>, CodecError> {
        match packet {
            None => Ok(vec![0i16; FRAME_SAMPLES]),
            Some(bytes) => {
                if bytes.len() != FRAME_SAMPLES * 2 {
                    return Err(CodecError::BadFrame);
                }
                Ok(bytes
                    .chunks_exact(2)
                    .map(|c| i16::from_le_bytes([c[0], c[1]]))
                    .collect())
            }
        }
    }
}

/// Codec PCM 8 bits pur (sans dépendance native) : chaque échantillon `i16`
/// est réduit à son octet de poids fort. La trame de 20 ms tient en 960
/// octets, sous la borne filaire des trames voix (contrairement au
/// [`PassthroughCodec`], réservé aux tests en mémoire). Qualité téléphonique,
/// suffisante pour le mode simulé sans matériel. Le PLC rend du silence.
#[derive(Debug, Default)]
pub struct Pcm8Codec;

impl AudioCodec for Pcm8Codec {
    fn encode(&mut self, pcm: &[i16]) -> Result<Vec<u8>, CodecError> {
        if pcm.len() != FRAME_SAMPLES {
            return Err(CodecError::BadFrame);
        }
        Ok(pcm.iter().map(|&s| (s >> 8) as u8).collect())
    }

    fn decode(&mut self, packet: Option<&[u8]>) -> Result<Vec<i16>, CodecError> {
        match packet {
            None => Ok(vec![0i16; FRAME_SAMPLES]),
            Some(bytes) => {
                if bytes.len() != FRAME_SAMPLES {
                    return Err(CodecError::BadFrame);
                }
                Ok(bytes.iter().map(|&b| i16::from(b as i8) << 8).collect())
            }
        }
    }
}

#[cfg(feature = "hardware")]
mod opus_codec {
    use super::*;
    use crate::params::{CHANNELS, SAMPLE_RATE};

    /// Codec Opus réel (48 kHz mono, VoIP).
    pub struct OpusCodec {
        encoder: opus::Encoder,
        decoder: opus::Decoder,
    }

    impl OpusCodec {
        /// Crée un codec Opus au débit initial donné.
        pub fn new(bitrate: u32) -> Result<Self, CodecError> {
            let channels = if CHANNELS == 1 {
                opus::Channels::Mono
            } else {
                opus::Channels::Stereo
            };
            let mut encoder = opus::Encoder::new(SAMPLE_RATE, channels, opus::Application::Voip)
                .map_err(|e| CodecError::Backend(e.to_string()))?;
            encoder
                .set_bitrate(opus::Bitrate::Bits(bitrate as i32))
                .map_err(|e| CodecError::Backend(e.to_string()))?;
            let decoder = opus::Decoder::new(SAMPLE_RATE, channels)
                .map_err(|e| CodecError::Backend(e.to_string()))?;
            Ok(Self { encoder, decoder })
        }
    }

    impl AudioCodec for OpusCodec {
        fn encode(&mut self, pcm: &[i16]) -> Result<Vec<u8>, CodecError> {
            if pcm.len() != FRAME_SAMPLES {
                return Err(CodecError::BadFrame);
            }
            self.encoder
                .encode_vec(pcm, FRAME_SAMPLES)
                .map_err(|e| CodecError::Backend(e.to_string()))
        }

        fn decode(&mut self, packet: Option<&[u8]>) -> Result<Vec<i16>, CodecError> {
            let mut out = vec![0i16; FRAME_SAMPLES];
            let decoded = match packet {
                Some(bytes) => self.decoder.decode(bytes, &mut out, false),
                None => self.decoder.decode(&[], &mut out, true), // PLC
            }
            .map_err(|e| CodecError::Backend(e.to_string()))?;
            out.truncate(decoded);
            Ok(out)
        }

        fn set_bitrate(&mut self, bitrate: u32) {
            let _ = self
                .encoder
                .set_bitrate(opus::Bitrate::Bits(bitrate as i32));
        }
    }
}

#[cfg(feature = "hardware")]
pub use opus_codec::OpusCodec;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_roundtrips_pcm() {
        let mut codec = PassthroughCodec;
        let pcm: Vec<i16> = (0..FRAME_SAMPLES as i32)
            .map(|i| (i - 480) as i16)
            .collect();
        let packet = codec.encode(&pcm).unwrap();
        assert_eq!(codec.decode(Some(&packet)).unwrap(), pcm);
    }

    #[test]
    fn passthrough_plc_is_silence() {
        let mut codec = PassthroughCodec;
        assert_eq!(codec.decode(None).unwrap(), vec![0i16; FRAME_SAMPLES]);
    }

    #[test]
    fn wrong_sizes_are_rejected() {
        let mut codec = PassthroughCodec;
        assert!(codec.encode(&[0i16; 10]).is_err());
        assert!(codec.decode(Some(&[0u8; 3])).is_err());
    }

    #[test]
    fn pcm8_frame_fits_wire_limit_and_roundtrips_coarsely() {
        let mut codec = Pcm8Codec;
        let pcm: Vec<i16> = (0..FRAME_SAMPLES as i32)
            .map(|i| ((i * 64) % 30_000 - 15_000) as i16)
            .collect();
        let packet = codec.encode(&pcm).unwrap();
        // 960 octets : sous la borne filaire de 1024 octets des trames voix.
        assert_eq!(packet.len(), FRAME_SAMPLES);
        let decoded = codec.decode(Some(&packet)).unwrap();
        // Quantification 8 bits : erreur bornée à un pas (256).
        for (a, b) in pcm.iter().zip(decoded.iter()) {
            assert!((i32::from(*a) - i32::from(*b)).abs() < 256);
        }
    }

    #[test]
    fn pcm8_plc_is_silence_and_sizes_checked() {
        let mut codec = Pcm8Codec;
        assert_eq!(codec.decode(None).unwrap(), vec![0i16; FRAME_SAMPLES]);
        assert!(codec.encode(&[0i16; 10]).is_err());
        assert!(codec.decode(Some(&[0u8; 3])).is_err());
    }
}
