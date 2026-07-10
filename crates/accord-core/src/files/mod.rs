//! Partage de fichiers (SPEC §9) : intégrité Merkle, correction
//! d'effacements Reed-Solomon 10+4 et téléchargement multi-sources fenêtré.

pub mod fec;
pub mod fetch;
pub mod merkle;
pub mod transfer;

pub use fetch::Coordinator;
pub use transfer::{BlockOutcome, Transfer, WINDOW_PER_SOURCE};
