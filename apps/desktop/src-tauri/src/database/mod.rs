use crate::{RuntimeError, RuntimeResult};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::path::Path;

const MIGRATION: &str = r#"
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS device_cache (key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS path_bindings (id TEXT PRIMARY KEY,space_id TEXT NOT NULL,local_path TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(space_id,local_path));
CREATE TABLE IF NOT EXISTS local_project_bindings (id TEXT PRIMARY KEY,space_id TEXT NOT NULL,local_path TEXT NOT NULL,agents_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(space_id,local_path));
CREATE TABLE IF NOT EXISTS install_locks (id TEXT PRIMARY KEY,adapter_id TEXT NOT NULL,capability_slug TEXT NOT NULL,root_path TEXT NOT NULL,lock_json TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(adapter_id,capability_slug,root_path));
CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL,relative_path TEXT NOT NULL,backup_path TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_cursors (scope_key TEXT PRIMARY KEY,cursor TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS retry_queue (id TEXT PRIMARY KEY,operation TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available_at TEXT NOT NULL,last_error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_journal (transaction_id TEXT PRIMARY KEY,state TEXT NOT NULL,journal_path TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS retry_queue_ready_idx ON retry_queue(status,available_at);
"#;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncQueueStatus {
    pub pending: u64,
    pub failed: u64,
    pub next_available_at: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RetryOperation {
    pub id: String,
    pub operation: String,
    pub payload_json: String,
    pub attempts: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectBindingRow {
    pub local_binding_id: String,
    pub space_id: String,
    pub local_path: String,
    pub agents: Vec<String>,
    pub status: String,
    pub created_at: String,
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> RuntimeResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| RuntimeError::Database)?;
        }
        let connection = Connection::open(path).map_err(|_| RuntimeError::Database)?;
        connection
            .execute_batch(MIGRATION)
            .map_err(|_| RuntimeError::Database)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn bind_path(
        &self,
        id: &str,
        space_id: &str,
        local_path: &str,
        now: &str,
    ) -> RuntimeResult<()> {
        self.connection.lock().execute(
            "INSERT INTO path_bindings(id,space_id,local_path,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(space_id,local_path) DO NOTHING",
            params![id, space_id, local_path, now],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn bound_paths(&self) -> RuntimeResult<Vec<String>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT local_path FROM path_bindings UNION SELECT local_path FROM local_project_bindings WHERE status='active' ORDER BY local_path")
            .map_err(|_| RuntimeError::Database)?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|_| RuntimeError::Database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| RuntimeError::Database)
    }

    pub fn bind_project_path(
        &self,
        id: &str,
        space_id: &str,
        local_path: &str,
        agents: &[String],
        now: &str,
    ) -> RuntimeResult<LocalProjectBindingRow> {
        let agents_json = serde_json::to_string(agents).map_err(|_| RuntimeError::InvalidInput)?;
        self.connection.lock().execute(
            "INSERT INTO local_project_bindings(id,space_id,local_path,agents_json,status,created_at,updated_at) VALUES(?1,?2,?3,?4,'active',?5,?5) ON CONFLICT(space_id,local_path) DO UPDATE SET agents_json=excluded.agents_json,status='active',updated_at=excluded.updated_at",
            params![id, space_id, local_path, agents_json, now],
        ).map_err(|_| RuntimeError::Database)?;
        self.connection.lock().query_row(
            "SELECT id,space_id,local_path,agents_json,status,created_at FROM local_project_bindings WHERE space_id=?1 AND local_path=?2",
            params![space_id, local_path],
            |row| {
                let agents_json: String = row.get(3)?;
                Ok(LocalProjectBindingRow {
                    local_binding_id: row.get(0)?,
                    space_id: row.get(1)?,
                    local_path: row.get(2)?,
                    agents: serde_json::from_str(&agents_json).unwrap_or_default(),
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        ).map_err(|_| RuntimeError::Database)
    }

    pub fn project_bindings(&self, space_id: Option<&str>) -> RuntimeResult<Vec<LocalProjectBindingRow>> {
        let connection = self.connection.lock();
        let sql = if space_id.is_some() {
            "SELECT id,space_id,local_path,agents_json,status,created_at FROM local_project_bindings WHERE space_id=?1 ORDER BY created_at,id"
        } else {
            "SELECT id,space_id,local_path,agents_json,status,created_at FROM local_project_bindings ORDER BY created_at,id"
        };
        let mut statement = connection.prepare(sql).map_err(|_| RuntimeError::Database)?;
        let map_row = |row: &rusqlite::Row<'_>| {
            let agents_json: String = row.get(3)?;
            Ok(LocalProjectBindingRow {
                local_binding_id: row.get(0)?,
                space_id: row.get(1)?,
                local_path: row.get(2)?,
                agents: serde_json::from_str(&agents_json).unwrap_or_default(),
                status: row.get(4)?,
                created_at: row.get(5)?,
            })
        };
        let rows = if let Some(space_id) = space_id {
            statement.query_map([space_id], map_row).map_err(|_| RuntimeError::Database)?
        } else {
            statement.query_map([], map_row).map_err(|_| RuntimeError::Database)?
        };
        rows.collect::<Result<Vec<_>, _>>().map_err(|_| RuntimeError::Database)
    }

    pub fn remove_project_binding(&self, local_binding_id: &str, now: &str) -> RuntimeResult<()> {
        let changed = self.connection.lock().execute(
            "UPDATE local_project_bindings SET status='removed',updated_at=?2 WHERE id=?1",
            params![local_binding_id, now],
        ).map_err(|_| RuntimeError::Database)?;
        if changed == 0 { return Err(RuntimeError::NotFound); }
        Ok(())
    }

    pub fn save_lock(
        &self,
        id: &str,
        adapter_id: &str,
        slug: &str,
        root: &str,
        lock_json: &str,
        now: &str,
    ) -> RuntimeResult<()> {
        self.connection.lock().execute(
            "INSERT INTO install_locks(id,adapter_id,capability_slug,root_path,lock_json,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(adapter_id,capability_slug,root_path) DO UPDATE SET lock_json=excluded.lock_json,updated_at=excluded.updated_at",
            params![id, adapter_id, slug, root, lock_json, now],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn load_lock(&self, adapter_id: &str, capability_slug: &str, root_path: &str) -> RuntimeResult<Option<String>> {
        self.connection.lock().query_row(
            "SELECT lock_json FROM install_locks WHERE adapter_id=?1 AND capability_slug=?2 AND root_path=?3",
            params![adapter_id, capability_slug, root_path], |row| row.get(0),
        ).optional().map_err(|_| RuntimeError::Database)
    }

    pub fn remove_lock(&self, adapter_id: &str, capability_slug: &str, root_path: &str) -> RuntimeResult<()> {
        self.connection.lock().execute(
            "DELETE FROM install_locks WHERE adapter_id=?1 AND capability_slug=?2 AND root_path=?3",
            params![adapter_id, capability_slug, root_path],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn save_backup(
        &self,
        id: &str,
        transaction_id: &str,
        relative_path: &str,
        backup_path: &str,
        now: &str,
    ) -> RuntimeResult<()> {
        self.connection.lock().execute(
            "INSERT OR REPLACE INTO backups(id,transaction_id,relative_path,backup_path,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![id, transaction_id, relative_path, backup_path, now],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn save_sync_cursor(&self, scope_key: &str, cursor: &str, now: &str) -> RuntimeResult<()> {
        self.connection.lock().execute(
            "INSERT INTO sync_cursors(scope_key,cursor,updated_at) VALUES(?1,?2,?3) ON CONFLICT(scope_key) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at",
            params![scope_key, cursor, now],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn sync_cursor(&self, scope_key: &str) -> RuntimeResult<Option<String>> {
        self.connection
            .lock()
            .query_row(
                "SELECT cursor FROM sync_cursors WHERE scope_key=?1",
                [scope_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| RuntimeError::Database)
    }

    pub fn enqueue_retry(
        &self,
        id: &str,
        operation: &str,
        payload_json: &str,
        available_at: &str,
        now: &str,
    ) -> RuntimeResult<()> {
        self.connection.lock().execute(
            "INSERT INTO retry_queue(id,operation,payload_json,status,attempts,available_at,created_at,updated_at) VALUES(?1,?2,?3,'pending',0,?4,?5,?5) ON CONFLICT(id) DO NOTHING",
            params![id, operation, payload_json, available_at, now],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn ready_retries(&self, now: &str, limit: u32) -> RuntimeResult<Vec<RetryOperation>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,operation,payload_json,attempts FROM retry_queue WHERE status='pending' AND available_at<=?1 ORDER BY available_at,id LIMIT ?2",
        ).map_err(|_| RuntimeError::Database)?;
        let rows = statement
            .query_map(params![now, limit], |row| {
                Ok(RetryOperation {
                    id: row.get(0)?,
                    operation: row.get(1)?,
                    payload_json: row.get(2)?,
                    attempts: row.get::<_, i64>(3)? as u32,
                })
            })
            .map_err(|_| RuntimeError::Database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| RuntimeError::Database)
    }

    pub fn reschedule_retry(
        &self,
        id: &str,
        error_code: &str,
        available_at: &str,
        now: &str,
        permanently_failed: bool,
    ) -> RuntimeResult<()> {
        let status = if permanently_failed {
            "failed"
        } else {
            "pending"
        };
        self.connection.lock().execute(
            "UPDATE retry_queue SET status=?2,attempts=attempts+1,available_at=?3,last_error_code=?4,updated_at=?5 WHERE id=?1",
            params![id, status, available_at, error_code, now],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn complete_retry(&self, id: &str) -> RuntimeResult<()> {
        self.connection
            .lock()
            .execute("DELETE FROM retry_queue WHERE id=?1", [id])
            .map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn save_journal(
        &self,
        transaction_id: &str,
        state: &str,
        path: &str,
        now: &str,
    ) -> RuntimeResult<()> {
        self.connection.lock().execute(
            "INSERT INTO recovery_journal(transaction_id,state,journal_path,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(transaction_id) DO UPDATE SET state=excluded.state,journal_path=excluded.journal_path,updated_at=excluded.updated_at",
            params![transaction_id, state, path, now],
        ).map_err(|_| RuntimeError::Database)?;
        Ok(())
    }

    pub fn journal_path(&self, transaction_id: &str) -> RuntimeResult<Option<String>> {
        self.connection
            .lock()
            .query_row(
                "SELECT journal_path FROM recovery_journal WHERE transaction_id=?1",
                [transaction_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| RuntimeError::Database)
    }

    pub fn journal_state(&self, transaction_id: &str) -> RuntimeResult<Option<String>> {
        self.connection
            .lock()
            .query_row(
                "SELECT state FROM recovery_journal WHERE transaction_id=?1",
                [transaction_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| RuntimeError::Database)
    }

    pub fn queue_status(&self) -> RuntimeResult<SyncQueueStatus> {
        self.connection.lock().query_row(
            "SELECT count(*) FILTER(WHERE status='pending'),count(*) FILTER(WHERE status='failed'),min(available_at) FILTER(WHERE status='pending') FROM retry_queue",
            [], |row| Ok(SyncQueueStatus { pending: row.get::<_, i64>(0)? as u64, failed: row.get::<_, i64>(1)? as u64, next_available_at: row.get(2)? }),
        ).map_err(|_| RuntimeError::Database)
    }

    #[cfg(test)]
    fn table_count(&self) -> i64 {
        self.connection.lock().query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('device_cache','path_bindings','local_project_bindings','install_locks','backups','sync_cursors','retry_queue','recovery_journal')", [], |row| row.get(0)).unwrap()
    }

    #[cfg(test)]
    pub(crate) fn backup_count(&self, transaction_id: &str) -> i64 {
        self.connection
            .lock()
            .query_row(
                "SELECT count(*) FROM backups WHERE transaction_id=?1",
                [transaction_id],
                |row| row.get(0),
            )
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[test]
    fn migrates_all_local_state_tables_and_reports_an_empty_queue() {
        let directory = tempdir().unwrap();
        let database = Database::open(&directory.path().join("agentdoor.db")).unwrap();
        assert_eq!(database.table_count(), 8);
        assert_eq!(
            database.queue_status().unwrap(),
            SyncQueueStatus {
                pending: 0,
                failed: 0,
                next_available_at: None
            }
        );
    }

    #[test]
    fn persists_cursors_and_runs_a_durable_retry_lifecycle() {
        let directory = tempdir().unwrap();
        let database = Database::open(&directory.path().join("agentdoor.db")).unwrap();
        database
            .save_sync_cursor("space:1", "cursor-2", "0002")
            .unwrap();
        assert_eq!(
            database.sync_cursor("space:1").unwrap().as_deref(),
            Some("cursor-2")
        );

        database
            .enqueue_retry("retry-1", "sync_pull", r#"{"spaceId":"1"}"#, "0001", "0001")
            .unwrap();
        database
            .enqueue_retry("retry-2", "sync_push", "{}", "0003", "0001")
            .unwrap();
        let ready = database.ready_retries("0002", 10).unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, "retry-1");
        database
            .reschedule_retry("retry-1", "NETWORK", "0004", "0002", false)
            .unwrap();
        let ready = database.ready_retries("0003", 10).unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, "retry-2");
        database
            .reschedule_retry("retry-1", "DENIED", "0004", "0003", true)
            .unwrap();
        assert_eq!(database.queue_status().unwrap().failed, 1);
        database.complete_retry("retry-1").unwrap();
        assert_eq!(database.queue_status().unwrap().failed, 0);
    }
}
