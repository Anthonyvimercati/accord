//! Linear output gain applied to decoded PCM frames.
//!
//! Volumes are expressed UI-side as integer percents (0..=200, 100 = unity)
//! and converted here to a linear factor. The gain is applied sample by
//! sample on the decoded PCM, saturating at the `i16` bounds so that boosted
//! audio clips instead of wrapping around.

/// Maximum volume percent (200 % ≈ +6 dB boost).
pub const VOLUME_MAX_PCT: u16 = 200;

/// Default volume percent (unity gain).
pub const VOLUME_DEFAULT_PCT: u16 = 100;

/// Converts an integer volume percent (clamped to 0..=200) to a linear gain.
pub fn gain_of_pct(pct: u16) -> f32 {
    f32::from(pct.min(VOLUME_MAX_PCT)) / 100.0
}

/// Applies a linear gain in place, saturating at the `i16` bounds to avoid
/// wrap-around clipping artifacts. Unity gain is a no-op.
pub fn apply_gain(pcm: &mut [i16], gain: f32) {
    if (gain - 1.0).abs() < f32::EPSILON {
        return;
    }
    let clamped = gain.clamp(
        0.0,
        gain_of_pct(VOLUME_MAX_PCT) * gain_of_pct(VOLUME_MAX_PCT),
    );
    for sample in pcm.iter_mut() {
        let scaled = (f32::from(*sample) * clamped).round();
        *sample = scaled.clamp(f32::from(i16::MIN), f32::from(i16::MAX)) as i16;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unity_gain_leaves_samples_untouched() {
        let mut pcm = vec![0i16, 100, -100, i16::MAX, i16::MIN];
        let original = pcm.clone();
        apply_gain(&mut pcm, 1.0);
        assert_eq!(pcm, original);
    }

    #[test]
    fn half_gain_halves_samples() {
        let mut pcm = vec![200i16, -200, 0];
        apply_gain(&mut pcm, 0.5);
        assert_eq!(pcm, vec![100, -100, 0]);
    }

    #[test]
    fn zero_gain_silences() {
        let mut pcm = vec![12_345i16, -12_345];
        apply_gain(&mut pcm, 0.0);
        assert_eq!(pcm, vec![0, 0]);
    }

    #[test]
    fn boost_saturates_instead_of_wrapping() {
        let mut pcm = vec![i16::MAX, i16::MIN, 20_000, -20_000];
        apply_gain(&mut pcm, 2.0);
        assert_eq!(pcm, vec![i16::MAX, i16::MIN, i16::MAX, i16::MIN]);
    }

    #[test]
    fn percent_conversion_is_clamped() {
        assert_eq!(gain_of_pct(0), 0.0);
        assert_eq!(gain_of_pct(100), 1.0);
        assert_eq!(gain_of_pct(200), 2.0);
        // Above the bound: clamped to the maximum.
        assert_eq!(gain_of_pct(1_000), 2.0);
    }
}
