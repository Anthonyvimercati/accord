//! Détection d'activité vocale (VAD) par énergie avec hystérésis (SPEC §8).
//!
//! Porte ouverte quand l'énergie d'une trame dépasse −50 dBFS ; refermée
//! seulement après 200 ms sous le seuil (hangover) pour ne pas hacher la fin
//! des mots. Le push-to-talk éventuel est géré côté UI (court-circuite la VAD).

use crate::params::{FRAME_MS, VAD_HANGOVER_MS, VAD_THRESHOLD_DBFS};

/// Détecteur d'activité vocale à hystérésis.
#[derive(Debug)]
pub struct Vad {
    threshold_dbfs: f32,
    hangover_frames: u32,
    remaining: u32,
}

impl Default for Vad {
    fn default() -> Self {
        Self::new(VAD_THRESHOLD_DBFS)
    }
}

impl Vad {
    /// Crée une VAD avec un seuil personnalisé (dBFS).
    pub fn new(threshold_dbfs: f32) -> Self {
        Self {
            threshold_dbfs,
            hangover_frames: VAD_HANGOVER_MS.div_ceil(FRAME_MS),
            remaining: 0,
        }
    }

    /// Niveau d'une trame PCM en dBFS (pleine échelle `i16`).
    pub fn frame_dbfs(pcm: &[i16]) -> f32 {
        if pcm.is_empty() {
            return f32::NEG_INFINITY;
        }
        let sum_sq: f64 = pcm.iter().map(|&s| (s as f64).powi(2)).sum();
        let rms = (sum_sq / pcm.len() as f64).sqrt();
        if rms <= 0.0 {
            return f32::NEG_INFINITY;
        }
        20.0 * (rms / i16::MAX as f64).log10() as f32
    }

    /// Niveau RMS d'une trame PCM, normalisé dans `0..=1` (pleine échelle
    /// `i16`) — alimente `event.voice_level` pendant le test micro (D-029).
    pub fn frame_rms(pcm: &[i16]) -> f32 {
        if pcm.is_empty() {
            return 0.0;
        }
        let sum_sq: f64 = pcm.iter().map(|&s| (s as f64).powi(2)).sum();
        let rms = (sum_sq / pcm.len() as f64).sqrt() / f64::from(i16::MAX);
        rms.min(1.0) as f32
    }

    /// Décide si une trame doit être transmise (parole active ou hangover).
    pub fn is_active(&mut self, pcm: &[i16]) -> bool {
        if Self::frame_dbfs(pcm) >= self.threshold_dbfs {
            self.remaining = self.hangover_frames;
            true
        } else if self.remaining > 0 {
            self.remaining -= 1;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::FRAME_SAMPLES;

    fn tone(amplitude: i16) -> Vec<i16> {
        (0..FRAME_SAMPLES)
            .map(|i| if i % 2 == 0 { amplitude } else { -amplitude })
            .collect()
    }

    #[test]
    fn silence_is_inactive() {
        let mut vad = Vad::default();
        assert!(!vad.is_active(&vec![0i16; FRAME_SAMPLES]));
    }

    #[test]
    fn loud_frame_is_active() {
        let mut vad = Vad::default();
        assert!(vad.is_active(&tone(20_000)));
    }

    #[test]
    fn hangover_keeps_gate_open_briefly() {
        let mut vad = Vad::default();
        assert!(vad.is_active(&tone(20_000)));
        // 200 ms / 20 ms = 10 trames de maintien après le silence.
        let silence = vec![0i16; FRAME_SAMPLES];
        let mut open = 0;
        for _ in 0..20 {
            if vad.is_active(&silence) {
                open += 1;
            }
        }
        assert_eq!(open, 10);
    }

    #[test]
    fn dbfs_scale_is_sane() {
        assert!(Vad::frame_dbfs(&[0; 480]).is_infinite());
        let full = Vad::frame_dbfs(&[i16::MAX; 480]);
        assert!(full > -1.0, "pleine échelle ≈ 0 dBFS, obtenu {full}");
    }

    #[test]
    fn rms_is_normalized_between_zero_and_one() {
        assert_eq!(Vad::frame_rms(&[]), 0.0);
        assert_eq!(Vad::frame_rms(&[0; 480]), 0.0);
        let full = Vad::frame_rms(&[i16::MAX; 480]);
        assert!(
            (full - 1.0).abs() < 1e-6,
            "pleine échelle ≈ 1, obtenu {full}"
        );
        // Jamais au-delà de 1, même sur la pleine échelle négative.
        assert!(Vad::frame_rms(&[i16::MIN; 480]) <= 1.0);
        let half = Vad::frame_rms(&tone(i16::MAX / 2));
        assert!((0.4..=0.6).contains(&half), "demi-échelle ≈ 0,5 : {half}");
    }
}
