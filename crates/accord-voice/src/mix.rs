//! Mixage des participants avant la sortie audio (D-051).
//!
//! Chaque tick de 20 ms produit au plus une trame décodée PAR participant ;
//! les envoyer une à une à la sortie les ferait jouer **à la suite** (voix
//! entrelacées, file qui enfle de 20 ms par tick puis jette des trames :
//! à-coups et robotisation dès trois participants). Ici, toutes les trames
//! du tick sont sommées en une seule, avec le limiteur doux comme plafond —
//! deux voix fortes se compressent au lieu de saturer.

use crate::gain::soft_limit;
use crate::params::FRAME_SAMPLES;

/// Mixe les trames décodées d'un tick en une seule trame de sortie.
///
/// - aucune trame : `None` (rien à jouer, la sortie reste silencieuse) ;
/// - une trame : rendue telle quelle (cas le plus courant, zéro coût) ;
/// - plusieurs : somme f32 + limiteur doux (jamais d'enroulement `i16`).
///
/// Les trames d'une taille inattendue sont ignorées (défense : la taille
/// vient du décodeur local, pas du réseau).
pub fn mix_frames(mut frames: Vec<Vec<i16>>) -> Option<Vec<i16>> {
    frames.retain(|f| f.len() == FRAME_SAMPLES);
    match frames.len() {
        0 => None,
        1 => frames.pop(),
        _ => {
            let mut acc = vec![0.0f32; FRAME_SAMPLES];
            for frame in &frames {
                for (dst, &src) in acc.iter_mut().zip(frame.iter()) {
                    *dst += f32::from(src);
                }
            }
            Some(
                acc.into_iter()
                    .map(|v| soft_limit(v).round() as i16)
                    .collect(),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_frame_yields_nothing() {
        assert_eq!(mix_frames(Vec::new()), None);
    }

    #[test]
    fn single_frame_passes_through_unchanged() {
        let frame: Vec<i16> = (0..FRAME_SAMPLES).map(|i| (i % 251) as i16 - 125).collect();
        assert_eq!(mix_frames(vec![frame.clone()]), Some(frame));
    }

    #[test]
    fn moderate_frames_sum_exactly() {
        let a = vec![1_000i16; FRAME_SAMPLES];
        let b = vec![-400i16; FRAME_SAMPLES];
        let c = vec![250i16; FRAME_SAMPLES];
        let mixed = mix_frames(vec![a, b, c]).expect("trame mixée");
        assert!(mixed.iter().all(|&s| s == 850));
    }

    #[test]
    fn loud_frames_compress_without_wrapping() {
        let a = vec![30_000i16; FRAME_SAMPLES];
        let b = vec![30_000i16; FRAME_SAMPLES];
        let mixed = mix_frames(vec![a, b]).expect("trame mixée");
        // Jamais d'enroulement (le signe reste positif), plafond respecté,
        // et le limiteur mord (la somme brute 60 000 est compressée).
        assert!(mixed.iter().all(|&s| s > 28_000 && s <= i16::MAX));
    }

    #[test]
    fn unexpected_sizes_are_ignored() {
        let good = vec![500i16; FRAME_SAMPLES];
        let bad = vec![500i16; 12];
        assert_eq!(mix_frames(vec![bad.clone()]), None);
        assert_eq!(mix_frames(vec![good.clone(), bad]), Some(good));
    }
}
