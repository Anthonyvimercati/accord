//! Index de recherche aveugle : jetons HMACés → identifiants de messages.
//! La base ne stocke jamais les mots en clair ; la tokenisation et le HMAC
//! relèvent de [`crate::search`].

use super::{blob, Db};
use crate::error::CoreError;
use rusqlite::params;

impl Db {
    /// Indexe des jetons (déjà HMACés) pour un message.
    pub fn index_tokens(&self, msg_id: &[u8; 16], tokens: &[[u8; 32]]) -> Result<(), CoreError> {
        let mut stmt = self
            .conn()
            .prepare("INSERT OR IGNORE INTO search_index (token, msg_id) VALUES (?1, ?2)")?;
        for token in tokens {
            stmt.execute(params![token, msg_id])?;
        }
        Ok(())
    }

    /// Messages contenant TOUS les jetons donnés (intersection).
    pub fn search_tokens(&self, tokens: &[[u8; 32]]) -> Result<Vec<[u8; 16]>, CoreError> {
        let Some((first, rest)) = tokens.split_first() else {
            return Ok(Vec::new());
        };
        let mut stmt = self
            .conn()
            .prepare("SELECT msg_id FROM search_index WHERE token = ?1")?;
        let raws = stmt
            .query_map([first.as_slice()], |row| row.get::<_, Vec<u8>>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let mut ids: Vec<[u8; 16]> = raws.into_iter().map(blob).collect::<Result<Vec<_>, _>>()?;
        for token in rest {
            let mut keep = Vec::with_capacity(ids.len());
            let mut check = self
                .conn()
                .prepare("SELECT 1 FROM search_index WHERE token = ?1 AND msg_id = ?2")?;
            for id in ids {
                if check.exists(params![token, id])? {
                    keep.push(id);
                }
            }
            ids = keep;
            if ids.is_empty() {
                break;
            }
        }
        Ok(ids)
    }

    /// Désindexe un message (suppression/tombstone).
    pub fn unindex_msg(&self, msg_id: &[u8; 16]) -> Result<(), CoreError> {
        self.conn().execute(
            "DELETE FROM search_index WHERE msg_id = ?1",
            [msg_id.as_slice()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intersection_search_and_unindex() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        db.index_tokens(&[1; 16], &[[10; 32], [11; 32]]).unwrap();
        db.index_tokens(&[2; 16], &[[10; 32]]).unwrap();
        db.index_tokens(&[1; 16], &[[10; 32]]).unwrap(); // idempotent

        assert_eq!(db.search_tokens(&[[10; 32]]).unwrap().len(), 2);
        assert_eq!(
            db.search_tokens(&[[10; 32], [11; 32]]).unwrap(),
            vec![[1; 16]]
        );
        assert!(db.search_tokens(&[[12; 32]]).unwrap().is_empty());
        assert!(db.search_tokens(&[]).unwrap().is_empty());

        db.unindex_msg(&[1; 16]).unwrap();
        assert!(db.search_tokens(&[[11; 32]]).unwrap().is_empty());
        assert_eq!(db.search_tokens(&[[10; 32]]).unwrap(), vec![[2; 16]]);
    }
}
