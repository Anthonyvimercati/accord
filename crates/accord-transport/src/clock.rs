//! Horloge abstraite : réelle en production, manuelle et déterministe en test.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Source de temps murale en millisecondes UNIX.
pub trait Clock: Send + Sync + 'static {
    /// Horloge murale courante (ms depuis l'époque UNIX).
    fn now_ms(&self) -> u64;
}

/// Horloge système réelle.
#[derive(Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}

/// Horloge manuelle pour les tests (avance contrôlée).
#[derive(Clone, Default)]
pub struct ManualClock {
    ms: Arc<AtomicU64>,
}

impl ManualClock {
    /// Crée une horloge à `start_ms`.
    pub fn new(start_ms: u64) -> Self {
        Self {
            ms: Arc::new(AtomicU64::new(start_ms)),
        }
    }

    /// Avance l'horloge de `delta_ms`.
    pub fn advance(&self, delta_ms: u64) {
        self.ms.fetch_add(delta_ms, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.ms.load(Ordering::SeqCst)
    }
}
