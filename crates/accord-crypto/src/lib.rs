//! # accord-crypto
//!
//! Couche cryptographique d'Accord (SPEC §2, §5) :
//!
//! - [`identity`] : paire Ed25519 immuable, NodeId, preuve de travail,
//!   clé X25519 statique dérivée ;
//! - [`handshake`] : établissement 1-RTT mutuellement authentifié avec
//!   transcript hash, anti-rejeu et cookies anti-DoS ;
//! - [`session`] : AEAD XChaCha20-Poly1305, nonces directionnels stricts,
//!   fenêtre anti-rejeu, re-keying par epochs (forward secrecy périodique) ;
//! - [`sealed`] : boîtes scellées vers une clé statique (clés de groupe,
//!   boîtes aux lettres) ;
//! - [`vault`] : stockage chiffré de l'identité au repos (Argon2id) ;
//! - [`mnemonic`] : phrase de récupération BIP39 de 12 mots ;
//! - [`friendcode`] : codes amis `MOT-MOT-MOT-1234` avec somme de contrôle.
//!
//! Primitives : crates RustCrypto auditées (décision D-001). Aucun `unsafe`.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod error;
pub mod friendcode;
pub mod handshake;
pub mod identity;
pub mod mnemonic;
pub mod sealed;
pub mod session;
pub mod vault;

pub use error::CryptoError;
pub use friendcode::{FriendCode, FRIENDCODE_PAYLOAD_LEN};
pub use handshake::{respond, CookieJar, Established, Initiator, NonceCache};
pub use identity::{node_id_of, verify_pow, verify_signature, Identity};
pub use session::{SessionCrypto, SessionKeys};
pub use vault::{open_vault, seal_vault, VaultParams};

/// Dérive la clé de chiffrement de la base locale depuis la seed d'identité :
/// `HKDF-Extract(salt="accord-db", ikm=seed)` puis `Expand("sqlite", 32)`
/// (SPEC §2.6).
pub fn derive_db_key(seed: &[u8; 32]) -> [u8; 32] {
    use hkdf::Hkdf;
    use sha2::Sha256;
    let hk = Hkdf::<Sha256>::new(Some(b"accord-db"), seed);
    let mut key = [0u8; 32];
    hk.expand(b"sqlite", &mut key)
        .expect("longueur HKDF valide");
    key
}

/// Dérive la clé HMAC de l'index de recherche (décision D-011).
pub fn derive_search_key(seed: &[u8; 32]) -> [u8; 32] {
    use hkdf::Hkdf;
    use sha2::Sha256;
    let hk = Hkdf::<Sha256>::new(Some(b"accord-db"), seed);
    let mut key = [0u8; 32];
    hk.expand(b"search", &mut key)
        .expect("longueur HKDF valide");
    key
}

#[cfg(test)]
mod tests {
    #[test]
    fn derived_keys_distinct() {
        let seed = [1u8; 32];
        assert_ne!(super::derive_db_key(&seed), super::derive_search_key(&seed));
        assert_ne!(
            super::derive_db_key(&seed),
            super::derive_db_key(&[2u8; 32])
        );
    }
}
