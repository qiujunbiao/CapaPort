use crate::credentials::CredentialStore;
use crate::database::{Database, SyncQueueStatus};
use crate::files::{ApplyResult, FileEngine, InstallPlan, InstallPreview};
use crate::paths::PathPolicy;
use crate::{RuntimeError, RuntimeResult};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDescriptor {
    pub adapter_id: String,
    pub display_name: String,
    pub scope: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCapabilitySummary {
    pub slug: String,
    pub component_type: String,
    pub relative_path: String,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFinding {
    pub rule: String,
    pub severity: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalScanReport {
    pub files: usize,
    pub bytes: u64,
    pub findings: Vec<ScanFinding>,
    pub blocked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryInput {
    pub adapter_id: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInput {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindProjectInput {
    pub space_id: String,
    pub path: String,
}

pub struct Runtime {
    database: Database,
    engine: FileEngine,
    home_dir: PathBuf,
    project_root: Option<PathBuf>,
    #[allow(dead_code)]
    credentials: Arc<dyn CredentialStore>,
}

impl Runtime {
    pub fn new(
        database_path: &Path,
        home_dir: PathBuf,
        project_root: Option<PathBuf>,
        credentials: Arc<dyn CredentialStore>,
    ) -> RuntimeResult<Self> {
        let database = Database::open(database_path)?;
        let mut roots = Vec::new();
        for (_, _, directory) in agent_directories() {
            let user = home_dir.join(directory);
            if user.is_dir() {
                roots.push(user);
            }
            if let Some(project) = &project_root {
                let workspace = project.join(directory);
                if workspace.is_dir() {
                    roots.push(workspace);
                }
            }
        }
        for bound_path in database.bound_paths()? {
            let path = PathBuf::from(bound_path);
            if path.is_dir() {
                roots.push(path);
            }
        }
        let policy = PathPolicy::new(roots)?;
        Ok(Self {
            database,
            engine: FileEngine::new(policy),
            home_dir,
            project_root,
            credentials,
        })
    }

    pub fn detect_agents(&self) -> RuntimeResult<Vec<AgentDescriptor>> {
        let mut agents = Vec::new();
        for (adapter_id, display_name, directory) in agent_directories() {
            for (scope, base) in [
                ("user", Some(&self.home_dir)),
                ("workspace", self.project_root.as_ref()),
            ] {
                let Some(base) = base else { continue };
                let root = base.join(directory);
                if root.is_dir() {
                    agents.push(AgentDescriptor {
                        adapter_id: adapter_id.into(),
                        display_name: display_name.into(),
                        scope: scope.into(),
                        root_path: root
                            .canonicalize()
                            .map_err(|_| RuntimeError::PathNotAllowed)?
                            .to_string_lossy()
                            .into(),
                    });
                }
            }
        }
        agents.sort_by(|left, right| {
            (&left.adapter_id, &left.scope).cmp(&(&right.adapter_id, &right.scope))
        });
        Ok(agents)
    }

    pub fn inventory_agent(
        &self,
        input: &InventoryInput,
    ) -> RuntimeResult<Vec<LocalCapabilitySummary>> {
        if !agent_directories()
            .iter()
            .any(|(id, _, _)| id == &input.adapter_id)
        {
            return Err(RuntimeError::InvalidInput);
        }
        let root = Path::new(&input.root_path);
        let mut capabilities = Vec::new();
        for (component_type, directory) in component_directories(&input.adapter_id) {
            let component_root = self.engine.policy().resolve(root, Path::new(directory))?;
            if !component_root.exists() {
                continue;
            }
            for entry in
                std::fs::read_dir(&component_root).map_err(|_| RuntimeError::TransactionFailed)?
            {
                let entry = entry.map_err(|_| RuntimeError::TransactionFailed)?;
                let file_type = entry
                    .file_type()
                    .map_err(|_| RuntimeError::TransactionFailed)?;
                if file_type.is_symlink() {
                    return Err(RuntimeError::SymlinkRejected);
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                let (slug, source_path) = if *component_type == "skill" {
                    if !file_type.is_dir() || !entry.path().join("SKILL.md").is_file() {
                        continue;
                    }
                    (name.clone(), entry.path())
                } else {
                    if !file_type.is_file()
                        || entry
                            .path()
                            .extension()
                            .and_then(|value| value.to_str())
                            .map(str::to_ascii_lowercase)
                            .as_deref()
                            != Some("md")
                    {
                        continue;
                    }
                    let slug = entry
                        .path()
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .ok_or(RuntimeError::InvalidInput)?
                        .to_owned();
                    (slug, entry.path())
                };
                capabilities.push(LocalCapabilitySummary {
                    slug,
                    component_type: (*component_type).into(),
                    relative_path: format!("{directory}/{name}"),
                    digest: package_digest(&source_path)?,
                });
            }
        }
        capabilities.sort_by(|left, right| {
            (&left.component_type, &left.slug).cmp(&(&right.component_type, &right.slug))
        });
        Ok(capabilities)
    }

    pub fn scan_local_package(&self, input: &PathInput) -> RuntimeResult<LocalScanReport> {
        let selected = Path::new(&input.path)
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        let root = self
            .engine
            .policy()
            .roots()
            .into_iter()
            .find(|root| selected.starts_with(root))
            .ok_or(RuntimeError::PathNotAllowed)?;
        let relative = selected
            .strip_prefix(&root)
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        let selected = if relative.as_os_str().is_empty() {
            root.clone()
        } else {
            self.engine.policy().resolve(&root, relative)?
        };
        let secret = Regex::new(r"(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s]{8,})").map_err(|_| RuntimeError::InvalidInput)?;
        let mut report = LocalScanReport {
            files: 0,
            bytes: 0,
            findings: Vec::new(),
            blocked: false,
        };
        for entry in WalkDir::new(&selected)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !ignored(entry.path()))
        {
            let entry = entry.map_err(|_| RuntimeError::TransactionFailed)?;
            if entry.path_is_symlink() {
                return Err(RuntimeError::SymlinkRejected);
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|_| RuntimeError::TransactionFailed)?;
            if metadata.len() > 2_000_000 {
                continue;
            }
            report.files += 1;
            report.bytes += metadata.len();
            let content =
                std::fs::read(entry.path()).map_err(|_| RuntimeError::TransactionFailed)?;
            if let Ok(text) = std::str::from_utf8(&content)
                && secret.is_match(text)
            {
                report.findings.push(ScanFinding {
                    rule: "potential-secret".into(),
                    severity: "high".into(),
                    relative_path: entry
                        .path()
                        .strip_prefix(&selected)
                        .unwrap_or(entry.path())
                        .to_string_lossy()
                        .into(),
                });
            }
        }
        report
            .findings
            .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        report.blocked = !report.findings.is_empty();
        Ok(report)
    }

    pub fn preview_install(&self, plan: &InstallPlan) -> RuntimeResult<InstallPreview> {
        self.engine.preview(plan)
    }
    pub fn apply_install(&self, plan: &InstallPlan) -> RuntimeResult<ApplyResult> {
        self.engine.apply(plan, &self.database)
    }
    pub fn rollback_install(&self, transaction_id: &str) -> RuntimeResult<ApplyResult> {
        self.engine.rollback(transaction_id, &self.database)
    }
    pub fn bind_project_directory(&self, input: &BindProjectInput) -> RuntimeResult<String> {
        if input.space_id.is_empty() || input.space_id.len() > 120 {
            return Err(RuntimeError::InvalidInput);
        }
        let canonical = self.engine.policy().add_root(PathBuf::from(&input.path))?;
        self.database.bind_path(
            &Uuid::new_v4().to_string(),
            &input.space_id,
            &canonical.to_string_lossy(),
            &now(),
        )?;
        Ok("bound".into())
    }
    pub fn sync_queue_status(&self) -> RuntimeResult<SyncQueueStatus> {
        self.database.queue_status()
    }
}

fn agent_directories() -> [(&'static str, &'static str, &'static str); 4] {
    [
        ("codex", "Codex", ".agents"),
        ("claude-code", "Claude Code", ".claude"),
        ("cursor", "Cursor", ".cursor"),
        ("gemini-cli", "Gemini CLI", ".gemini"),
    ]
}
fn component_directories(adapter_id: &str) -> &'static [(&'static str, &'static str)] {
    match adapter_id {
        "codex" => &[("skill", "skills")],
        "gemini-cli" => &[("skill", "skills"), ("prompt", "commands")],
        "claude-code" | "cursor" => &[
            ("skill", "skills"),
            ("prompt", "commands"),
            ("context", "rules"),
        ],
        _ => &[],
    }
}

fn package_digest(source: &Path) -> RuntimeResult<String> {
    let root = if source.is_dir() {
        source
    } else {
        source.parent().ok_or(RuntimeError::InvalidInput)?
    };
    let mut files = Vec::new();
    if source.is_file() {
        files.push(source.to_path_buf());
    } else {
        for entry in WalkDir::new(source).follow_links(false) {
            let entry = entry.map_err(|_| RuntimeError::TransactionFailed)?;
            if entry.path_is_symlink() {
                return Err(RuntimeError::SymlinkRejected);
            }
            if entry.file_type().is_file() {
                files.push(entry.path().to_path_buf());
            }
        }
    }
    files.sort_by(|left, right| {
        left.strip_prefix(root)
            .unwrap_or(left)
            .cmp(right.strip_prefix(root).unwrap_or(right))
    });
    let mut hash = Sha256::new();
    for file in files {
        let relative = file
            .strip_prefix(root)
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        let normalized = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let content = std::fs::read(&file).map_err(|_| RuntimeError::TransactionFailed)?;
        let path_bytes = normalized.as_bytes();
        let path_length =
            u32::try_from(path_bytes.len()).map_err(|_| RuntimeError::InvalidInput)?;
        let content_length =
            u32::try_from(content.len()).map_err(|_| RuntimeError::InvalidInput)?;
        hash.update(path_length.to_be_bytes());
        hash.update(content_length.to_be_bytes());
        hash.update(path_bytes);
        hash.update(content);
    }
    Ok(hex::encode(hash.finalize()))
}

fn ignored(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(
            component.as_os_str().to_str(),
            Some(".git" | ".agentdoor" | "node_modules" | "target" | "dist")
        )
    })
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
    use crate::credentials::MemoryCredentialStore;
    use tempfile::tempdir;
    fn runtime() -> (tempfile::TempDir, Runtime) {
        let root = tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(".agents/skills/release")).unwrap();
        std::fs::write(
            root.path().join(".agents/skills/release/SKILL.md"),
            "# Release",
        )
        .unwrap();
        let runtime = Runtime::new(
            &root.path().join("state.db"),
            root.path().into(),
            None,
            Arc::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        (root, runtime)
    }
    #[test]
    fn commands_detect_inventory_bind_and_scan_without_leaking_content() {
        let (root, runtime) = runtime();
        let agents = runtime.detect_agents().unwrap();
        assert_eq!(agents.len(), 1);
        let inventory = runtime
            .inventory_agent(&InventoryInput {
                adapter_id: "codex".into(),
                root_path: agents[0].root_path.clone(),
            })
            .unwrap();
        assert_eq!(inventory[0].slug, "release");
        let report = runtime
            .scan_local_package(&PathInput {
                path: root
                    .path()
                    .join(".agents/skills/release")
                    .to_string_lossy()
                    .into(),
            })
            .unwrap();
        assert!(!report.blocked);
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        assert_eq!(
            runtime
                .bind_project_directory(&BindProjectInput {
                    space_id: "space-1".into(),
                    path: project.to_string_lossy().into()
                })
                .unwrap(),
            "bound"
        );
        assert_eq!(runtime.sync_queue_status().unwrap().pending, 0);
    }
    #[test]
    fn scanner_blocks_likely_secrets_and_omits_the_secret_value() {
        let (root, runtime) = runtime();
        let directory = root.path().join(".agents/skills/release");
        std::fs::write(directory.join("private.txt"), "api_key=very-private-token").unwrap();
        let report = runtime
            .scan_local_package(&PathInput {
                path: directory.to_string_lossy().into(),
            })
            .unwrap();
        assert!(report.blocked);
        assert_eq!(report.findings[0].rule, "potential-secret");
        assert!(
            !serde_json::to_string(&report)
                .unwrap()
                .contains("very-private-token")
        );
    }

    #[test]
    fn inventory_rejects_a_forged_root_outside_the_allowlist() {
        let (_root, runtime) = runtime();
        let outside = tempdir().unwrap();
        let result = runtime.inventory_agent(&InventoryInput {
            adapter_id: "codex".into(),
            root_path: outside.path().to_string_lossy().into(),
        });
        assert!(matches!(result, Err(RuntimeError::PathNotAllowed)));
    }

    #[test]
    fn inventory_discovers_every_component_supported_by_the_agent() {
        let root = tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(".claude/skills/release")).unwrap();
        std::fs::create_dir_all(root.path().join(".claude/commands")).unwrap();
        std::fs::create_dir_all(root.path().join(".claude/rules")).unwrap();
        std::fs::write(
            root.path().join(".claude/skills/release/SKILL.md"),
            "# Release",
        )
        .unwrap();
        std::fs::write(
            root.path().join(".claude/commands/review.md"),
            "Review this",
        )
        .unwrap();
        std::fs::write(root.path().join(".claude/rules/security.md"), "No secrets").unwrap();
        let runtime = Runtime::new(
            &root.path().join("state.db"),
            root.path().into(),
            None,
            Arc::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let agents = runtime.detect_agents().unwrap();
        let inventory = runtime
            .inventory_agent(&InventoryInput {
                adapter_id: "claude-code".into(),
                root_path: agents[0].root_path.clone(),
            })
            .unwrap();
        assert_eq!(
            inventory
                .iter()
                .map(|item| item.component_type.as_str())
                .collect::<Vec<_>>(),
            vec!["context", "prompt", "skill"]
        );
        assert!(inventory.iter().all(|item| item.digest.len() == 64));
        assert_eq!(
            inventory
                .iter()
                .find(|item| item.component_type == "skill")
                .unwrap()
                .digest,
            "d2f068b3b51f5da335a8e7efb698573173dde5b86b9964f98d2e5a545239fc3b"
        );
    }

    #[test]
    fn scanner_never_includes_local_transaction_metadata() {
        let (root, runtime) = runtime();
        let internal = root.path().join(".agents/.agentdoor/recovery");
        std::fs::create_dir_all(&internal).unwrap();
        std::fs::write(internal.join("tx.json"), r#"{"root":"/private/customer"}"#).unwrap();
        let report = runtime
            .scan_local_package(&PathInput {
                path: root.path().join(".agents").to_string_lossy().into(),
            })
            .unwrap();
        assert_eq!(report.files, 1);
        assert!(report.findings.is_empty());
    }

    #[test]
    fn bound_directories_remain_allowlisted_after_restart() {
        let (root, runtime) = runtime();
        let project = root.path().join("persisted-project");
        std::fs::create_dir(&project).unwrap();
        runtime
            .bind_project_directory(&BindProjectInput {
                space_id: "space-persisted".into(),
                path: project.to_string_lossy().into(),
            })
            .unwrap();
        drop(runtime);

        let restarted = Runtime::new(
            &root.path().join("state.db"),
            root.path().into(),
            None,
            Arc::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let report = restarted
            .scan_local_package(&PathInput {
                path: project.to_string_lossy().into(),
            })
            .unwrap();
        assert_eq!(report.files, 0);
    }
}
