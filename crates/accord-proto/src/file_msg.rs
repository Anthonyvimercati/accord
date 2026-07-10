//! Canal FILE (0x04) : transfert de fichiers fragmentés (SPEC §9).

use crate::limits;
use crate::wire::{DecodeError, Reader, WireDecode, WireEncode, Writer};

const MAX_NAME: usize = 256;
/// Nombre maximal de feuilles d'un manifest (2 GiB / 256 KiB = 8192).
const MAX_LEAVES: usize = 8192;

/// Manifest signé décrivant un fichier partagé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    /// Racine de l'arbre de Merkle (identifiant du fichier).
    pub merkle_root: [u8; 32],
    /// Taille exacte du fichier en octets.
    pub size: u64,
    /// Nom de fichier proposé.
    pub name: String,
    /// Type MIME déclaré.
    pub mime: String,
    /// Hash SHA-256 de chaque bloc de 256 KiB, dans l'ordre.
    pub leaf_hashes: Vec<[u8; 32]>,
    /// Clé publique Ed25519 du publieur.
    pub publisher: [u8; 32],
    /// Signature Ed25519 sur [`Manifest::signable_bytes`].
    pub sig: [u8; 64],
}

impl Manifest {
    /// Octets couverts par la signature du manifest.
    pub fn signable_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(64 + self.leaf_hashes.len() * 32);
        w.put_raw(b"accord-manifest-v1");
        w.put_arr(&self.merkle_root);
        w.put_u64(self.size);
        w.put_str(&self.name);
        w.put_str(&self.mime);
        w.put_list(&self.leaf_hashes, |w, h| w.put_arr(h));
        w.into_bytes()
    }
}

impl WireEncode for Manifest {
    fn encode(&self, w: &mut Writer) {
        w.put_arr(&self.merkle_root);
        w.put_u64(self.size);
        w.put_str(&self.name);
        w.put_str(&self.mime);
        w.put_list(&self.leaf_hashes, |w, h| w.put_arr(h));
        w.put_arr(&self.publisher);
        w.put_arr(&self.sig);
    }
}

impl WireDecode for Manifest {
    fn decode(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let merkle_root = r.arr()?;
        let size = r.u64()?;
        if size == 0 || size > limits::MAX_FILE_SIZE {
            return Err(DecodeError::TooLarge("manifest.size"));
        }
        let name = r.str(MAX_NAME, "manifest.name")?;
        let mime = r.str(MAX_NAME, "manifest.mime")?;
        let leaf_hashes = r.list(MAX_LEAVES, "manifest.leaves", |r| r.arr())?;
        let expected = size.div_ceil(limits::FILE_BLOCK_SIZE as u64) as usize;
        if leaf_hashes.len() != expected {
            return Err(DecodeError::InvalidValue("manifest.leaf_count"));
        }
        Ok(Manifest {
            merkle_root,
            size,
            name,
            mime,
            leaf_hashes,
            publisher: r.arr()?,
            sig: r.arr()?,
        })
    }
}

/// Message du canal FILE.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileMsg {
    /// 0x01 — Demande du manifest d'un fichier.
    GetManifest {
        /// Racine Merkle du fichier.
        root: [u8; 32],
    },
    /// 0x02 — Manifest signé.
    ManifestMsg {
        /// Manifest complet.
        manifest: Manifest,
    },
    /// 0x03 — Demande d'un bloc.
    GetBlock {
        /// Racine Merkle du fichier.
        root: [u8; 32],
        /// Index du bloc (données 0..n, parité n..n+p).
        index: u32,
    },
    /// 0x04 — Contenu d'un bloc.
    Block {
        /// Racine Merkle du fichier.
        root: [u8; 32],
        /// Index du bloc.
        index: u32,
        /// Données (≤ 256 KiB).
        data: Vec<u8>,
    },
    /// 0x05 — Bitmap des blocs détenus (1 bit par bloc).
    Have {
        /// Racine Merkle du fichier.
        root: [u8; 32],
        /// Bitmap little-endian par octet, bit i = bloc i détenu.
        bitmap: Vec<u8>,
    },
    /// 0x06 — Bloc introuvable ou refusé.
    NotFound {
        /// Racine Merkle du fichier.
        root: [u8; 32],
        /// Index demandé.
        index: u32,
    },
}

impl WireEncode for FileMsg {
    fn encode(&self, w: &mut Writer) {
        match self {
            FileMsg::GetManifest { root } => {
                w.put_u8(0x01);
                w.put_arr(root);
            }
            FileMsg::ManifestMsg { manifest } => {
                w.put_u8(0x02);
                manifest.encode(w);
            }
            FileMsg::GetBlock { root, index } => {
                w.put_u8(0x03);
                w.put_arr(root);
                w.put_u32(*index);
            }
            FileMsg::Block { root, index, data } => {
                w.put_u8(0x04);
                w.put_arr(root);
                w.put_u32(*index);
                w.put_lbytes(data);
            }
            FileMsg::Have { root, bitmap } => {
                w.put_u8(0x05);
                w.put_arr(root);
                w.put_lbytes(bitmap);
            }
            FileMsg::NotFound { root, index } => {
                w.put_u8(0x06);
                w.put_arr(root);
                w.put_u32(*index);
            }
        }
    }
}

impl WireDecode for FileMsg {
    fn decode(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        match r.u8()? {
            0x01 => Ok(FileMsg::GetManifest { root: r.arr()? }),
            0x02 => Ok(FileMsg::ManifestMsg {
                manifest: Manifest::decode(r)?,
            }),
            0x03 => Ok(FileMsg::GetBlock {
                root: r.arr()?,
                index: r.u32()?,
            }),
            0x04 => Ok(FileMsg::Block {
                root: r.arr()?,
                index: r.u32()?,
                data: r.lbytes(limits::FILE_BLOCK_SIZE, "block.data")?,
            }),
            0x05 => Ok(FileMsg::Have {
                root: r.arr()?,
                bitmap: r.lbytes(MAX_LEAVES / 8 + 1, "have.bitmap")?,
            }),
            0x06 => Ok(FileMsg::NotFound {
                root: r.arr()?,
                index: r.u32()?,
            }),
            _ => Err(DecodeError::InvalidValue("file kind")),
        }
    }
}
