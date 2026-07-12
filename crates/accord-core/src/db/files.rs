//! Persistance des fichiers partagés : manifests, bitmaps de reprise,
//! quota de stockage offert avec éviction LRU (SPEC §9).

use super::{blob, Db};
use crate::error::CoreError;
use crate::files::fetch;
use rusqlite::params;

/// Intention de téléchargement persistée : racine de Merkle, indice de pair
/// source éventuel et état de reprise après abandon (backoff par racine).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchIntent {
    /// Racine de Merkle du fichier voulu.
    pub merkle_root: [u8; 32],
    /// Pair source probable (expéditeur du message portant la référence).
    pub hint: Option<[u8; 32]>,
    /// Prochaine adoption au plus tôt (ms murales ; 0 = immédiate).
    pub next_attempt_ms: u64,
    /// Abandons successifs sans complétion (échelle de backoff).
    pub attempts: u32,
}

/// Fichier connu localement (partagé par nous ou en téléchargement).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    /// Racine de Merkle (identifiant du fichier).
    pub merkle_root: [u8; 32],
    /// Nom proposé.
    pub name: String,
    /// Taille totale (octets).
    pub size: u64,
    /// Type MIME déclaré.
    pub mime: String,
    /// Manifest signé encodé.
    pub manifest: Vec<u8>,
    /// Chemin local du contenu, si matérialisé.
    pub path: Option<String>,
    /// Bitmap des blocs détenus (1 bit par bloc).
    pub bitmap: Vec<u8>,
    /// Téléchargement terminé et vérifié.
    pub complete: bool,
    /// Date d'ajout (ms) — sert d'ordre LRU d'éviction.
    pub added_ms: u64,
}

/// Colonnes brutes d'un fichier, avant validation de la racine Merkle.
type RawFileEntry = (
    Vec<u8>,
    String,
    u64,
    String,
    Vec<u8>,
    Option<String>,
    Vec<u8>,
    bool,
    u64,
);

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawFileEntry> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
    ))
}

fn build(r: RawFileEntry) -> Result<FileEntry, CoreError> {
    Ok(FileEntry {
        merkle_root: blob(r.0)?,
        name: r.1,
        size: r.2,
        mime: r.3,
        manifest: r.4,
        path: r.5,
        bitmap: r.6,
        complete: r.7,
        added_ms: r.8,
    })
}

const COLS: &str = "merkle_root, name, size, mime, manifest, path, bitmap, complete, added_ms";

impl Db {
    /// Enregistre ou met à jour un fichier.
    pub fn upsert_file(&self, f: &FileEntry) -> Result<(), CoreError> {
        self.conn().execute(
            "INSERT INTO files (merkle_root, name, size, mime, manifest, path, bitmap, complete, added_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(merkle_root) DO UPDATE SET
               path = excluded.path, bitmap = excluded.bitmap, complete = excluded.complete",
            params![
                f.merkle_root,
                f.name,
                f.size,
                f.mime,
                f.manifest,
                f.path,
                f.bitmap,
                f.complete,
                f.added_ms
            ],
        )?;
        Ok(())
    }

    /// Fichier par racine de Merkle.
    pub fn file(&self, merkle_root: &[u8; 32]) -> Result<Option<FileEntry>, CoreError> {
        let mut stmt = self
            .conn()
            .prepare(&format!("SELECT {COLS} FROM files WHERE merkle_root = ?1"))?;
        let mut rows = stmt.query([merkle_root.as_slice()])?;
        match rows.next()? {
            Some(row) => Ok(Some(build(row_to_entry(row)?)?)),
            None => Ok(None),
        }
    }

    /// Tous les fichiers connus, plus récents d'abord.
    pub fn files(&self) -> Result<Vec<FileEntry>, CoreError> {
        let mut stmt = self
            .conn()
            .prepare(&format!("SELECT {COLS} FROM files ORDER BY added_ms DESC"))?;
        let raws = stmt
            .query_map([], row_to_entry)?
            .collect::<Result<Vec<_>, _>>()?;
        raws.into_iter().map(build).collect()
    }

