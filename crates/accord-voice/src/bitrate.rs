//! Débit adaptatif piloté par la perte mesurée (SPEC §8).
//!
//! Échelle descendante immédiate sur perte, remontée prudente par paliers :
//! `≥ 10 % ⇒ 16k`, `≥ 5 % ⇒ 24k`, `≥ 2 % ⇒ 32k`, sinon `+8k` jusqu'à 64k.

use crate::params::{BITRATE_MAX, BITRATE_MIN, BITRATE_STEP};

/// Débit cible d'après le débit courant et la perte (0–100 %).
pub fn adapt(current: u32, loss_pct: u8) -> u32 {
    let target = if loss_pct >= 10 {
        BITRATE_MIN
    } else if loss_pct >= 5 {
        24_000
    } else if loss_pct >= 2 {
        32_000
    } else {
        // Réseau sain : on remonte d'un palier.
        current.saturating_add(BITRATE_STEP).min(BITRATE_MAX)
    };
    target.clamp(BITRATE_MIN, BITRATE_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loss_forces_downshift_immediately() {
        assert_eq!(adapt(64_000, 10), BITRATE_MIN);
        assert_eq!(adapt(64_000, 12), BITRATE_MIN);
        assert_eq!(adapt(64_000, 5), 24_000);
        assert_eq!(adapt(64_000, 2), 32_000);
    }

    #[test]
    fn healthy_network_ramps_up_by_steps_capped() {
        let mut br = BITRATE_MIN;
        for _ in 0..20 {
            br = adapt(br, 0);
        }
        assert_eq!(br, BITRATE_MAX);
        // Ne dépasse jamais le plafond.
        assert_eq!(adapt(BITRATE_MAX, 0), BITRATE_MAX);
    }

    #[test]
    fn output_is_always_within_bounds() {
        for loss in 0..=100u8 {
            for current in [BITRATE_MIN, 32_000, BITRATE_MAX] {
                let br = adapt(current, loss);
                assert!((BITRATE_MIN..=BITRATE_MAX).contains(&br));
            }
        }
    }
}
