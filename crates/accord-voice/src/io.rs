//! Capture et lecture audio matérielles via `cpal` (feature `hardware`, D-020).
//!
//! [`AudioInput`] ouvre le micro (par défaut ou désigné par son nom `cpal`,
//! D-029) et livre des trames PCM 48 kHz mono `i16` de 20 ms prêtes pour
//! [`crate::room::VoiceRoom::capture`] ; [`AudioOutput`] joue les trames
//! décodées par [`crate::room::VoiceRoom::play`]. [`input_devices`] et
//! [`output_devices`] énumèrent les périphériques par nom. Les files sont
//! bornées : sous pression, on jette des trames plutôt que de laisser la
//! latence enfler (le PLC du codec dissimule les trous). Les journaux ne
//! contiennent jamais d'audio.

use std::sync::mpsc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::convert::{
    downmix_i16, f32_to_i16, u16_to_i16, Declicker, FrameChunker, LinearResampler,
};
use crate::params::SAMPLE_RATE;

/// Trames en file au maximum (borne de latence : 32 × 20 ms = 640 ms).
const QUEUE_FRAMES: usize = 32;

/// Erreur d'entrée/sortie audio.
#[derive(Debug, thiserror::Error)]
pub enum IoError {
    /// Aucun périphérique d'entrée ou de sortie par défaut.
    #[error("aucun périphérique audio disponible")]
    NoDevice,
    /// Périphérique demandé par nom introuvable (débranché ou renommé).
    #[error("périphérique audio introuvable : {0}")]
    UnknownDevice(String),
    /// Format d'échantillon du périphérique non pris en charge.
    #[error("format d'échantillon audio non pris en charge")]
    UnsupportedFormat,
    /// Erreur du backend audio.
    #[error("audio : {0}")]
    Backend(String),
}

fn backend<E: std::fmt::Display>(e: E) -> IoError {
    IoError::Backend(e.to_string())
}

/// Noms `cpal` des périphériques d'entrée disponibles (les périphériques sans
/// nom lisible sont omis).
pub fn input_devices() -> Result<Vec<String>, IoError> {
    let devices = cpal::default_host().input_devices().map_err(backend)?;
    Ok(devices.filter_map(|d| d.name().ok()).collect())
}

/// Noms `cpal` des périphériques de sortie disponibles (les périphériques
/// sans nom lisible sont omis).
pub fn output_devices() -> Result<Vec<String>, IoError> {
    let devices = cpal::default_host().output_devices().map_err(backend)?;
    Ok(devices.filter_map(|d| d.name().ok()).collect())
}

/// Résout un périphérique d'entrée : `None` = défaut, sinon par nom exact.
fn find_input_device(name: Option<&str>) -> Result<cpal::Device, IoError> {
    let host = cpal::default_host();
    match name {
        None => host.default_input_device().ok_or(IoError::NoDevice),
        Some(name) => host
            .input_devices()
            .map_err(backend)?
            .find(|d| d.name().is_ok_and(|n| n == name))
            .ok_or_else(|| IoError::UnknownDevice(name.to_string())),
    }
}

/// Résout un périphérique de sortie : `None` = défaut, sinon par nom exact.
fn find_output_device(name: Option<&str>) -> Result<cpal::Device, IoError> {
    let host = cpal::default_host();
    match name {
        None => host.default_output_device().ok_or(IoError::NoDevice),
        Some(name) => host
            .output_devices()
            .map_err(backend)?
            .find(|d| d.name().is_ok_and(|n| n == name))
            .ok_or_else(|| IoError::UnknownDevice(name.to_string())),
    }
}

/// Capture micro : flux `cpal` converti en trames 48 kHz mono `i16` de 20 ms.
pub struct AudioInput {
    _stream: cpal::Stream,
    rx: mpsc::Receiver<Vec<i16>>,
}

impl AudioInput {
    /// Ouvre le périphérique d'entrée par défaut et démarre la capture.
    pub fn open() -> Result<Self, IoError> {
        Self::open_device(None)
    }

    /// Ouvre un périphérique d'entrée par nom `cpal` (`None` = défaut) et
    /// démarre la capture. Nom inconnu (périphérique débranché ou renommé) :
    /// [`IoError::UnknownDevice`], jamais de panique.
    pub fn open_device(name: Option<&str>) -> Result<Self, IoError> {
        let device = find_input_device(name)?;
        let supported = device.default_input_config().map_err(backend)?;
        let channels = (supported.channels() as usize).max(1);
        let stream_config = supported.config();
        let (tx, rx) = mpsc::sync_channel::<Vec<i16>>(QUEUE_FRAMES);

        let mut resampler = LinearResampler::new(supported.sample_rate().0, SAMPLE_RATE);
        let mut chunker = FrameChunker::default();
        let mut deliver = move |mono: Vec<i16>| {
            let mut resampled = Vec::with_capacity(mono.len());
            resampler.process(&mono, &mut resampled);
            chunker.push(&resampled);
            while let Some(frame) = chunker.next_frame() {
                // File pleine : trame jetée, jouer en retard serait pire.
                let _ = tx.try_send(frame);
            }
        };
        let on_err = |e: cpal::StreamError| tracing::warn!("flux d'entrée audio : {e}");

        let stream = match supported.sample_format() {
            cpal::SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    deliver(downmix_i16(data, channels));
                },
                on_err,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &stream_config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    deliver(downmix_i16(&u16_to_i16(data), channels));
                },
                on_err,
                None,
            ),
            cpal::SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    deliver(downmix_i16(&f32_to_i16(data), channels));
                },
                on_err,
                None,
            ),
            _ => return Err(IoError::UnsupportedFormat),
        }
        .map_err(backend)?;
        stream.play().map_err(backend)?;
        Ok(Self {
            _stream: stream,
            rx,
        })
    }

    /// Prochaine trame capturée, sans bloquer (`None` si rien de prêt).
    pub fn try_frame(&self) -> Option<Vec<i16>> {
        self.rx.try_recv().ok()
    }
}

