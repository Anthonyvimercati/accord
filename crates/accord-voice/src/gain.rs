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

/// Soft-limiter threshold (≈ −1.4 dBFS): below it, samples pass untouched.
const SOFT_LIMIT_THRESHOLD: f32 = 28_000.0;

/// Compresses a sample smoothly above [`SOFT_LIMIT_THRESHOLD`] instead of
/// hard-clipping at the `i16` bounds (hard clipping is what "crackles"). The
/// tanh knee maps any input magnitude into (threshold, i16::MAX) — safe for
/// values far beyond the `i16` range (e.g. a mixing accumulator).
pub fn soft_limit(x: f32) -> f32 {
    const MAX: f32 = 32_767.0;
    const RANGE: f32 = MAX - SOFT_LIMIT_THRESHOLD;
    let a = x.abs();
    if a <= SOFT_LIMIT_THRESHOLD {
        return x;
    }
    (SOFT_LIMIT_THRESHOLD + RANGE * ((a - SOFT_LIMIT_THRESHOLD) / RANGE).tanh()).copysign(x)
}

/// Applies a linear gain in place with the soft limiter as the ceiling: the
/// scaling happens in f32 BEFORE any `i16` clamp, so a boosted peak is
/// compressed smoothly instead of squared off. Used by the capture AGC.
pub fn apply_gain_soft(pcm: &mut [i16], gain: f32) {
    if (gain - 1.0).abs() < f32::EPSILON {
        return;
    }
    for sample in pcm.iter_mut() {
        *sample = soft_limit(f32::from(*sample) * gain).round() as i16;
    }
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
    fn soft_limit_is_transparent_below_threshold_and_never_wraps_above() {
        assert_eq!(soft_limit(0.0), 0.0);
        assert_eq!(soft_limit(10_000.0), 10_000.0);
        assert_eq!(soft_limit(-27_000.0), -27_000.0);
        // Au-delà du seuil : compressé, monotone, borné, signe conservé.
        let a = soft_limit(30_000.0);
        let b = soft_limit(60_000.0);
        let c = soft_limit(1_000_000.0);
        assert!(a > 28_000.0 && a < 30_000.0);
        assert!(b > a && c > b && c <= 32_767.0);
        assert_eq!(soft_limit(-60_000.0), -b);
    }

    #[test]
    fn soft_gain_compresses_peaks_instead_of_flattening_them() {
        // Écrêtage dur : deux pics différents finissent identiques (méplat).
        // Limiteur doux : l'ordre est conservé — pas de distorsion en plateau.
        let mut pcm = vec![8_000i16, 9_000];
        apply_gain_soft(&mut pcm, 4.0);
        assert!(pcm[0] < pcm[1], "l'ordre des pics doit survivre : {pcm:?}");
        assert!(pcm[1] > 28_000, "le limiteur doit mordre : {pcm:?}");
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