    /// Met à jour la bitmap de reprise (et l'état de complétude).
    pub fn set_file_progress(
        &self,
        merkle_root: &[u8; 32],
        bitmap: &[u8],
        complete: bool,
    ) -> Result<(), CoreError> {
        let n = self.conn().execute(
            "UPDATE files SET bitmap = ?2, complete = ?3 WHERE merkle_root = ?1",
            params![merkle_root, bitmap, complete],
        )?;
        if n == 0 {
            return Err(CoreError::NotFound("fichier"));
        }
        Ok(())
    }

    /// Supprime un fichier de l'index local.
    pub fn remove_file(&self, merkle_root: &[u8; 32]) -> Result<(), CoreError> {
        self.conn().execute(
            "DELETE FROM files WHERE merkle_root = ?1",
            [merkle_root.as_slice()],
        )?;
        Ok(())
    }

    /// Taille cumulée des fichiers complets détenus (quota offert).
    pub fn files_total_size(&self) -> Result<u64, CoreError> {
        Ok(self.conn().query_row(
            "SELECT COALESCE(SUM(size), 0) FROM files WHERE complete = 1",
            [],
            |row| row.get(0),
        )?)
    }

    /// Dossier du magasin de blobs : `fichiers/` à côté de la base, donc dans
    /// le répertoire de profil du nœud. Indisponible pour une base en mémoire.
    pub fn files_dir(&self) -> Result<std::path::PathBuf, CoreError> {
        let conn = self.conn();
        let path = conn
            .path()
            .filter(|p| !p.is_empty())
            .ok_or(CoreError::Invalid(
                "base sans chemin : magasin de fichiers indisponible",
            ))?;
        let parent = std::path::Path::new(path)
            .parent()
            .ok_or(CoreError::Invalid("chemin de base sans dossier parent"))?;
        Ok(parent.join("fichiers"))
    }

    // ---- Intentions de téléchargement (reprises par la boucle réseau) ----

    /// Enregistre (ou rafraîchit) une intention de téléchargement ; un indice
    /// plus récent remplace l'ancien, un indice absent le conserve. Une
    /// demande fraîche réarme aussi le backoff (relance immédiate) : elle
    /// signale que quelqu'un veut le fichier maintenant.
    pub fn upsert_file_fetch(
        &self,
        merkle_root: &[u8; 32],
        hint: Option<&[u8; 32]>,
        now_ms: u64,
    ) -> Result<(), CoreError> {
        self.conn().execute(
            "INSERT INTO file_fetches (merkle_root, hint, added_ms) VALUES (?1, ?2, ?3)
             ON CONFLICT(merkle_root) DO UPDATE SET
               hint = COALESCE(excluded.hint, hint),
               next_attempt_ms = 0,
               attempts = 0",
            params![merkle_root, hint.map(|h| h.as_slice()), now_ms],
        )?;
        Ok(())
    }

    /// Intentions de téléchargement en attente, plus anciennes d'abord.
    pub fn file_fetches(&self) -> Result<Vec<FetchIntent>, CoreError> {
        let mut stmt = self.conn().prepare(
            "SELECT merkle_root, hint, next_attempt_ms, attempts
             FROM file_fetches ORDER BY added_ms ASC",
        )?;
        let raws = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u32>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        raws.into_iter()
            .map(|(root, hint, next_attempt_ms, attempts)| {
                Ok(FetchIntent {
                    merkle_root: blob(root)?,
                    hint: hint.map(blob).transpose()?,
                    next_attempt_ms,
                    attempts,
                })
            })
            .collect()
    }

    /// Reporte une intention après un abandon : incrémente le compteur et
    /// planifie la prochaine adoption selon l'échelle
    /// [`fetch::relance_apres_abandon_ms`]. L'intention n'est JAMAIS
    /// supprimée ici (elle ne l'est qu'à la complétion ou sur annulation
    /// explicite) ; sans effet si elle a déjà été soldée.
    pub fn defer_file_fetch(&self, merkle_root: &[u8; 32], now_ms: u64) -> Result<(), CoreError> {
        let mut stmt = self
            .conn()
            .prepare("SELECT attempts FROM file_fetches WHERE merkle_root = ?1")?;
        let mut rows = stmt.query([merkle_root.as_slice()])?;
        let Some(row) = rows.next()? else {
            return Ok(());
        };
        let tentatives: u32 = row.get::<_, u32>(0)?.saturating_add(1);
        let prochaine = now_ms.saturating_add(fetch::relance_apres_abandon_ms(tentatives));
        self.conn().execute(
            "UPDATE file_fetches SET attempts = ?2, next_attempt_ms = ?3
             WHERE merkle_root = ?1",
            params![merkle_root, tentatives, prochaine],
        )?;
        Ok(())
    }

