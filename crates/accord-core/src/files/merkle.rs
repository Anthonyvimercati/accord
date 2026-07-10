//! Arbre de Merkle des fichiers partagés (SPEC §9).
//!
//! Feuilles = SHA-256 de chaque bloc de 256 KiB ; nœud interne =
//! SHA-256(gauche ‖ droite) ; un dernier nœud impair est dupliqué. La racine
//! identifie le fichier sur tout le réseau.

use accord_crypto::Identity;
use accord_proto::file_msg::Manifest;
use accord_proto::limits::{FILE_BLOCK_SIZE, MAX_FILE_SIZE};
use sha2::{Digest, Sha256};

use crate::error::CoreError;

/// Nombre de blocs de données d'un fichier.
pub fn block_count(size: u64) -> usize {
    size.div_ceil(FILE_BLOCK_SIZE as u64) as usize
}

/// Hash d'un bloc (feuille de l'arbre).
pub fn block_hash(block: &[u8]) -> [u8; 32] {
    Sha256::digest(block).into()
}

/// Hashes de tous les blocs d'un contenu.
pub fn leaf_hashes(data: &[u8]) -> Vec<[u8; 32]> {
    data.chunks(FILE_BLOCK_SIZE).map(block_hash).collect()
}

/// Racine de Merkle d'une liste de feuilles (au moins une).
pub fn merkle_root(leaves: &[[u8; 32]]) -> Result<[u8; 32], CoreError> {
    if leaves.is_empty() {
        return Err(CoreError::Invalid("fichier vide"));
    }
    let mut level: Vec<[u8; 32]> = leaves.to_vec();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        for pair in level.chunks(2) {
            let right = pair.get(1).unwrap_or(&pair[0]); // impair : dupliqué
            let mut h = Sha256::new();
            h.update(pair[0]);
            h.update(right);
            next.push(h.finalize().into());
        }
        level = next;
    }
    Ok(level[0])
}

/// Vérifie qu'un bloc correspond à sa feuille du manifest.
pub fn verify_block(expected_leaf: &[u8; 32], block: &[u8]) -> bool {
    block_hash(block) == *expected_leaf
}

/// Construit et signe le manifest d'un contenu complet.
pub fn build_manifest(
    publisher: &Identity,
    data: &[u8],
    name: &str,
    mime: &str,
) -> Result<Manifest, CoreError> {
    if data.is_empty() || data.len() as u64 > MAX_FILE_SIZE {
        return Err(CoreError::Invalid("taille de fichier hors bornes"));
    }
    let leaves = leaf_hashes(data);
    let mut manifest = Manifest {
        merkle_root: merkle_root(&leaves)?,
        size: data.len() as u64,
        name: name.to_string(),
        mime: mime.to_string(),
        leaf_hashes: leaves,
        publisher: publisher.public_key(),
        sig: [0u8; 64],
    };
    manifest.sig = publisher.sign(&manifest.signable_bytes());
    Ok(manifest)
}

/// Vérifie la cohérence interne et la signature d'un manifest reçu :
/// bornes de taille, nombre de feuilles, racine recalculée, signature.
pub fn verify_manifest(manifest: &Manifest) -> Result<(), CoreError> {
    if manifest.size == 0 || manifest.size > MAX_FILE_SIZE {
        return Err(CoreError::Invalid("taille de manifest hors bornes"));
    }
    if manifest.leaf_hashes.len() != block_count(manifest.size) {
        return Err(CoreError::Invalid("nombre de feuilles incohérent"));
    }
    if merkle_root(&manifest.leaf_hashes)? != manifest.merkle_root {
        return Err(CoreError::Invalid("racine de Merkle incohérente"));
    }
    accord_crypto::verify_signature(
        &manifest.publisher,
        &manifest.signable_bytes(),
        &manifest.sig,
    )?;
    Ok(())
}

/// Taille réelle du bloc `index` d'un fichier de `size` octets.
pub fn block_len(size: u64, index: usize) -> usize {
    let count = block_count(size);
    if index + 1 < count {
        FILE_BLOCK_SIZE
    } else if index + 1 == count {
        (size as usize) - (count - 1) * FILE_BLOCK_SIZE
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_is_deterministic_and_content_sensitive() {
        let data = vec![7u8; FILE_BLOCK_SIZE * 2 + 100];
        let leaves = leaf_hashes(&data);
        assert_eq!(leaves.len(), 3);
        let root = merkle_root(&leaves).unwrap();
        assert_eq!(merkle_root(&leaves).unwrap(), root);

        let mut altered = data.clone();
        altered[FILE_BLOCK_SIZE] ^= 1;
        assert_ne!(merkle_root(&leaf_hashes(&altered)).unwrap(), root);
    }

    #[test]
    fn single_block_root_is_its_leaf() {
        let data = b"petit fichier".to_vec();
        let leaves = leaf_hashes(&data);
        assert_eq!(merkle_root(&leaves).unwrap(), leaves[0]);
    }

    #[test]
    fn manifest_roundtrips_and_detects_tampering() {
        let publisher = Identity::generate_with_pow_bits(1);
        let data = vec![3u8; FILE_BLOCK_SIZE + 5];
        let manifest = build_manifest(&publisher, &data, "doc.pdf", "application/pdf").unwrap();
        verify_manifest(&manifest).unwrap();

        let mut bad_leaf = manifest.clone();
        bad_leaf.leaf_hashes[0][0] ^= 1;
        assert!(verify_manifest(&bad_leaf).is_err());

        let mut bad_size = manifest.clone();
        bad_size.size += 1;
        assert!(verify_manifest(&bad_size).is_err());

        let mut bad_sig = manifest;
        bad_sig.sig[0] ^= 1;
        assert!(verify_manifest(&bad_sig).is_err());
    }

    #[test]
    fn block_len_covers_tail() {
        let size = (FILE_BLOCK_SIZE * 2 + 10) as u64;
        assert_eq!(block_len(size, 0), FILE_BLOCK_SIZE);
        assert_eq!(block_len(size, 1), FILE_BLOCK_SIZE);
        assert_eq!(block_len(size, 2), 10);
        assert_eq!(block_len(size, 3), 0);
    }
}
