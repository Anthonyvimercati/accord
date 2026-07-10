//! Correction d'effacements Reed-Solomon 10+4 (SPEC §9, D-014).
//!
//! Les blocs de données sont regroupés par 10 ; chaque groupe produit 4 blocs
//! de parité GF(2^8). Un groupe se reconstruit dès que 10 de ses 14 parts
//! sont disponibles. Le dernier groupe, incomplet, est complété par des blocs
//! virtuels nuls ; toutes les parts d'un groupe sont ramenées à la taille du
//! plus grand bloc réel du groupe (les parts courtes sont bourrées de zéros
//! puis retaillées après reconstruction).

use reed_solomon_erasure::galois_8::ReedSolomon;

use crate::error::CoreError;

/// Blocs de données par groupe.
pub const RS_DATA: usize = 10;
/// Blocs de parité par groupe.
pub const RS_PARITY: usize = 4;

/// Nombre de groupes Reed-Solomon d'un fichier de `block_count` blocs.
pub fn group_count(block_count: usize) -> usize {
    block_count.div_ceil(RS_DATA)
}

/// Index global (données 0..n, parité n..n+p) du bloc de parité `j` du
/// groupe `g` d'un fichier de `block_count` blocs de données.
pub fn parity_index(block_count: usize, group: usize, j: usize) -> u32 {
    (block_count + group * RS_PARITY + j) as u32
}

/// Groupe et taille de part d'une liste de blocs réels (≤ 10).
fn shard_len(blocks: &[&[u8]]) -> usize {
    blocks.iter().map(|b| b.len()).max().unwrap_or(0)
}

fn coder() -> Result<ReedSolomon, CoreError> {
    ReedSolomon::new(RS_DATA, RS_PARITY).map_err(|e| CoreError::Fec(e.to_string()))
}

/// Calcule les 4 blocs de parité d'un groupe (1 à 10 blocs de données).
pub fn parity_for_group(blocks: &[&[u8]]) -> Result<Vec<Vec<u8>>, CoreError> {
    if blocks.is_empty() || blocks.len() > RS_DATA {
        return Err(CoreError::Fec("groupe de 1 à 10 blocs requis".into()));
    }
    let len = shard_len(blocks);
    if len == 0 {
        return Err(CoreError::Fec("groupe vide".into()));
    }
    let mut shards: Vec<Vec<u8>> = Vec::with_capacity(RS_DATA + RS_PARITY);
    for i in 0..RS_DATA {
        let mut shard = vec![0u8; len];
        if let Some(b) = blocks.get(i) {
            shard[..b.len()].copy_from_slice(b);
        }
        shards.push(shard);
    }
    shards.extend(std::iter::repeat_with(|| vec![0u8; len]).take(RS_PARITY));
    coder()?
        .encode(&mut shards)
        .map_err(|e| CoreError::Fec(e.to_string()))?;
    Ok(shards.split_off(RS_DATA))
}

/// Reconstruit les blocs de données manquants d'un groupe.
///
/// `sizes` : tailles réelles des blocs de données du groupe (1 à 10 entrées).
/// `shards` : les 14 parts dans l'ordre (données puis parité), `None` pour
/// les manquantes ; les parts de données présentes sont aux tailles réelles.
/// Rend les blocs de données du groupe, retaillés, dans l'ordre.
pub fn reconstruct_group(
    sizes: &[usize],
    shards: &[Option<Vec<u8>>],
) -> Result<Vec<Vec<u8>>, CoreError> {
    if sizes.is_empty() || sizes.len() > RS_DATA {
        return Err(CoreError::Fec("groupe de 1 à 10 blocs requis".into()));
    }
    if shards.len() != RS_DATA + RS_PARITY {
        return Err(CoreError::Fec("14 parts attendues".into()));
    }
    let len = shards
        .iter()
        .flatten()
        .map(|s| s.len())
        .max()
        .ok_or_else(|| CoreError::Fec("aucune part disponible".into()))?;

    let mut work: Vec<Option<Vec<u8>>> = Vec::with_capacity(RS_DATA + RS_PARITY);
    for (i, shard) in shards.iter().enumerate() {
        match shard {
            Some(bytes) => {
                if bytes.len() > len {
                    return Err(CoreError::Fec("part plus longue que le groupe".into()));
                }
                let mut padded = vec![0u8; len];
                padded[..bytes.len()].copy_from_slice(bytes);
                work.push(Some(padded));
            }
            // Bloc virtuel d'un groupe incomplet : connu, entièrement nul.
            None if i < RS_DATA && i >= sizes.len() => work.push(Some(vec![0u8; len])),
            None => work.push(None),
        }
    }
    coder()?
        .reconstruct(&mut work)
        .map_err(|e| CoreError::Fec(e.to_string()))?;

    let mut out = Vec::with_capacity(sizes.len());
    for (i, &size) in sizes.iter().enumerate() {
        let shard = work[i]
            .take()
            .ok_or_else(|| CoreError::Fec("reconstruction incomplète".into()))?;
        if size > shard.len() {
            return Err(CoreError::Fec("taille de bloc incohérente".into()));
        }
        out.push(shard[..size].to_vec());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocks(sizes: &[usize]) -> Vec<Vec<u8>> {
        sizes
            .iter()
            .enumerate()
            .map(|(i, &s)| vec![(i + 1) as u8; s])
            .collect()
    }

    #[test]
    fn full_group_survives_four_losses() {
        let data = blocks(&[100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
        let refs: Vec<&[u8]> = data.iter().map(Vec::as_slice).collect();
        let parity = parity_for_group(&refs).unwrap();
        assert_eq!(parity.len(), RS_PARITY);

        let sizes: Vec<usize> = data.iter().map(Vec::len).collect();
        let mut shards: Vec<Option<Vec<u8>>> = data.iter().cloned().map(Some).collect();
        shards.extend(parity.into_iter().map(Some));
        // Perd 4 blocs de données.
        for i in [0, 3, 7, 9] {
            shards[i] = None;
        }
        let rebuilt = reconstruct_group(&sizes, &shards).unwrap();
        assert_eq!(rebuilt, data);
    }

    #[test]
    fn partial_group_with_uneven_tail_reconstructs() {
        // 3 blocs réels dont un petit dernier.
        let data = blocks(&[200, 200, 37]);
        let refs: Vec<&[u8]> = data.iter().map(Vec::as_slice).collect();
        let parity = parity_for_group(&refs).unwrap();

        let sizes = vec![200, 200, 37];
        let mut shards: Vec<Option<Vec<u8>>> = vec![None; RS_DATA + RS_PARITY];
        // Seuls le bloc 1 et 2 parités : 2 réels + 7 virtuels + 2 parités ≥ 10.
        shards[1] = Some(data[1].clone());
        shards[RS_DATA] = Some(parity[0].clone());
        shards[RS_DATA + 2] = Some(parity[2].clone());
        let rebuilt = reconstruct_group(&sizes, &shards).unwrap();
        assert_eq!(rebuilt, data);
    }

    #[test]
    fn too_many_losses_fail() {
        let data = blocks(&[50; 10]);
        let refs: Vec<&[u8]> = data.iter().map(Vec::as_slice).collect();
        let parity = parity_for_group(&refs).unwrap();
        let sizes: Vec<usize> = data.iter().map(Vec::len).collect();
        let mut shards: Vec<Option<Vec<u8>>> = data.iter().cloned().map(Some).collect();
        shards.extend(parity.into_iter().map(Some));
        for i in [0, 1, 2, 3, 10] {
            shards[i] = None;
        }
        assert!(reconstruct_group(&sizes, &shards).is_err());
    }
}