    /// Réarme les intentions dont l'indice est `hint` (pair reconnecté) :
    /// relance immédiate, backoff remis à zéro. Rend le nombre d'intentions
    /// réarmées.
    pub fn retry_file_fetches_hinted(&self, hint: &[u8; 32]) -> Result<usize, CoreError> {
        Ok(self.conn().execute(
            "UPDATE file_fetches SET next_attempt_ms = 0, attempts = 0 WHERE hint = ?1",
            [hint.as_slice()],
        )?)
    }

    /// Solde une intention de téléchargement (terminée ou abandonnée).
    pub fn remove_file_fetch(&self, merkle_root: &[u8; 32]) -> Result<(), CoreError> {
        self.conn().execute(
            "DELETE FROM file_fetches WHERE merkle_root = ?1",
            [merkle_root.as_slice()],
        )?;
        Ok(())
    }

    /// Candidats à l'éviction LRU pour ramener le total sous `quota_bytes` :
    /// fichiers complets les plus anciens d'abord.
    pub fn files_eviction_candidates(&self, quota_bytes: u64) -> Result<Vec<[u8; 32]>, CoreError> {
        let mut total = self.files_total_size()?;
        if total <= quota_bytes {
            return Ok(Vec::new());
        }
        let mut stmt = self.conn().prepare(
            "SELECT merkle_root, size FROM files WHERE complete = 1 ORDER BY added_ms ASC",
        )?;
        let raws = stmt
            .query_map([], |row| {
                Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, u64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut victims = Vec::new();
        for (root, size) in raws {
            if total <= quota_bytes {
                break;
            }
            total = total.saturating_sub(size);
            victims.push(blob(root)?);
        }
        Ok(victims)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u8, size: u64, added_ms: u64, complete: bool) -> FileEntry {
        FileEntry {
            merkle_root: [id; 32],
            name: format!("f{id}"),
            size,
            mime: "application/octet-stream".into(),
            manifest: vec![id],
            path: None,
            bitmap: vec![0xFF],
            complete,
            added_ms,
        }
    }

    #[test]
    fn upsert_fetch_and_progress() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        let f = entry(1, 100, 10, false);
        db.upsert_file(&f).unwrap();
        assert_eq!(db.file(&[1; 32]).unwrap(), Some(f));
        db.set_file_progress(&[1; 32], &[0x0F], true).unwrap();
        let got = db.file(&[1; 32]).unwrap().unwrap();
        assert!(got.complete);
        assert_eq!(got.bitmap, vec![0x0F]);
        assert!(matches!(
            db.set_file_progress(&[9; 32], &[], false),
            Err(CoreError::NotFound(_))
        ));
    }

    /// Intention neuve attendue : relance immédiate, aucun abandon compté.
    fn intent(merkle_root: [u8; 32], hint: Option<[u8; 32]>) -> FetchIntent {
        FetchIntent {
            merkle_root,
            hint,
            next_attempt_ms: 0,
            attempts: 0,
        }
    }

    #[test]
    fn fetch_intents_roundtrip_and_hint_refresh() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        assert!(db.file_fetches().unwrap().is_empty());
        db.upsert_file_fetch(&[1; 32], None, 10).unwrap();
        db.upsert_file_fetch(&[2; 32], Some(&[9; 32]), 20).unwrap();
        assert_eq!(
            db.file_fetches().unwrap(),
            vec![intent([1; 32], None), intent([2; 32], Some([9; 32]))]
        );
        // Un indice arrivé plus tard complète l'intention…
        db.upsert_file_fetch(&[1; 32], Some(&[8; 32]), 30).unwrap();
        // … mais un indice absent ne l'efface pas.
        db.upsert_file_fetch(&[2; 32], None, 40).unwrap();
        assert_eq!(
            db.file_fetches().unwrap(),
            vec![
                intent([1; 32], Some([8; 32])),
                intent([2; 32], Some([9; 32]))
            ]
        );
        db.remove_file_fetch(&[1; 32]).unwrap();
        assert_eq!(db.file_fetches().unwrap().len(), 1);
    }

