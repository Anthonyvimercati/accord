//! Constantes audio du protocole voix (SPEC §8).

/// Fréquence d'échantillonnage Opus (Hz).
pub const SAMPLE_RATE: u32 = 48_000;
/// Durée d'une trame (ms).
pub const FRAME_MS: u32 = 20;
/// Échantillons mono par trame (48 kHz × 20 ms).
pub const FRAME_SAMPLES: usize = (SAMPLE_RATE as usize * FRAME_MS as usize) / 1000;
/// Canaux (mono).
pub const CHANNELS: usize = 1;

/// Débit minimal (bit/s).
pub const BITRATE_MIN: u32 = 16_000;
/// Débit maximal (bit/s).
pub const BITRATE_MAX: u32 = 64_000;
/// Pas d'augmentation du débit (bit/s).
pub const BITRATE_STEP: u32 = 8_000;

/// Profondeur minimale du tampon de gigue (trames = 40 ms).
pub const JITTER_MIN_FRAMES: usize = 2;
/// Profondeur maximale du tampon de gigue (trames = 200 ms).
pub const JITTER_MAX_FRAMES: usize = 10;

/// Seuil VAD (dBFS).
pub const VAD_THRESHOLD_DBFS: f32 = -50.0;
/// Hystérésis VAD (ms) : maintien après passage sous le seuil.
pub const VAD_HANGOVER_MS: u32 = 200;

/// Participants maximaux d'un salon vocal (full mesh).
pub const MAX_PARTICIPANTS: usize = accord_proto::limits::VOICE_MAX_PARTICIPANTS;
