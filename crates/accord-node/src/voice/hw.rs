//! Pont vers le matériel audio (feature `hardware`, D-020/D-025/D-029).
//!
//! Les flux `cpal` ne sont pas `Send` : la capture et la lecture vivent dans
//! un thread dédié, relié au moteur voix par des files bornées (sous
//! pression, on jette des trames plutôt que d'enfler la latence — le PLC du
//! codec couvre les trous). Deux sessions distinctes :
//!
//! - [`HardwareIo`] (salon vocal) : micro + haut-parleur, best-effort —
//!   l'absence d'un périphérique n'est pas fatale, le moteur continue en
//!   silence ;
//! - [`MicCapture`] (test micro, D-029) : capture seule, ouverture
//!   **confirmée** — l'appelant reçoit une erreur explicite si le
//!   périphérique choisi ne s'ouvre pas.
//!
//! Les deux acceptent un périphérique désigné par son nom `cpal`
//! (`None` = défaut système).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use accord_voice::{AudioInput, AudioOutput};

/// Trames en file entre le thread audio et le moteur (borne de latence).
const QUEUE_FRAMES: usize = 32;
/// Période de scrutation du thread audio.
const POLL: Duration = Duration::from_millis(5);

/// Session matérielle d'un salon : micro + haut-parleur en thread dédié.
pub(crate) struct HardwareIo {
    stop: Arc<AtomicBool>,
    capture_rx: mpsc::Receiver<Vec<i16>>,
    play_tx: mpsc::SyncSender<Vec<i16>>,
}

impl HardwareIo {
    /// Ouvre les périphériques choisis (`None` = défaut) dans un thread dédié
    /// (best-effort : un périphérique manquant ou disparu est journalisé,
    /// jamais bloquant).
    pub(crate) fn open(input: Option<String>, output: Option<String>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let (capture_tx, capture_rx) = mpsc::sync_channel::<Vec<i16>>(QUEUE_FRAMES);
        let (play_tx, play_rx) = mpsc::sync_channel::<Vec<i16>>(QUEUE_FRAMES);
        let flag = Arc::clone(&stop);
        let spawned = std::thread::Builder::new()
            .name("accord-voix-audio".into())
            .spawn(move || {
                audio_thread(
                    &flag,
                    input.as_deref(),
                    output.as_deref(),
                    &capture_tx,
                    &play_rx,
                );
            });
        if let Err(e) = spawned {
            tracing::warn!(erreur = %e, "voix : thread audio non démarré");
        }
        Self {
            stop,
            capture_rx,
            play_tx,
        }
    }

    /// Prochaine trame micro (48 kHz mono, 20 ms), sans bloquer.
    pub(crate) fn try_capture(&self) -> Option<Vec<i16>> {
        self.capture_rx.try_recv().ok()
    }

    /// File une trame décodée vers le haut-parleur (jetée si la file déborde).
    pub(crate) fn play(&self, frame: Vec<i16>) {
        let _ = self.play_tx.try_send(frame);
    }
}

impl Drop for HardwareIo {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Boucle du thread audio : shuttle micro → moteur et moteur → haut-parleur.
fn audio_thread(
    stop: &AtomicBool,
    input_name: Option<&str>,
    output_name: Option<&str>,
    capture_tx: &mpsc::SyncSender<Vec<i16>>,
    play_rx: &mpsc::Receiver<Vec<i16>>,
) {
    let input = match AudioInput::open_device(input_name) {
        Ok(input) => Some(input),
        Err(e) => {
            tracing::warn!(erreur = %e, "voix : micro indisponible (capture muette)");
            None
        }
    };
    let output = match AudioOutput::open_device(output_name) {
        Ok(output) => Some(output),
        Err(e) => {
            tracing::warn!(erreur = %e, "voix : sortie audio indisponible (lecture muette)");
            None
        }
    };
    if input.is_none() && output.is_none() {
        return;
    }
    while !stop.load(Ordering::Relaxed) {
        if let Some(input) = &input {
            while let Some(frame) = input.try_frame() {
                // File pleine : trame jetée (latence bornée).
                let _ = capture_tx.try_send(frame);
            }
        }
        if let Some(output) = &output {
            while let Ok(frame) = play_rx.try_recv() {
                output.play(frame);
            }
        }
        std::thread::sleep(POLL);
    }
}

/// Capture seule du test micro (D-029) : thread dédié dont l'ouverture est
/// confirmée — contrairement au salon, l'échec est rendu à l'appelant.
pub(crate) struct MicCapture {
    stop: Arc<AtomicBool>,
    capture_rx: mpsc::Receiver<Vec<i16>>,
}

impl MicCapture {
    /// Ouvre la capture sur le périphérique choisi (`None` = défaut) et
    /// attend la confirmation du thread audio. Erreur explicite (périphérique
    /// inconnu, occupé, absent) si l'ouverture échoue.
    pub(crate) async fn open(input: Option<String>) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (capture_tx, capture_rx) = mpsc::sync_channel::<Vec<i16>>(QUEUE_FRAMES);
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
        let flag = Arc::clone(&stop);
        std::thread::Builder::new()
            .name("accord-voix-test-micro".into())
            .spawn(move || mic_test_thread(&flag, input.as_deref(), &capture_tx, ready_tx))
            .map_err(|e| format!("thread audio non démarré : {e}"))?;
        match ready_rx.await {
            Ok(Ok(())) => Ok(Self { stop, capture_rx }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("thread audio interrompu".into()),
        }
    }

    /// Prochaine trame micro (48 kHz mono, 20 ms), sans bloquer.
    pub(crate) fn try_frame(&self) -> Option<Vec<i16>> {
        self.capture_rx.try_recv().ok()
    }
}

impl Drop for MicCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Boucle du thread de test micro : confirme l'ouverture puis shuttle les
/// trames capturées vers le moteur jusqu'au signal d'arrêt.
fn mic_test_thread(
    stop: &AtomicBool,
    input_name: Option<&str>,
    capture_tx: &mpsc::SyncSender<Vec<i16>>,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
) {
    let input = match AudioInput::open_device(input_name) {
        Ok(input) => input,
        Err(e) => {
            let _ = ready.send(Err(e.to_string()));
            return;
        }
    };
    if ready.send(Ok(())).is_err() {
        // Appelant parti : rien à capturer.
        return;
    }
    while !stop.load(Ordering::Relaxed) {
        while let Some(frame) = input.try_frame() {
            // File pleine : trame jetée (le niveau est un instantané).
            let _ = capture_tx.try_send(frame);
        }
        std::thread::sleep(POLL);
    }
}