    #[test]
    fn abandon_reporte_l_intention_selon_le_bareme_sans_la_supprimer() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        db.upsert_file_fetch(&[1; 32], Some(&[9; 32]), 10).unwrap();
        // Abandons successifs : l'intention survit, le backoff suit l'échelle.
        for (tentatives, attendu) in [
            (1u32, 60_000u64),
            (2, 120_000),
            (3, 300_000),
            (4, 900_000),
            (5, 1_800_000),
            (6, 1_800_000),
        ] {
            db.defer_file_fetch(&[1; 32], 1_000).unwrap();
            let got = &db.file_fetches().unwrap()[0];
            assert_eq!(got.attempts, tentatives);
            assert_eq!(got.next_attempt_ms, 1_000 + attendu);
            assert_eq!(got.hint, Some([9; 32]), "l'indice est conservé");
        }
        // Reporter une intention déjà soldée : sans effet ni erreur.
        db.remove_file_fetch(&[1; 32]).unwrap();
        db.defer_file_fetch(&[1; 32], 2_000).unwrap();
        assert!(db.file_fetches().unwrap().is_empty());
    }

    #[test]
    fn reconnexion_du_pair_indice_rearme_les_intentions_en_backoff() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        db.upsert_file_fetch(&[1; 32], Some(&[9; 32]), 10).unwrap();
        db.upsert_file_fetch(&[2; 32], Some(&[7; 32]), 20).unwrap();
        db.defer_file_fetch(&[1; 32], 1_000).unwrap();
        db.defer_file_fetch(&[2; 32], 1_000).unwrap();
        // Seules les intentions indicées sur CE pair sont réarmées.
        assert_eq!(db.retry_file_fetches_hinted(&[9; 32]).unwrap(), 1);
        let intents = db.file_fetches().unwrap();
        assert_eq!(intents[0], intent([1; 32], Some([9; 32])));
        assert!(intents[1].next_attempt_ms > 0, "l'autre reste en backoff");
        // Une demande fraîche (files_fetch) réarme aussi le backoff.
        db.upsert_file_fetch(&[2; 32], None, 30).unwrap();
        assert_eq!(
            db.file_fetches().unwrap()[1],
            intent([2; 32], Some([7; 32]))
        );
    }

    #[test]
    fn files_dir_lives_next_to_db_and_rejects_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("accord.db");
        let db = Db::open(&path, &[1; 32]).unwrap();
        // SQLite canonicalise le chemin (symlinks /var → /private/var sur
        // macOS) : on compare les formes canoniques.
        let attendu = dir.path().canonicalize().unwrap().join("fichiers");
        assert_eq!(db.files_dir().unwrap(), attendu);
        let mem = Db::open_in_memory(&[1; 32]).unwrap();
        assert!(mem.files_dir().is_err());
    }

    #[test]
    fn lru_eviction_frees_oldest_first() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        db.upsert_file(&entry(1, 500, 10, true)).unwrap();
        db.upsert_file(&entry(2, 500, 20, true)).unwrap();
        db.upsert_file(&entry(3, 500, 30, true)).unwrap();
        db.upsert_file(&entry(4, 500, 5, false)).unwrap(); // incomplet : jamais évincé
        assert_eq!(db.files_total_size().unwrap(), 1500);
        let victims = db.files_eviction_candidates(1000).unwrap();
        assert_eq!(victims, vec![[1; 32]]);
        let victims = db.files_eviction_candidates(400).unwrap();
        assert_eq!(victims, vec![[1; 32], [2; 32], [3; 32]]);
        assert!(db.files_eviction_candidates(2000).unwrap().is_empty());
    }
}
