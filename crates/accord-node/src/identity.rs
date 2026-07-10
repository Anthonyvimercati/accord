//! Stockage local de l'identité (SPEC §2.6).
//!
//! L'identité (graine Ed25519 + nonce PoW) est chiffrée au repos par un
//! coffre Argon2id dérivé de la phrase de passe de l'utilisateur. La clé de
//! base de données SQLCipher est dérivée séparément de la graine (HKDF).
//! Rien n'est écrit en clair : sans la phrase de passe, ni l'identité ni la
//! base ne s'ouvrent.

use std::path::{Path, PathBuf};

use accord_crypto::{derive_db_key, Identity};
use zeroize::Zeroizing;

use crate::error::NodeError;

/// Fichier du coffre d'identité dans le répertoire de données.
const VAULT_FILE: &str = "identity.vault";
/// Fichier de la base locale chiffrée.
const DB_FILE: &str = "accord.db";

/// Emplacement des données d'un profil.
#[derive(Debug, Clone)]
pub struct Paths {
    /// Répertoire racine du profil.
    pub root: PathBuf,
}

impl Paths {
    /// Construit les chemins pour un répertoire de profil.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Chemin du coffre d'identité.
    pub fn vault(&self) -> PathBuf {
        self.root.join(VAULT_FILE)
    }

    /// Chemin de la base locale.
    pub fn db(&self) -> PathBuf {
        self.root.join(DB_FILE)
    }

    /// Vrai si un coffre d'identité existe déjà.
    pub fn has_identity(&self) -> bool {
        self.vault().exists()
    }
}

/// Identité déverrouillée et clé de base associée (effacée à la libération).
pub struct Unlocked {
    /// Identité prête à signer/chiffrer.
    pub identity: Identity,
    /// Clé SQLCipher dérivée de la graine.
    pub db_key: Zeroizing<[u8; 32]>,
}

/// Crée une nouvelle identité, la scelle sur disque et rend l'état
/// déverrouillé. Refuse si un coffre existe déjà.
pub fn create(paths: &Paths, passphrase: &str, pow_bits: u32) -> Result<Unlocked, NodeError> {
    let identity = Identity::generate_with_pow_bits(pow_bits);
    seal_new(paths, identity, passphrase)
}

/// Crée une identité **avec phrase de récupération** : rend l'état
/// déverrouillé et la phrase de 12 mots à faire noter à l'utilisateur
/// (elle n'est stockée nulle part et ne peut pas être ré-affichée).
pub fn create_with_phrase(
    paths: &Paths,
    passphrase: &str,
    pow_bits: u32,
) -> Result<(Unlocked, Zeroizing<String>), NodeError> {
    let (phrase, seed) = accord_crypto::mnemonic::generate();
    let identity = Identity::from_seed_with_pow_bits(seed, pow_bits);
    let unlocked = seal_new(paths, identity, passphrase)?;
    Ok((unlocked, Zeroizing::new(phrase)))
}

/// Restaure une identité depuis sa phrase de récupération et la scelle sous
/// une nouvelle phrase de passe locale.
pub fn restore_from_phrase(
    paths: &Paths,
    phrase: &str,
    passphrase: &str,
    pow_bits: u32,
) -> Result<Unlocked, NodeError> {
    let seed = accord_crypto::mnemonic::restore(phrase)?;
    let identity = Identity::from_seed_with_pow_bits(seed, pow_bits);
    seal_new(paths, identity, passphrase)
}

/// Scelle une identité neuve sur disque (refuse d'écraser un coffre).
fn seal_new(paths: &Paths, identity: Identity, passphrase: &str) -> Result<Unlocked, NodeError> {
    if paths.has_identity() {
        return Err(NodeError::AlreadyExists);
    }
    std::fs::create_dir_all(&paths.root)?;
    let vault = accord_crypto::seal_vault(
        identity.seed(),
        identity.pow_nonce(),
        passphrase.as_bytes(),
        accord_crypto::vault::VaultParams::default(),
    )?;
    write_private(&paths.vault(), &vault)?;
    let db_key = Zeroizing::new(derive_db_key(identity.seed()));
    Ok(Unlocked { identity, db_key })
}

/// Déverrouille l'identité existante avec la phrase de passe.
pub fn unlock(paths: &Paths, passphrase: &str) -> Result<Unlocked, NodeError> {
    let vault = std::fs::read(paths.vault())?;
    let (seed, pow_nonce) = accord_crypto::open_vault(&vault, passphrase.as_bytes())?;
    let identity = Identity::from_seed_and_pow(seed, pow_nonce, 0)?;
    let db_key = Zeroizing::new(derive_db_key(&seed));
    Ok(Unlocked { identity, db_key })
}

/// Écrit un fichier privé (permissions 0600 sur Unix).
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_seals_and_unlock_recovers_same_identity() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path());
        assert!(!paths.has_identity());

        let created = create(&paths, "phrase-de-passe-robuste", 1).unwrap();
        assert!(paths.has_identity());
        let pubkey = created.identity.public_key();
        let db_key = *created.db_key;

        let unlocked = unlock(&paths, "phrase-de-passe-robuste").unwrap();
        assert_eq!(unlocked.identity.public_key(), pubkey);
        assert_eq!(*unlocked.db_key, db_key);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path());
        create(&paths, "correcte", 1).unwrap();
        assert!(unlock(&paths, "incorrecte").is_err());
    }

    #[test]
    fn create_refuses_when_identity_exists() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path());
        create(&paths, "phrase", 1).unwrap();
        assert!(matches!(
            create(&paths, "phrase", 1),
            Err(NodeError::AlreadyExists)
        ));
    }

    #[test]
    fn recovery_phrase_restores_the_same_identity() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path());
        let (created, phrase) = create_with_phrase(&paths, "phrase-de-passe", 1).unwrap();
        assert_eq!(phrase.split_whitespace().count(), 12);

        // Restauration sur un profil vierge : même identité, même clé de base.
        let dir2 = tempfile::tempdir().unwrap();
        let paths2 = Paths::new(dir2.path());
        let restored = restore_from_phrase(&paths2, &phrase, "autre-passe", 1).unwrap();
        assert_eq!(
            restored.identity.public_key(),
            created.identity.public_key()
        );
        assert_eq!(*restored.db_key, *created.db_key);

        // Une phrase invalide est refusée.
        assert!(restore_from_phrase(
            &Paths::new(dir2.path().join("x")),
            "pas une phrase valide du tout",
            "p",
            1
        )
        .is_err());
    }
}