/// Lecture haut-parleur : trames 48 kHz mono `i16` vers le flux `cpal`.
pub struct AudioOutput {
    _stream: cpal::Stream,
    tx: mpsc::SyncSender<Vec<i16>>,
}

impl AudioOutput {
    /// Ouvre le périphérique de sortie par défaut et démarre la lecture.
    pub fn open() -> Result<Self, IoError> {
        Self::open_device(None)
    }

    /// Ouvre un périphérique de sortie par nom `cpal` (`None` = défaut) et
    /// démarre la lecture. Nom inconnu : [`IoError::UnknownDevice`].
    pub fn open_device(name: Option<&str>) -> Result<Self, IoError> {
        let device = find_output_device(name)?;
        let supported = device.default_output_config().map_err(backend)?;
        let channels = (supported.channels() as usize).max(1);
        let stream_config = supported.config();
        let (tx, rx) = mpsc::sync_channel::<Vec<i16>>(QUEUE_FRAMES);

        let mut resampler = LinearResampler::new(SAMPLE_RATE, supported.sample_rate().0);
        let mut pending: Vec<i16> = Vec::new();
        let mut declick = Declicker::default();
        // Produit `count` échantillons mono à la fréquence du périphérique,
        // complétés en cas de famine par une rampe anti-clic puis du silence
        // (des zéros bruts claqueraient à la coupure et à la reprise, D-051).
        let mut next_mono = move |count: usize| -> Vec<i16> {
            while pending.len() < count {
                match rx.try_recv() {
                    Ok(frame) => resampler.process(&frame, &mut pending),
                    Err(_) => break,
                }
            }
            let take = pending.len().min(count);
            let mut mono: Vec<i16> = pending.drain(..take).collect();
            declick.smooth(&mut mono);
            if mono.len() < count {
                declick.pad_gap(&mut mono, count);
            }
            mono
        };
        let on_err = |e: cpal::StreamError| tracing::warn!("flux de sortie audio : {e}");

        let stream = match supported.sample_format() {
            cpal::SampleFormat::I16 => device.build_output_stream(
                &stream_config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    let mono = next_mono(data.len() / channels);
                    for (sample, out) in mono.iter().zip(data.chunks_exact_mut(channels)) {
                        out.fill(*sample);
                    }
                },
                on_err,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_output_stream(
                &stream_config,
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    let mono = next_mono(data.len() / channels);
                    for (sample, out) in mono.iter().zip(data.chunks_exact_mut(channels)) {
                        out.fill((*sample as i32 + 32768) as u16);
                    }
                },
                on_err,
                None,
            ),
            cpal::SampleFormat::F32 => device.build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let mono = next_mono(data.len() / channels);
                    for (sample, out) in mono.iter().zip(data.chunks_exact_mut(channels)) {
                        out.fill(*sample as f32 / i16::MAX as f32);
                    }
                },
                on_err,
                None,
            ),
            _ => return Err(IoError::UnsupportedFormat),
        }
        .map_err(backend)?;
        stream.play().map_err(backend)?;
        Ok(Self {
            _stream: stream,
            tx,
        })
    }

    /// File une trame 48 kHz mono à jouer (jetée si la file déborde : le PLC
    /// couvre le trou, la latence reste bornée).
    pub fn play(&self, frame: Vec<i16>) {
        let _ = self.tx.try_send(frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Nom qu'aucun périphérique réel ne porte.
    const UNKNOWN: &str = "accord-périphérique-inexistant";

    #[test]
    fn open_input_by_unknown_name_is_a_typed_error() {
        // Erreur typée propre (périphérique disparu/renommé), jamais de
        // panique. `Backend` couvre les hôtes sans énumération (CI headless).
        match AudioInput::open_device(Some(UNKNOWN)) {
            Err(IoError::UnknownDevice(name)) => assert_eq!(name, UNKNOWN),
            Err(IoError::Backend(_)) => {}
            Err(other) => panic!("erreur inattendue : {other}"),
            Ok(_) => panic!("un périphérique inconnu ne doit pas s'ouvrir"),
        }
    }

    #[test]
    fn open_output_by_unknown_name_is_a_typed_error() {
        match AudioOutput::open_device(Some(UNKNOWN)) {
            Err(IoError::UnknownDevice(name)) => assert_eq!(name, UNKNOWN),
            Err(IoError::Backend(_)) => {}
            Err(other) => panic!("erreur inattendue : {other}"),
            Ok(_) => panic!("un périphérique inconnu ne doit pas s'ouvrir"),
        }
    }

    #[test]
    fn enumeration_never_panics_and_names_are_non_empty() {
        if let Ok(names) = input_devices() {
            assert!(names.iter().all(|n| !n.is_empty()));
        }
        if let Ok(names) = output_devices() {
            assert!(names.iter().all(|n| !n.is_empty()));
        }
    }
}
