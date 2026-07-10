//! Conversions audio pures pour l'E/S matérielle (SPEC §8, D-020).
//!
//! Le périphérique audio impose sa fréquence, son nombre de canaux et son
//! format d'échantillon ; le protocole voix travaille en 48 kHz mono `i16`.
//! Ce module fait le pont : repli mono, conversion de format et
//! rééchantillonnage linéaire en flux, plus le découpage en trames de 20 ms.
//! Tout est du Rust pur, testé sans matériel ; seul [`crate::io`] (feature
//! `hardware`) le branche sur `cpal`.

use crate::params::FRAME_SAMPLES;

/// Replie un signal entrelacé multi-canaux en mono par moyenne des canaux.
/// Une fin de tampon incomplète (frame partielle) est ignorée.
pub fn downmix_i16(interleaved: &[i16], channels: usize) -> Vec<i16> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| {
            let sum: i32 = frame.iter().map(|&s| s as i32).sum();
            (sum / channels as i32) as i16
        })
        .collect()
}

/// Convertit des échantillons `f32` normalisés ([−1, 1]) en `i16`.
pub fn f32_to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16)
        .collect()
}

/// Convertit des échantillons `u16` (biais 32768) en `i16`.
pub fn u16_to_i16(samples: &[u16]) -> Vec<i16> {
    samples.iter().map(|&s| (s as i32 - 32768) as i16).collect()
}

/// Rééchantillonneur linéaire en flux : conserve la position fractionnaire et
/// le dernier échantillon entre deux appels, pour un signal continu à la
/// frontière des tampons.
#[derive(Debug)]
pub struct LinearResampler {
    step: f64,
    pos: f64,
    prev: i16,
}

impl LinearResampler {
    /// Crée un rééchantillonneur de `src_hz` vers `dst_hz`.
    pub fn new(src_hz: u32, dst_hz: u32) -> Self {
        Self {
            step: src_hz as f64 / dst_hz as f64,
            pos: 0.0,
            prev: 0,
        }
    }

    /// Rééchantillonne `input` et pousse le résultat dans `out`.
    pub fn process(&mut self, input: &[i16], out: &mut Vec<i16>) {
        if input.is_empty() {
            return;
        }
        if (self.step - 1.0).abs() < f64::EPSILON {
            out.extend_from_slice(input);
            return;
        }
        // Signal virtuel : position 0 = dernier échantillon du tampon
        // précédent, position k = input[k − 1].
        let n = input.len() as f64;
        let at = |k: usize| -> f64 {
            if k == 0 {
                self.prev as f64
            } else {
                input[k - 1] as f64
            }
        };
        while self.pos < n {
            let base = self.pos.floor();
            let frac = self.pos - base;
            let k = base as usize;
            let sample = at(k) + (at(k + 1) - at(k)) * frac;
            out.push(sample.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16);
            self.pos += self.step;
        }
        self.pos -= n;
        self.prev = input[input.len() - 1];
    }
}

/// Accumule des échantillons mono 48 kHz et les découpe en trames de 20 ms
/// exactes ([`FRAME_SAMPLES`] échantillons).
#[derive(Debug, Default)]
pub struct FrameChunker {
    buf: Vec<i16>,
}

impl FrameChunker {
    /// Ajoute des échantillons au tampon.
    pub fn push(&mut self, samples: &[i16]) {
        self.buf.extend_from_slice(samples);
    }

    /// Extrait la prochaine trame complète, ou `None` s'il en manque.
    pub fn next_frame(&mut self) -> Option<Vec<i16>> {
        if self.buf.len() < FRAME_SAMPLES {
            return None;
        }
        Some(self.buf.drain(..FRAME_SAMPLES).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_averages_channels() {
        assert_eq!(downmix_i16(&[100, 200, -50, 50], 2), vec![150, 0]);
        // Mono : identité. Frame partielle finale ignorée.
        assert_eq!(downmix_i16(&[1, 2, 3], 1), vec![1, 2, 3]);
        assert_eq!(downmix_i16(&[1, 2, 3], 2), vec![1]);
    }

    #[test]
    fn format_conversions_are_sane() {
        assert_eq!(
            f32_to_i16(&[0.0, 1.0, -1.0, 2.0]),
            vec![0, 32767, -32767, 32767]
        );
        assert_eq!(u16_to_i16(&[32768, 0, 65535]), vec![0, -32768, 32767]);
    }

    #[test]
    fn resampler_is_identity_at_equal_rates() {
        let mut rs = LinearResampler::new(48_000, 48_000);
        let mut out = Vec::new();
        rs.process(&[1, 2, 3, 4], &mut out);
        assert_eq!(out, vec![1, 2, 3, 4]);
    }

    #[test]
    fn resampler_ratio_holds_across_chunks() {
        // 44,1 kHz → 48 kHz par blocs : le total doit suivre le ratio.
        let mut rs = LinearResampler::new(44_100, 48_000);
        let mut out = Vec::new();
        let chunk = vec![0i16; 441];
        for _ in 0..100 {
            rs.process(&chunk, &mut out);
        }
        let expected = 441 * 100 * 48_000 / 44_100;
        assert!(
            (out.len() as i64 - expected as i64).abs() <= 1,
            "obtenu {}",
            out.len()
        );
    }

    #[test]
    fn resampler_preserves_constant_signal() {
        let mut rs = LinearResampler::new(48_000, 16_000);
        let mut out = Vec::new();
        rs.process(&[500i16; 96], &mut out);
        assert!(!out.is_empty());
        // Après amorçage (interpolation avec prev = 0), le plateau est exact.
        assert!(out[2..].iter().all(|&s| s == 500), "{out:?}");
    }

    #[test]
    fn resampler_upsamples_by_interpolation() {
        let mut rs = LinearResampler::new(24_000, 48_000);
        let mut out = Vec::new();
        rs.process(&[0, 100], &mut out);
        rs.process(&[200, 300], &mut out);
        // Le signal doit croître de façon monotone (rampe interpolée).
        assert!(out.windows(2).all(|w| w[0] <= w[1]), "{out:?}");
        assert_eq!(out.len(), 8);
    }

    #[test]
    fn chunker_emits_exact_frames() {
        let mut ch = FrameChunker::default();
        ch.push(&vec![7i16; FRAME_SAMPLES - 1]);
        assert!(ch.next_frame().is_none());
        ch.push(&vec![7i16; FRAME_SAMPLES + 1]);
        let f1 = ch.next_frame().expect("première trame");
        let f2 = ch.next_frame().expect("seconde trame");
        assert_eq!(f1.len(), FRAME_SAMPLES);
        assert_eq!(f2.len(), FRAME_SAMPLES);
        assert!(ch.next_frame().is_none());
    }
}
