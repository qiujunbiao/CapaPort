use crate::database::Database;
use crate::paths::PathPolicy;
use crate::{RuntimeError, RuntimeResult};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedWrite {
    pub relative_path: String,
    pub content_base64: String,
    pub content_digest: String,
    pub expected_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub transaction_id: String,
    pub adapter_id: String,
    pub capability_slug: String,
    pub package_digest: String,
    pub root_path: String,
    pub writes: Vec<PlannedWrite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRemoval {
    pub relative_path: String,
    pub expected_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallPlan {
    pub transaction_id: String,
    pub adapter_id: String,
    pub capability_slug: String,
    pub root_path: String,
    pub files: Vec<PlannedRemoval>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Create,
    Update,
    Unchanged,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewChange {
    pub relative_path: String,
    pub kind: ChangeKind,
    pub before_digest: Option<String>,
    pub after_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPreview {
    pub transaction_id: String,
    pub changes: Vec<PreviewChange>,
    pub conflicts: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub transaction_id: String,
    pub changed_files: usize,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JournalEntry {
    relative_path: String,
    destination: PathBuf,
    backup: PathBuf,
    existed: bool,
    applied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecoveryJournal {
    transaction_id: String,
    root: PathBuf,
    state: String,
    entries: Vec<JournalEntry>,
    #[serde(default)]
    restore_lock: Option<LockRestore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LockRestore {
    id: String,
    adapter_id: String,
    capability_slug: String,
    root_path: String,
    lock_json: Option<String>,
}

#[derive(Clone)]
pub struct FileEngine {
    policy: PathPolicy,
}

impl FileEngine {
    pub fn new(policy: PathPolicy) -> Self {
        Self { policy }
    }
    pub fn policy(&self) -> &PathPolicy {
        &self.policy
    }

    pub fn preview(&self, plan: &InstallPlan) -> RuntimeResult<InstallPreview> {
        validate_identifier(&plan.transaction_id)?;
        validate_identifier(&plan.adapter_id)?;
        validate_identifier(&plan.capability_slug)?;
        let root = Path::new(&plan.root_path);
        let mut changes = Vec::with_capacity(plan.writes.len());
        let mut seen = std::collections::HashSet::new();
        for write in &plan.writes {
            let relative = safe_relative(&write.relative_path)?;
            if !seen.insert(relative.clone()) {
                return Err(RuntimeError::InvalidInput);
            }
            let destination = self.policy.resolve(root, &relative)?;
            let content = decode_content(&write.content_base64)?;
            let after_digest = digest(&content);
            if write.content_digest != after_digest {
                return Err(RuntimeError::DigestMismatch);
            }
            let before_digest = if destination.exists() {
                Some(digest(
                    &fs::read(&destination).map_err(|_| RuntimeError::TransactionFailed)?,
                ))
            } else {
                None
            };
            let kind = match (&before_digest, &write.expected_digest) {
                (None, _) => ChangeKind::Create,
                (Some(before), Some(expected)) if before != expected => ChangeKind::Conflict,
                (Some(before), _) if before == &after_digest => ChangeKind::Unchanged,
                (Some(_), _) => ChangeKind::Update,
            };
            changes.push(PreviewChange {
                relative_path: write.relative_path.clone(),
                kind,
                before_digest,
                after_digest,
            });
        }
        changes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let conflicts = changes
            .iter()
            .filter(|change| change.kind == ChangeKind::Conflict)
            .count();
        Ok(InstallPreview {
            transaction_id: plan.transaction_id.clone(),
            changes,
            conflicts,
        })
    }

    pub fn apply(&self, plan: &InstallPlan, database: &Database) -> RuntimeResult<ApplyResult> {
        self.apply_with_failures(plan, database, None, false)
    }

    fn apply_with_failures(
        &self,
        plan: &InstallPlan,
        database: &Database,
        fail_after: Option<usize>,
        fail_rollback: bool,
    ) -> RuntimeResult<ApplyResult> {
        let preview = self.preview(plan)?;
        if preview.conflicts > 0 {
            return Err(RuntimeError::LocalModificationConflict);
        }
        let root = Path::new(&plan.root_path)
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        let runtime_root = root.join(".agentdoor");
        let staging_root = runtime_root.join("staging").join(&plan.transaction_id);
        let backup_root = runtime_root.join("backups").join(&plan.transaction_id);
        let journal_path = runtime_root
            .join("recovery")
            .join(format!("{}.json", plan.transaction_id));
        fs::create_dir_all(&staging_root).map_err(|_| RuntimeError::TransactionFailed)?;
        fs::create_dir_all(&backup_root).map_err(|_| RuntimeError::TransactionFailed)?;
        if let Some(parent) = journal_path.parent() {
            fs::create_dir_all(parent).map_err(|_| RuntimeError::TransactionFailed)?;
        }

        let previous_lock = database.load_lock(&plan.adapter_id, &plan.capability_slug, &plan.root_path)?;
        let mut journal = RecoveryJournal {
            transaction_id: plan.transaction_id.clone(),
            root: root.clone(),
            state: "applying".into(),
            entries: Vec::new(),
            restore_lock: Some(LockRestore {
                id: format!("rollback-{}", plan.transaction_id),
                adapter_id: plan.adapter_id.clone(),
                capability_slug: plan.capability_slug.clone(),
                root_path: plan.root_path.clone(),
                lock_json: previous_lock,
            }),
        };
        for write in &plan.writes {
            let relative = safe_relative(&write.relative_path)?;
            let destination = self.policy.resolve(&root, &relative)?;
            let staged = staging_root.join(&relative);
            let backup = backup_root.join(&relative);
            if let Some(parent) = staged.parent() {
                fs::create_dir_all(parent).map_err(|_| RuntimeError::TransactionFailed)?;
            }
            let content = decode_content(&write.content_base64)?;
            fs::write(&staged, &content).map_err(|_| RuntimeError::TransactionFailed)?;
            if digest(&fs::read(&staged).map_err(|_| RuntimeError::TransactionFailed)?)
                != digest(&content)
            {
                return Err(RuntimeError::DigestMismatch);
            }
            journal.entries.push(JournalEntry {
                relative_path: write.relative_path.clone(),
                destination,
                backup,
                existed: false,
                applied: false,
            });
        }
        write_journal(&journal_path, &journal)?;
        database.save_journal(
            &plan.transaction_id,
            "applying",
            &journal_path.to_string_lossy(),
            &now(),
        )?;

        for index in 0..journal.entries.len() {
            if fail_after == Some(index) {
                journal.state = "rollback_required".into();
                write_journal(&journal_path, &journal)?;
                return self
                    .rollback_journal(&journal_path, database, fail_rollback)
                    .and(Err(RuntimeError::TransactionFailed));
            }
            let destination = journal.entries[index].destination.clone();
            let backup = journal.entries[index].backup.clone();
            let relative_path = journal.entries[index].relative_path.clone();
            let preview_change = preview
                .changes
                .iter()
                .find(|change| change.relative_path == relative_path)
                .ok_or(RuntimeError::TransactionFailed)?;
            let current_digest = if destination.exists() {
                Some(digest(
                    &fs::read(&destination).map_err(|_| RuntimeError::TransactionFailed)?,
                ))
            } else {
                None
            };
            if current_digest != preview_change.before_digest {
                journal.state = "rollback_required".into();
                write_journal(&journal_path, &journal)?;
                let _ = database.save_journal(
                    &plan.transaction_id,
                    "rollback_required",
                    &journal_path.to_string_lossy(),
                    &now(),
                );
                return self
                    .rollback_journal(&journal_path, database, fail_rollback)
                    .and(Err(RuntimeError::LocalModificationConflict));
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|_| RuntimeError::TransactionFailed)?;
            }
            if destination.exists() {
                journal.entries[index].existed = true;
                if let Some(parent) = backup.parent() {
                    fs::create_dir_all(parent).map_err(|_| RuntimeError::TransactionFailed)?;
                }
                fs::copy(&destination, &backup).map_err(|_| RuntimeError::TransactionFailed)?;
                database.save_backup(
                    &format!("{}-{}", plan.transaction_id, index),
                    &plan.transaction_id,
                    &relative_path,
                    &backup.to_string_lossy(),
                    &now(),
                )?;
            }
            // Mark the entry before the first destructive operation. A crash or
            // rename failure after removal must restore the backup on recovery.
            journal.entries[index].applied = true;
            write_journal(&journal_path, &journal)?;
            if journal.entries[index].existed && fs::remove_file(&destination).is_err() {
                journal.state = "rollback_required".into();
                write_journal(&journal_path, &journal)?;
                return self
                    .rollback_journal(&journal_path, database, fail_rollback)
                    .and(Err(RuntimeError::TransactionFailed));
            }
            let staged = staging_root.join(safe_relative(&relative_path)?);
            if fs::rename(&staged, &destination).is_err() {
                journal.state = "rollback_required".into();
                write_journal(&journal_path, &journal)?;
                return self
                    .rollback_journal(&journal_path, database, fail_rollback)
                    .and(Err(RuntimeError::TransactionFailed));
            }
        }
        journal.state = "committed".into();
        write_journal(&journal_path, &journal)?;
        database.save_journal(
            &plan.transaction_id,
            "committed",
            &journal_path.to_string_lossy(),
            &now(),
        )?;
        let lock = serde_json::json!({
            "schemaVersion": "agentdoor.io/install-lock/v1", "adapterId": plan.adapter_id,
            "capabilitySlug": plan.capability_slug, "packageDigest": plan.package_digest,
            "transactionId": plan.transaction_id, "files": preview.changes
        });
        database.save_lock(
            &plan.transaction_id,
            &plan.adapter_id,
            &plan.capability_slug,
            &plan.root_path,
            &lock.to_string(),
            &now(),
        )?;
        Ok(ApplyResult {
            transaction_id: plan.transaction_id.clone(),
            changed_files: preview
                .changes
                .iter()
                .filter(|change| change.kind != ChangeKind::Unchanged)
                .count(),
            state: "committed".into(),
        })
    }

    pub fn rollback(
        &self,
        transaction_id: &str,
        database: &Database,
    ) -> RuntimeResult<ApplyResult> {
        validate_identifier(transaction_id)?;
        let path = database
            .journal_path(transaction_id)?
            .ok_or(RuntimeError::NotFound)?;
        self.rollback_journal(Path::new(&path), database, false)
    }

    pub fn uninstall(&self, plan: &UninstallPlan, database: &Database) -> RuntimeResult<ApplyResult> {
        self.uninstall_with_failures(plan, database, None, false)
    }

    fn uninstall_with_failures(
        &self,
        plan: &UninstallPlan,
        database: &Database,
        fail_after: Option<usize>,
        fail_rollback: bool,
    ) -> RuntimeResult<ApplyResult> {
        validate_identifier(&plan.transaction_id)?;
        validate_identifier(&plan.adapter_id)?;
        validate_identifier(&plan.capability_slug)?;
        let root = Path::new(&plan.root_path)
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        let lock_json = database
            .load_lock(&plan.adapter_id, &plan.capability_slug, &plan.root_path)?
            .ok_or(RuntimeError::NotFound)?;
        let runtime_root = root.join(".agentdoor");
        let backup_root = runtime_root.join("backups").join(&plan.transaction_id);
        let journal_path = runtime_root
            .join("recovery")
            .join(format!("{}.json", plan.transaction_id));
        fs::create_dir_all(&backup_root).map_err(|_| RuntimeError::TransactionFailed)?;
        if let Some(parent) = journal_path.parent() {
            fs::create_dir_all(parent).map_err(|_| RuntimeError::TransactionFailed)?;
        }
        let mut seen = std::collections::HashSet::new();
        let mut journal = RecoveryJournal {
            transaction_id: plan.transaction_id.clone(),
            root,
            state: "applying".into(),
            entries: Vec::new(),
            restore_lock: Some(LockRestore {
                id: plan.transaction_id.clone(),
                adapter_id: plan.adapter_id.clone(),
                capability_slug: plan.capability_slug.clone(),
                root_path: plan.root_path.clone(),
                lock_json: Some(lock_json),
            }),
        };
        for (index, file) in plan.files.iter().enumerate() {
            let relative = safe_relative(&file.relative_path)?;
            if !seen.insert(relative.clone()) {
                return Err(RuntimeError::InvalidInput);
            }
            let destination = self.policy.resolve(&journal.root, &relative)?;
            if !destination.exists() {
                continue;
            }
            let current = digest(&fs::read(&destination).map_err(|_| RuntimeError::TransactionFailed)?);
            if current != file.expected_digest {
                return Err(RuntimeError::LocalModificationConflict);
            }
            let backup = backup_root.join(&relative);
            if let Some(parent) = backup.parent() {
                fs::create_dir_all(parent).map_err(|_| RuntimeError::TransactionFailed)?;
            }
            fs::copy(&destination, &backup).map_err(|_| RuntimeError::TransactionFailed)?;
            database.save_backup(
                &format!("{}-{}", plan.transaction_id, index),
                &plan.transaction_id,
                &file.relative_path,
                &backup.to_string_lossy(),
                &now(),
            )?;
            journal.entries.push(JournalEntry {
                relative_path: file.relative_path.clone(),
                destination,
                backup,
                existed: true,
                applied: false,
            });
        }
        write_journal(&journal_path, &journal)?;
        database.save_journal(
            &plan.transaction_id,
            "applying",
            &journal_path.to_string_lossy(),
            &now(),
        )?;
        for index in 0..journal.entries.len() {
            if fail_after == Some(index) {
                journal.state = "rollback_required".into();
                write_journal(&journal_path, &journal)?;
                return self
                    .rollback_journal(&journal_path, database, fail_rollback)
                    .and(Err(RuntimeError::TransactionFailed));
            }
            journal.entries[index].applied = true;
            write_journal(&journal_path, &journal)?;
            if fs::remove_file(&journal.entries[index].destination).is_err() {
                journal.state = "rollback_required".into();
                write_journal(&journal_path, &journal)?;
                return self
                    .rollback_journal(&journal_path, database, fail_rollback)
                    .and(Err(RuntimeError::TransactionFailed));
            }
        }
        if database
            .remove_lock(&plan.adapter_id, &plan.capability_slug, &plan.root_path)
            .is_err()
        {
            journal.state = "rollback_required".into();
            write_journal(&journal_path, &journal)?;
            return self
                .rollback_journal(&journal_path, database, fail_rollback)
                .and(Err(RuntimeError::TransactionFailed));
        }
        journal.state = "uninstalled".into();
        write_journal(&journal_path, &journal)?;
        database.save_journal(
            &plan.transaction_id,
            "uninstalled",
            &journal_path.to_string_lossy(),
            &now(),
        )?;
        Ok(ApplyResult {
            transaction_id: plan.transaction_id.clone(),
            changed_files: journal.entries.len(),
            state: "uninstalled".into(),
        })
    }

    fn rollback_journal(
        &self,
        journal_path: &Path,
        database: &Database,
        simulate_failure: bool,
    ) -> RuntimeResult<ApplyResult> {
        let mut journal: RecoveryJournal = serde_json::from_slice(
            &fs::read(journal_path).map_err(|_| RuntimeError::RollbackFailed)?,
        )
        .map_err(|_| RuntimeError::RollbackFailed)?;
        if simulate_failure {
            journal.state = "manual_recovery_required".into();
            write_journal(journal_path, &journal)?;
            database.save_journal(
                &journal.transaction_id,
                &journal.state,
                &journal_path.to_string_lossy(),
                &now(),
            )?;
            return Err(RuntimeError::RollbackFailed);
        }
        for entry in journal.entries.iter().rev() {
            if !entry.applied {
                continue;
            }
            if entry.existed {
                if !entry.backup.exists() {
                    journal.state = "manual_recovery_required".into();
                    write_journal(journal_path, &journal)?;
                    database.save_journal(
                        &journal.transaction_id,
                        &journal.state,
                        &journal_path.to_string_lossy(),
                        &now(),
                    )?;
                    return Err(RuntimeError::RollbackFailed);
                }
                if entry.destination.exists() {
                    fs::remove_file(&entry.destination)
                        .map_err(|_| RuntimeError::RollbackFailed)?;
                }
                if let Some(parent) = entry.destination.parent() {
                    fs::create_dir_all(parent).map_err(|_| RuntimeError::RollbackFailed)?;
                }
                fs::copy(&entry.backup, &entry.destination)
                    .map_err(|_| RuntimeError::RollbackFailed)?;
            } else if entry.destination.exists() {
                fs::remove_file(&entry.destination).map_err(|_| RuntimeError::RollbackFailed)?;
            }
        }
        if let Some(lock) = &journal.restore_lock {
            if let Some(lock_json) = &lock.lock_json {
                database.save_lock(
                    &lock.id,
                    &lock.adapter_id,
                    &lock.capability_slug,
                    &lock.root_path,
                    lock_json,
                    &now(),
                )?;
            } else {
                database.remove_lock(&lock.adapter_id, &lock.capability_slug, &lock.root_path)?;
            }
        }
        journal.state = "rolled_back".into();
        write_journal(journal_path, &journal)?;
        database.save_journal(
            &journal.transaction_id,
            "rolled_back",
            &journal_path.to_string_lossy(),
            &now(),
        )?;
        Ok(ApplyResult {
            transaction_id: journal.transaction_id,
            changed_files: journal.entries.len(),
            state: "rolled_back".into(),
        })
    }
}

fn safe_relative(input: &str) -> RuntimeResult<PathBuf> {
    let path = Path::new(input);
    if input.is_empty()
        || input.contains('\0')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(RuntimeError::PathNotAllowed);
    }
    Ok(path.to_path_buf())
}
pub(crate) fn validate_identifier(value: &str) -> RuntimeResult<()> {
    if value.is_empty()
        || value.len() > 120
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        Err(RuntimeError::InvalidInput)
    } else {
        Ok(())
    }
}
fn decode_content(value: &str) -> RuntimeResult<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| RuntimeError::InvalidInput)
}
fn digest(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}
fn write_journal(path: &Path, journal: &RecoveryJournal) -> RuntimeResult<()> {
    fs::write(
        path,
        serde_json::to_vec_pretty(journal).map_err(|_| RuntimeError::TransactionFailed)?,
    )
    .map_err(|_| RuntimeError::TransactionFailed)
}
fn now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{millis:020}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    fn fixture() -> (tempfile::TempDir, FileEngine, Database) {
        let root = tempdir().unwrap();
        let policy = PathPolicy::new([root.path().to_path_buf()]).unwrap();
        let database = Database::open(&root.path().join("state.db")).unwrap();
        (root, FileEngine::new(policy), database)
    }
    fn plan(root: &Path, expected: Option<String>) -> InstallPlan {
        InstallPlan {
            transaction_id: "tx-1".into(),
            adapter_id: "codex".into(),
            capability_slug: "release".into(),
            package_digest: "a".repeat(64),
            root_path: root.to_string_lossy().into(),
            writes: vec![PlannedWrite {
                relative_path: "skills/release/SKILL.md".into(),
                content_base64: base64::engine::general_purpose::STANDARD.encode("new"),
                content_digest: digest(b"new"),
                expected_digest: expected,
            }],
        }
    }
    #[test]
    fn previews_applies_and_rolls_back_with_backups() {
        let (root, engine, database) = fixture();
        let target = root.path().join("skills/release/SKILL.md");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "old").unwrap();
        let current = digest(b"old");
        let plan = plan(root.path(), Some(current));
        assert_eq!(
            engine.preview(&plan).unwrap().changes[0].kind,
            ChangeKind::Update
        );
        assert_eq!(engine.apply(&plan, &database).unwrap().state, "committed");
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert_eq!(database.backup_count("tx-1"), 1);
        assert_eq!(
            engine.rollback("tx-1", &database).unwrap().state,
            "rolled_back"
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), "old");
        assert!(
            database
                .load_lock("codex", "release", &root.path().to_string_lossy())
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn blocks_local_modification_conflicts() {
        let (root, engine, database) = fixture();
        let target = root.path().join("skills/release/SKILL.md");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "changed").unwrap();
        assert!(matches!(
            engine.apply(&plan(root.path(), Some(digest(b"original"))), &database),
            Err(RuntimeError::LocalModificationConflict)
        ));
    }
    #[test]
    fn simulated_failure_rolls_back_and_records_manual_recovery_failure() {
        let (root, engine, database) = fixture();
        let result =
            engine.apply_with_failures(&plan(root.path(), None), &database, Some(0), false);
        assert!(matches!(result, Err(RuntimeError::TransactionFailed)));
        let manual = InstallPlan {
            transaction_id: "tx-2".into(),
            ..plan(root.path(), None)
        };
        let result = engine.apply_with_failures(&manual, &database, Some(0), true);
        assert!(matches!(result, Err(RuntimeError::RollbackFailed)));
        assert_eq!(
            database.journal_state("tx-2").unwrap().as_deref(),
            Some("manual_recovery_required")
        );
    }

    #[test]
    fn restores_the_first_file_when_a_later_write_fails() {
        let (root, engine, database) = fixture();
        let first = root.path().join("skills/first/SKILL.md");
        fs::create_dir_all(first.parent().unwrap()).unwrap();
        fs::write(&first, "old").unwrap();
        let plan = InstallPlan {
            transaction_id: "tx-multi".into(),
            adapter_id: "codex".into(),
            capability_slug: "multi".into(),
            package_digest: "b".repeat(64),
            root_path: root.path().to_string_lossy().into(),
            writes: vec![
                PlannedWrite {
                    relative_path: "skills/first/SKILL.md".into(),
                    content_base64: base64::engine::general_purpose::STANDARD.encode("new"),
                    content_digest: digest(b"new"),
                    expected_digest: Some(digest(b"old")),
                },
                PlannedWrite {
                    relative_path: "skills/second/SKILL.md".into(),
                    content_base64: base64::engine::general_purpose::STANDARD.encode("second"),
                    content_digest: digest(b"second"),
                    expected_digest: None,
                },
            ],
        };
        let result = engine.apply_with_failures(&plan, &database, Some(1), false);
        assert!(matches!(result, Err(RuntimeError::TransactionFailed)));
        assert_eq!(fs::read_to_string(first).unwrap(), "old");
        assert!(!root.path().join("skills/second/SKILL.md").exists());
        assert_eq!(
            database.journal_state("tx-multi").unwrap().as_deref(),
            Some("rolled_back")
        );
    }

    #[test]
    fn rejects_staged_content_that_does_not_match_the_signed_plan_digest() {
        let (root, engine, _database) = fixture();
        let mut plan = plan(root.path(), None);
        plan.writes[0].content_digest = digest(b"tampered");
        assert!(matches!(
            engine.preview(&plan),
            Err(RuntimeError::DigestMismatch)
        ));
    }

    #[test]
    fn uninstall_failure_restores_every_removed_file_and_preserves_the_lock() {
        let (root, engine, database) = fixture();
        let first = root.path().join("skills/release/SKILL.md");
        let second = root.path().join("skills/release/reference.md");
        fs::create_dir_all(first.parent().unwrap()).unwrap();
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        database
            .save_lock(
                "install-release",
                "codex",
                "release",
                &root.path().to_string_lossy(),
                "{}",
                &now(),
            )
            .unwrap();
        let plan = UninstallPlan {
            transaction_id: "uninstall-release".into(),
            adapter_id: "codex".into(),
            capability_slug: "release".into(),
            root_path: root.path().to_string_lossy().into(),
            files: vec![
                PlannedRemoval {
                    relative_path: "skills/release/SKILL.md".into(),
                    expected_digest: digest(b"first"),
                },
                PlannedRemoval {
                    relative_path: "skills/release/reference.md".into(),
                    expected_digest: digest(b"second"),
                },
            ],
        };

        let result = engine.uninstall_with_failures(&plan, &database, Some(1), false);

        assert!(matches!(result, Err(RuntimeError::TransactionFailed)));
        assert_eq!(fs::read_to_string(first).unwrap(), "first");
        assert_eq!(fs::read_to_string(second).unwrap(), "second");
        assert!(database.load_lock("codex", "release", &root.path().to_string_lossy()).unwrap().is_some());
        assert_eq!(database.journal_state("uninstall-release").unwrap().as_deref(), Some("rolled_back"));
    }

    #[test]
    fn completed_uninstall_can_be_explicitly_rolled_back() {
        let (root, engine, database) = fixture();
        let target = root.path().join("skills/release/SKILL.md");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "installed").unwrap();
        database
            .save_lock(
                "install-release",
                "codex",
                "release",
                &root.path().to_string_lossy(),
                "{}",
                &now(),
            )
            .unwrap();
        let plan = UninstallPlan {
            transaction_id: "uninstall-release".into(),
            adapter_id: "codex".into(),
            capability_slug: "release".into(),
            root_path: root.path().to_string_lossy().into(),
            files: vec![PlannedRemoval {
                relative_path: "skills/release/SKILL.md".into(),
                expected_digest: digest(b"installed"),
            }],
        };

        assert_eq!(engine.uninstall(&plan, &database).unwrap().state, "uninstalled");
        assert!(!target.exists());
        assert!(database.load_lock("codex", "release", &root.path().to_string_lossy()).unwrap().is_none());
        assert_eq!(engine.rollback("uninstall-release", &database).unwrap().state, "rolled_back");
        assert_eq!(fs::read_to_string(target).unwrap(), "installed");
    }
}
