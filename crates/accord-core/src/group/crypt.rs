//! Chiffrement des groupes (SPEC §6.4) : clés symétriques par epoch,
//! distribution scellée par membre, AEAD des messages de salon.
//!
//! - Clé de groupe : 32 octets aléatoires, un epoch par rotation.
//! - Distribution : boîte scellée X25519 (`eph_pub(32) ‖ box(48)` = 80 octets).
//! - Message : `nonce(24) ‖ XChaCha20-Poly1305(corps)` avec
//!   `AAD = group_id ‖ channel_id ‖ msg_id ‖ key_epoch:u32be` — un chiffré ne
//!   peut donc pas être rejoué dans un autre salon, groupe ou message.

use accord_crypto::{sealed, CryptoError, Identity};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;

use crate::error::CoreError;

/// Taille du nonce XChaCha20-Poly1305.
const NONCE_LEN: usize = 24;
/// Taille d'une clé de groupe scellée (`eph_pub(32) ‖ box(32+16)`).
pub const SEALED_KEY_LEN: usize = 80;

/// Génère une clé de groupe aléatoire (32 octets, CSPRNG).
pub fn generate_group_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

/// Scelle une clé de groupe pour un membre (boîte scellée X25519 dérivée de
/// sa clé publique Ed25519). Rend exactement [`SEALED_KEY_LEN`] octets.
pub fn seal_group_key(
    member_ed_pub: &[u8; 32],
    key: &[u8; 32],
) -> Result<[u8; SEALED_KEY_LEN], CoreError> {
    let sealed = sealed::seal(member_ed_pub, key)?;
    sealed
        .try_into()
        .map_err(|_| CoreError::Invalid("taille de clé scellée inattendue"))
}

/// Ouvre une clé de groupe scellée reçue via `CoreMsg::GroupKey`.
pub fn open_group_key(
    identity: &Identity,
    sealed_key: &[u8; SEALED_KEY_LEN],
) -> Result<[u8; 32], CoreError> {
    let plain = sealed::open(identity, sealed_key)?;
    plain
        .try_into()
        .map_err(|_| CoreError::Invalid("clé de groupe scellée de taille invalide"))
}

/// AAD liant un chiffré à son contexte exact.
fn aad(group_id: &[u8; 16], channel_id: &[u8; 16], msg_id: &[u8; 16], key_epoch: u32) -> [u8; 52] {
    let mut out = [0u8; 52];
    out[..16].copy_from_slice(group_id);
    out[16..32].copy_from_slice(channel_id);
    out[32..48].copy_from_slice(msg_id);
    out[48..].copy_from_slice(&key_epoch.to_be_bytes());
    out
}

/// Chiffre un corps de message de groupe. Rend `nonce(24) ‖ ct` (format du
/// champ `body_enc` de `CoreMsg::GroupMsg`).
pub fn encrypt_group_msg(
    key: &[u8; 32],
    group_id: &[u8; 16],
    channel_id: &[u8; 16],
    msg_id: &[u8; 16],
    key_epoch: u32,
    plaintext: &[u8],
) -> Result<Vec<u8>, CoreError> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let aad = aad(group_id, channel_id, msg_id, key_epoch);
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| CoreError::Crypto(CryptoError::DecryptFailed))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Déchiffre un `body_enc` de message de groupe. Échoue si le contexte
/// (groupe, salon, message, epoch) ne correspond pas à celui du chiffrement.
pub fn decrypt_group_msg(
    key: &[u8; 32],
    group_id: &[u8; 16],
    channel_id: &[u8; 16],
    msg_id: &[u8; 16],
    key_epoch: u32,
    body_enc: &[u8],
) -> Result<Vec<u8>, CoreError> {
    if body_enc.len() < NONCE_LEN + 16 {
        return Err(CoreError::Invalid("corps chiffré trop court"));
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    let aad = aad(group_id, channel_id, msg_id, key_epoch);
    cipher
        .decrypt(
            XNonce::from_slice(&body_enc[..NONCE_LEN]),
            Payload {
                msg: &body_enc[NONCE_LEN..],
                aad: &aad,
            },
        )
        .map_err(|_| CoreError::Crypto(CryptoError::DecryptFailed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_roundtrips_through_sealed_box() {
        let member = Identity::generate_with_pow_bits(1);
        let key = generate_group_key();
        let sealed = seal_group_key(&member.public_key(), &key).unwrap();
        let opened = open_group_key(&member, &sealed).unwrap();
        assert_eq!(opened, key);
    }

    #[test]
    fn wrong_recipient_cannot_open_key() {
        let member = Identity::generate_with_pow_bits(1);
        let intruder = Identity::generate_with_pow_bits(1);
        let sealed = seal_group_key(&member.public_key(), &generate_group_key()).unwrap();
        assert!(open_group_key(&intruder, &sealed).is_err());
    }

    #[test]
    fn message_roundtrips_and_context_is_bound() {
        let key = generate_group_key();
        let (g, c, m) = ([1u8; 16], [2u8; 16], [3u8; 16]);
        let enc = encrypt_group_msg(&key, &g, &c, &m, 7, b"salut le groupe").unwrap();
        assert_eq!(
            decrypt_group_msg(&key, &g, &c, &m, 7, &enc).unwrap(),
            b"salut le groupe"
        );
        // Tout changement de contexte doit faire échouer l'ouverture.
        assert!(decrypt_group_msg(&key, &[9; 16], &c, &m, 7, &enc).is_err());
        assert!(decrypt_group_msg(&key, &g, &[9; 16], &m, 7, &enc).is_err());
        assert!(decrypt_group_msg(&key, &g, &c, &[9; 16], 7, &enc).is_err());
        assert!(decrypt_group_msg(&key, &g, &c, &m, 8, &enc).is_err());
        // Clé d'un autre epoch : échec aussi.
        assert!(decrypt_group_msg(&generate_group_key(), &g, &c, &m, 7, &enc).is_err());
    }

    #[test]
    fn truncated_ciphertext_is_rejected() {
        let key = generate_group_key();
        assert!(matches!(
            decrypt_group_msg(&key, &[0; 16], &[0; 16], &[0; 16], 1, &[0u8; 10]),
            Err(CoreError::Invalid(_))
        ));
    }
}
