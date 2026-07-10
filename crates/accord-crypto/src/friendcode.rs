//! Codes amis `MOT-MOT-MOT-MOT-MOT-MOT-1234` (SPEC §5) : encodage des 64 premiers
//! bits du hash de la clé publique sur le dictionnaire BIP39 (6 mots), somme de
//! contrôle de 4 chiffres détectant les fautes de frappe, et clé de résolution DHT.
//!
//! Les 64 bits d'entropie rendent infaisable le grinding d'une paire de clés dont
//! le code ami collisionnerait avec celui d'une victime (~2^64 essais, contre les
//! ~2^33 de l'ancien format usurpable).

use crate::error::CryptoError;
use bip39::Language;
use sha2::{Digest, Sha256};

/// Longueur, en octets, du payload d'un code ami : 64 bits d'entropie dérivés du
/// hash de la clé publique (SPEC §5). Constante partagée par les couches qui
/// encodent ou valident un record d'identité (`payload ‖ pubkey`).
pub const FRIENDCODE_PAYLOAD_LEN: usize = 8;

/// Nombre de mots BIP39 (index 11 bits) affichés : `ceil(64 / 11) = 6`. Six mots
/// couvrent 66 bits de capacité ; les 2 bits excédentaires du premier mot sont
/// toujours nuls pour un code légitime, garantissant un aller-retour exact.
const FRIENDCODE_WORDS: usize = 6;

/// Payload d'un code ami : 64 bits utiles dérivés de `SHA-256(pubkey)[..8]`,
/// sans masquage réducteur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FriendCode {
    payload: [u8; FRIENDCODE_PAYLOAD_LEN],
}

fn wordlist() -> &'static [&'static str] {
    Language::English.word_list()
}

/// Valeur numérique des 64 bits du payload (big-endian), base de l'encodage en mots.
fn payload_to_u64(payload: &[u8; FRIENDCODE_PAYLOAD_LEN]) -> u64 {
    u64::from_be_bytes(*payload)
}

/// Reconstruit le payload de 8 octets à partir de sa valeur 64 bits.
fn u64_to_payload(v: u64) -> [u8; FRIENDCODE_PAYLOAD_LEN] {
    v.to_be_bytes()
}

fn checksum(payload: &[u8; FRIENDCODE_PAYLOAD_LEN]) -> u16 {
    let mut h = Sha256::new();
    h.update(b"accord-fc");
    h.update(payload);
    let d = h.finalize();
    (u16::from_be_bytes([d[0], d[1]])) % 10000
}

impl FriendCode {
    /// Code ami de la clé publique Ed25519 d'un utilisateur : 64 bits de
    /// `SHA-256(pubkey)`, sans troncature de bits (contrairement à l'ancien
    /// format à 33 bits, grindable).
    pub fn of_pubkey(pubkey: &[u8; 32]) -> Self {
        let hash: [u8; 32] = Sha256::digest(pubkey).into();
        let mut payload = [0u8; FRIENDCODE_PAYLOAD_LEN];
        payload.copy_from_slice(&hash[..FRIENDCODE_PAYLOAD_LEN]);
        Self { payload }
    }

    /// Vérifie qu'une clé publique correspond à ce code (résolution DHT).
    pub fn matches_pubkey(&self, pubkey: &[u8; 32]) -> bool {
        Self::of_pubkey(pubkey) == *self
    }

    /// Clé DHT de résolution : `SHA-256("friendcode-v1" ‖ payload)`.
    pub fn dht_key(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(b"friendcode-v1");
        h.update(self.payload);
        h.finalize().into()
    }

    /// Représentation canonique `MOT-MOT-MOT-MOT-MOT-MOT-0042` (mots en capitales).
    ///
    /// Les 64 bits sont découpés en 6 tranches de 11 bits (base 2048) ; le premier
    /// mot ne porte que les 9 bits de poids fort restants.
    pub fn display(&self) -> String {
        let v = payload_to_u64(&self.payload);
        let words = wordlist();
        let mut parts: Vec<String> = Vec::with_capacity(FRIENDCODE_WORDS + 1);
        for i in 0..FRIENDCODE_WORDS {
            let shift = 11 * (FRIENDCODE_WORDS - 1 - i);
            let idx = ((v >> shift) & 0x7FF) as usize;
            parts.push(words[idx].to_uppercase());
        }
        parts.push(format!("{:04}", checksum(&self.payload)));
        parts.join("-")
    }

    /// Analyse un code saisi : tolère casse, espaces ou tirets ; vérifie le
    /// dictionnaire et la somme de contrôle (détection de faute de frappe).
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        let cleaned = input.trim().to_lowercase();
        let parts: Vec<&str> = cleaned
            .split(|c: char| c == '-' || c.is_whitespace())
            .filter(|p| !p.is_empty())
            .collect();
        if parts.len() != FRIENDCODE_WORDS + 1 {
            return Err(CryptoError::BadFriendCode);
        }
        let words = wordlist();
        let mut v: u64 = 0;
        for part in &parts[..FRIENDCODE_WORDS] {
            let idx = words
                .iter()
                .position(|w| w == part)
                .ok_or(CryptoError::BadFriendCode)?;
            v = (v << 11) | idx as u64;
        }
        let digits = parts[FRIENDCODE_WORDS];
        if digits.len() != 4 || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return Err(CryptoError::BadFriendCode);
        }
        let claimed: u16 = digits.parse().map_err(|_| CryptoError::BadFriendCode)?;
        let payload = u64_to_payload(v);
        if checksum(&payload) != claimed {
            return Err(CryptoError::BadFriendCode);
        }
        Ok(Self { payload })
    }

    /// Payload brut (pour l'encodage filaire des records IDENTITY).
    pub fn payload(&self) -> &[u8; FRIENDCODE_PAYLOAD_LEN] {
        &self.payload
    }

    /// Reconstruit depuis un payload brut (record DHT reçu). Tout mot de 8 octets
    /// est un payload valide (plus de bits réservés à masquer).
    pub fn from_payload(payload: [u8; FRIENDCODE_PAYLOAD_LEN]) -> Self {
        Self { payload }
    }
}

