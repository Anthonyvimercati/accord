//! Persistance des groupes : op-log répliqué et clés d'époque.

use super::{blob, Db};
use crate::error::CoreError;
use accord_proto::core_msg::GroupOp;
use rusqlite::params;

/// Clé de groupe persistée pour un epoch donné.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredGroupKey {
    /// Epoch de la clé.
    pub key_epoch: u32,
    /// Clé symétrique 32 octets (protégée au repos par SQLCipher).
    pub key: [u8; 32],
}

impl Db {
    /// Insère une opération dans le journal ; `false` si déjà connue.
    /// La validation (signature, permissions) relève de [`crate::group`].
    pub fn insert_group_op(&self, op: &GroupOp) -> Result<bool, CoreError> {
        let n = self.conn().execute(
            "INSERT OR IGNORE INTO group_ops
               (op_id, group_id, lamport, wall_ms, author, kind, body, sig)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                op.op_id,
                op.group_id,
                op.lamport,
                op.wall_ms,
                op.author,
                op.kind,
                op.body,
                op.sig
            ],
        )?;
        Ok(n > 0)
    }

    /// Journal complet d'un groupe dans l'ordre total `(lamport, author)`.
    pub fn group_ops(&self, group_id: &[u8; 16]) -> Result<Vec<GroupOp>, CoreError> {
        let mut stmt = self.conn().prepare(
            "SELECT op_id, group_id, lamport, wall_ms, author, kind, body, sig
             FROM group_ops WHERE group_id = ?1
             ORDER BY lamport ASC, author ASC",
        )?;
        let raws = stmt
            .query_map([group_id.as_slice()], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u64>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                    row.get::<_, u8>(5)?,
                    row.get::<_, Vec<u8>>(6)?,
                    row.get::<_, Vec<u8>>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        raws.into_iter()
            .map(|r| {
                Ok(GroupOp {
                    op_id: blob(r.0)?,
                    group_id: blob(r.1)?,
                    lamport: r.2,
                    wall_ms: r.3,
                    author: blob(r.4)?,
                    kind: r.5,
                    body: r.6,
                    sig: blob::<64>(r.7)?,
                })
            })
            .collect()
    }

    /// Lamport maximal connu et nombre d'ops (pour l'anti-entropie §6.2).
    pub fn group_op_summary(&self, group_id: &[u8; 16]) -> Result<(u64, u64), CoreError> {
        Ok(self.conn().query_row(
            "SELECT COALESCE(MAX(lamport), 0), COUNT(*) FROM group_ops WHERE group_id = ?1",
            [group_id.as_slice()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?)
    }

    /// Ops d'un groupe strictement au-delà d'un lamport (rattrapage pair).
    pub fn group_ops_after(
        &self,
        group_id: &[u8; 16],
        after_lamport: u64,
    ) -> Result<Vec<GroupOp>, CoreError> {
        let all = self.group_ops(group_id)?;
        Ok(all
            .into_iter()
            .filter(|o| o.lamport > after_lamport)
            .collect())
    }

    /// Identifiants de tous les groupes connus.
    pub fn group_ids(&self) -> Result<Vec<[u8; 16]>, CoreError> {
        let mut stmt = self
            .conn()
            .prepare("SELECT DISTINCT group_id FROM group_ops")?;
        let raws = stmt
            .query_map([], |row| row.get::<_, Vec<u8>>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        raws.into_iter().map(blob).collect()
    }

    // ---- Clés d'époque ----

    /// Stocke la clé d'un epoch (idempotent, premier arrivé conservé).
    pub fn put_group_key(
        &self,
        group_id: &[u8; 16],
        key_epoch: u32,
        key: &[u8; 32],
    ) -> Result<(), CoreError> {
        self.conn().execute(
            "INSERT OR IGNORE INTO group_keys (group_id, key_epoch, key) VALUES (?1, ?2, ?3)",
            params![group_id, key_epoch, key],
        )?;
        Ok(())
    }

    /// Clé d'un epoch donné.
    pub fn group_key(
        &self,
        group_id: &[u8; 16],
        key_epoch: u32,
    ) -> Result<Option<[u8; 32]>, CoreError> {
        let mut stmt = self
            .conn()
            .prepare("SELECT key FROM group_keys WHERE group_id = ?1 AND key_epoch = ?2")?;
        let mut rows = stmt.query(params![group_id, key_epoch])?;
        match rows.next()? {
            Some(row) => Ok(Some(blob(row.get::<_, Vec<u8>>(0)?)?)),
            None => Ok(None),
        }
    }

    /// Clé la plus récente d'un groupe (epoch maximal détenu).
    pub fn latest_group_key(
        &self,
        group_id: &[u8; 16],
    ) -> Result<Option<StoredGroupKey>, CoreError> {
        let mut stmt = self.conn().prepare(
            "SELECT key_epoch, key FROM group_keys WHERE group_id = ?1
             ORDER BY key_epoch DESC LIMIT 1",
        )?;
        let mut rows = stmt.query([group_id.as_slice()])?;
        match rows.next()? {
            Some(row) => Ok(Some(StoredGroupKey {
                key_epoch: row.get(0)?,
                key: blob(row.get::<_, Vec<u8>>(1)?)?,
            })),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(id: u8, lamport: u64, author: u8) -> GroupOp {
        GroupOp {
            op_id: [id; 16],
            group_id: [1; 16],
            lamport,
            wall_ms: 0,
            author: [author; 32],
            kind: 0x01,
            body: vec![],
            sig: [0; 64],
        }
    }

    #[test]
    fn oplog_orders_by_lamport_then_author() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        assert!(db.insert_group_op(&op(1, 5, 9)).unwrap());
        assert!(db.insert_group_op(&op(2, 5, 3)).unwrap());
        assert!(db.insert_group_op(&op(3, 1, 9)).unwrap());
        assert!(!db.insert_group_op(&op(1, 5, 9)).unwrap(), "doublon");
        let ops = db.group_ops(&[1; 16]).unwrap();
        assert_eq!(
            ops.iter().map(|o| o.op_id[0]).collect::<Vec<_>>(),
            vec![3, 2, 1],
            "ordre total (lamport, author)"
        );
        assert_eq!(db.group_op_summary(&[1; 16]).unwrap(), (5, 3));
        assert_eq!(db.group_ops_after(&[1; 16], 1).unwrap().len(), 2);
        assert_eq!(db.group_ids().unwrap(), vec![[1; 16]]);
    }

    #[test]
    fn group_keys_by_epoch() {
        let db = Db::open_in_memory(&[1; 32]).unwrap();
        assert_eq!(db.latest_group_key(&[1; 16]).unwrap(), None);
        db.put_group_key(&[1; 16], 0, &[10; 32]).unwrap();
        db.put_group_key(&[1; 16], 1, &[11; 32]).unwrap();
        // Une réécriture du même epoch ne remplace pas la clé détenue.
        db.put_group_key(&[1; 16], 1, &[99; 32]).unwrap();
        assert_eq!(db.group_key(&[1; 16], 0).unwrap(), Some([10; 32]));
        assert_eq!(
            db.latest_group_key(&[1; 16]).unwrap(),
            Some(StoredGroupKey {
                key_epoch: 1,
                key: [11; 32]
            })
        );
    }
}