/// Lien profond d'ajout d'ami : `p2papp://add/MOT-MOT-MOT-MOT-MOT-MOT-0042`.
pub fn deep_link(code: &FriendCode) -> String {
    format!("p2papp://add/{}", code.display())
}

/// Extrait un code ami d'un lien profond `p2papp://add/...`.
pub fn parse_deep_link(url: &str) -> Result<FriendCode, CryptoError> {
    let rest = url
        .strip_prefix("p2papp://add/")
        .ok_or(CryptoError::BadFriendCode)?;
    FriendCode::parse(rest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn display_parse_roundtrip() {
        for i in 0..50u8 {
            let pubkey = [i; 32];
            let code = FriendCode::of_pubkey(&pubkey);
            let s = code.display();
            let parsed = FriendCode::parse(&s).unwrap();
            assert_eq!(parsed, code);
            assert!(parsed.matches_pubkey(&pubkey));
            // Aller-retour exact du payload via la représentation affichée.
            assert_eq!(parsed.payload(), code.payload());
        }
    }

    #[test]
    fn format_shape() {
        let code = FriendCode::of_pubkey(&[42; 32]);
        let s = code.display();
        let parts: Vec<&str> = s.split('-').collect();
        assert_eq!(parts.len(), FRIENDCODE_WORDS + 1);
        assert!(parts[..FRIENDCODE_WORDS]
            .iter()
            .all(|w| w.chars().all(|c| c.is_ascii_uppercase())));
        let digits = parts[FRIENDCODE_WORDS];
        assert_eq!(digits.len(), 4);
        assert!(digits.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn parse_tolerates_case_and_separators() {
        let code = FriendCode::of_pubkey(&[7; 32]);
        let s = code.display();
        let lower = s.to_lowercase().replace('-', " ");
        assert_eq!(FriendCode::parse(&lower).unwrap(), code);
        assert_eq!(FriendCode::parse(&format!("  {s}  ")).unwrap(), code);
    }

    #[test]
    fn typo_detected_by_checksum() {
        let code = FriendCode::of_pubkey(&[9; 32]);
        let s = code.display();
        let mut parts: Vec<String> = s.split('-').map(String::from).collect();
        // Remplace le premier mot par un autre mot valide du dictionnaire.
        let words = wordlist();
        let current = parts[0].to_lowercase();
        let other = words.iter().find(|w| **w != current).unwrap();
        parts[0] = other.to_uppercase();
        let tampered = parts.join("-");
        assert_eq!(
            FriendCode::parse(&tampered).unwrap_err(),
            CryptoError::BadFriendCode
        );
        // Chiffres altérés ⇒ rejet.
        let mut bad: Vec<String> = s.split('-').map(String::from).collect();
        let last = bad.len() - 1;
        let claimed: u16 = bad[last].parse().unwrap();
        bad[last] = format!("{:04}", (claimed + 1) % 10000);
        let bad_digits = bad.join("-");
        assert_eq!(
            FriendCode::parse(&bad_digits).unwrap_err(),
            CryptoError::BadFriendCode
        );
    }

    #[test]
    fn garbage_rejected() {
        for bad in [
            "",
            "UN-DEUX",
            "not-real-words-here-at-all-1234",
            "a-b-c-d-e-f-g",
            "MOT",
        ] {
            assert!(FriendCode::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn deep_link_roundtrip() {
        let code = FriendCode::of_pubkey(&[3; 32]);
        let url = deep_link(&code);
        assert!(url.starts_with("p2papp://add/"));
        assert_eq!(parse_deep_link(&url).unwrap(), code);
        assert!(parse_deep_link("https://mauvais/lien").is_err());
    }

    #[test]
    fn dht_key_stable_and_distinct() {
        let a = FriendCode::of_pubkey(&[1; 32]);
        let b = FriendCode::of_pubkey(&[2; 32]);
        assert_eq!(a.dht_key(), a.dht_key());
        assert_ne!(a.dht_key(), b.dht_key());
    }

    #[test]
    fn from_payload_roundtrips_through_display() {
        let payload = [0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x23, 0x45, 0x67];
        let code = FriendCode::from_payload(payload);
        assert_eq!(code.payload(), &payload);
        let parsed = FriendCode::parse(&code.display()).unwrap();
        assert_eq!(parsed, code);
    }

    #[test]
    fn payload_carries_64_bits() {
        // L'entropie du code ami repose sur 8 octets = 64 bits (SPEC §5), ce qui
        // rend le grinding de collision infaisable (~2^64 essais).
        assert_eq!(FRIENDCODE_PAYLOAD_LEN, 8);
        assert_eq!(FriendCode::of_pubkey(&[1; 32]).payload().len(), 8);
        // Des clés distinctes donnent des payloads distincts (pas de troncature
        // réductrice à 33 bits) : aucune collision sur un large échantillon.
        let mut seen: HashSet<[u8; FRIENDCODE_PAYLOAD_LEN]> = HashSet::new();
        for i in 0..=255u8 {
            let code = FriendCode::of_pubkey(&[i; 32]);
            assert!(
                seen.insert(*code.payload()),
                "collision de payload inattendue pour la clé {i}"
            );
        }
    }
}
