use crate::database::{Database, LocalProjectBindingRow};
use crate::files::{InstallPlan, PlannedWrite};
use crate::paths::PathPolicy;
use crate::{RuntimeError, RuntimeResult};
use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::cell::Cell;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

const MAX_FILE_BYTES: u64 = 256_000;
const MAX_TOTAL_BYTES: u64 = 4_000_000;
const MAX_FILES: usize = 1_000;
const SCAN_ENGINE_VERSION: &str = "project-context-1.0.0";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindProjectInput {
    pub space_id: String,
    pub path: String,
    pub agents: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSpaceInput {
    pub space_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBindingInput {
    pub local_binding_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPackageInput {
    pub local_binding_id: String,
    pub selected_paths: Vec<String>,
    pub agents: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProjectionInput {
    pub local_binding_id: String,
    pub selected_paths: Vec<String>,
    pub adapter_id: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectBinding {
    pub local_binding_id: String,
    pub space_id: String,
    pub local_path: String,
    pub agents: Vec<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryEntry {
    pub relative_path: String,
    pub size_bytes: u64,
    pub eligible: bool,
    pub ignore_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreReason {
    pub reason: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInventory {
    pub local_binding_id: String,
    pub status: String,
    pub entries: Vec<InventoryEntry>,
    pub eligible_files: usize,
    pub eligible_bytes: u64,
    pub ignored: Vec<IgnoreReason>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextPackageExport {
    pub digest: String,
    pub selection_digest: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub agents: Vec<String>,
    pub scan_engine_version: String,
    pub scanned_at: String,
    pub archive_base64: String,
}

pub struct ProjectEngine {
    policy: PathPolicy,
}

impl ProjectEngine {
    pub fn new(policy: PathPolicy) -> Self {
        Self { policy }
    }

    pub fn bind(&self, database: &Database, input: &BindProjectInput) -> RuntimeResult<LocalProjectBinding> {
        validate_id(&input.space_id)?;
        let agents = normalize_agents(input.agents.clone().unwrap_or_else(|| vec!["codex".into()]))?;
        let canonical = self.policy.add_root(PathBuf::from(&input.path))?;
        let row = database.bind_project_path(
            &Uuid::new_v4().to_string(),
            &input.space_id,
            &canonical.to_string_lossy(),
            &agents,
            &now(),
        )?;
        Ok(binding(row))
    }

    pub fn list(&self, database: &Database, space_id: Option<&str>) -> RuntimeResult<Vec<LocalProjectBinding>> {
        if let Some(space_id) = space_id { validate_id(space_id)?; }
        database.project_bindings(space_id).map(|rows| rows.into_iter().map(binding).collect())
    }

    pub fn remove(&self, database: &Database, local_binding_id: &str) -> RuntimeResult<()> {
        validate_uuid(local_binding_id)?;
        database.remove_project_binding(local_binding_id, &now())
    }

    pub fn inventory(&self, database: &Database, local_binding_id: &str) -> RuntimeResult<ProjectInventory> {
        let row = self.find(database, local_binding_id)?;
        let root = PathBuf::from(&row.local_path);
        if row.status != "active" || !root.is_dir() {
            return Ok(ProjectInventory {
                local_binding_id: row.local_binding_id,
                status: "missing".into(),
                entries: Vec::new(),
                eligible_files: 0,
                eligible_bytes: 0,
                ignored: Vec::new(),
            });
        }
        self.policy.add_root(root.clone())?;
        let mut entries = Vec::new();
        let mut reasons = BTreeMap::<String, usize>::new();
        let ignored_directories = Cell::new(0usize);
        let mut eligible_files = 0usize;
        let mut eligible_bytes = 0u64;
        for item in WalkDir::new(&root).follow_links(false).into_iter().filter_entry(|entry| {
            if entry.depth() == 0 { return true; }
            let ignored = entry.file_type().is_dir() && ignored_component(entry.file_name().to_string_lossy().as_ref());
            if ignored { ignored_directories.set(ignored_directories.get() + 1); }
            !ignored
        }) {
            let item = item.map_err(|_| RuntimeError::TransactionFailed)?;
            if item.path_is_symlink() { return Err(RuntimeError::SymlinkRejected); }
            if !item.file_type().is_file() { continue; }
            let relative = normalized_relative(&root, item.path())?;
            let size = item.metadata().map_err(|_| RuntimeError::TransactionFailed)?.len();
            let mut reason = file_rejection(item.path(), size);
            if reason.is_none() {
                let bytes = std::fs::read(item.path()).map_err(|_| RuntimeError::TransactionFailed)?;
                if std::str::from_utf8(&bytes).is_err() { reason = Some("non-text".into()); }
            }
            if reason.is_none() && eligible_files >= MAX_FILES { reason = Some("file-count-limit".into()); }
            if reason.is_none() && eligible_bytes.saturating_add(size) > MAX_TOTAL_BYTES {
                reason = Some("total-size-limit".into());
            }
            if let Some(reason) = &reason {
                *reasons.entry(reason.clone()).or_default() += 1;
            } else {
                eligible_files += 1;
                eligible_bytes += size;
            }
            entries.push(InventoryEntry { relative_path: relative, size_bytes: size, eligible: reason.is_none(), ignore_reason: reason });
        }
        if ignored_directories.get() > 0 {
            reasons.insert("default-ignore".into(), ignored_directories.get());
        }
        entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        Ok(ProjectInventory {
            local_binding_id: row.local_binding_id,
            status: "active".into(),
            entries,
            eligible_files,
            eligible_bytes,
            ignored: reasons.into_iter().map(|(reason, count)| IgnoreReason { reason, count }).collect(),
        })
    }

    pub fn package(&self, database: &Database, input: &ContextPackageInput) -> RuntimeResult<ContextPackageExport> {
        let agents = normalize_agents(input.agents.clone())?;
        let selected = self.selected_files(database, &input.local_binding_id, &input.selected_paths)?;
        let secret = secret_regex()?;
        let mut total_bytes = 0u64;
        let mut selection_hash = Sha256::new();
        let mut archive_files = Vec::new();
        for (relative, bytes) in &selected {
            let text = std::str::from_utf8(bytes).map_err(|_| RuntimeError::InvalidInput)?;
            if secret.is_match(text) { return Err(RuntimeError::SensitiveContent); }
            total_bytes += bytes.len() as u64;
            selection_hash.update((relative.len() as u32).to_be_bytes());
            selection_hash.update(relative.as_bytes());
            selection_hash.update(Sha256::digest(bytes));
            archive_files.push((format!("context/{relative}"), bytes.clone()));
        }
        let selection_digest = hex::encode(selection_hash.finalize());
        let scanned_at = now_iso8601();
        let manifest = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": "capaport.io/project-context/v1",
            "localBindingId": input.local_binding_id,
            "selectionDigest": selection_digest,
            "fileCount": selected.len(),
            "totalBytes": total_bytes,
            "agents": agents,
            "scan": { "status": "passed", "engineVersion": SCAN_ENGINE_VERSION, "scannedAt": scanned_at }
        })).map_err(|_| RuntimeError::InvalidInput)?;
        archive_files.push(("context.json".into(), manifest));
        archive_files.sort_by(|left, right| left.0.cmp(&right.0));
        let archive = build_zip(&archive_files)?;
        Ok(ContextPackageExport {
            digest: hex::encode(Sha256::digest(&archive)),
            selection_digest,
            file_count: selected.len(),
            total_bytes,
            agents,
            scan_engine_version: SCAN_ENGINE_VERSION.into(),
            scanned_at,
            archive_base64: base64::engine::general_purpose::STANDARD.encode(archive),
        })
    }

    pub fn projection(&self, database: &Database, input: &ProjectProjectionInput) -> RuntimeResult<InstallPlan> {
        let agent = normalize_agents(vec![input.adapter_id.clone()])?.remove(0);
        let row = self.find(database, &input.local_binding_id)?;
        if !row.agents.contains(&agent) { return Err(RuntimeError::InvalidInput); }
        let selected = self.selected_files(database, &input.local_binding_id, &input.selected_paths)?;
        let package = self.package(database, &ContextPackageInput {
            local_binding_id: input.local_binding_id.clone(),
            selected_paths: input.selected_paths.clone(),
            agents: vec![agent.clone()],
        })?;
        let root = Path::new(&input.root_path).canonicalize().map_err(|_| RuntimeError::PathNotAllowed)?;
        if !self.policy.roots().contains(&root) { return Err(RuntimeError::PathNotAllowed); }
        let mut writes = match agent.as_str() {
            "codex" => vec![shared_context_write(
                &root,
                "AGENTS.md",
                &row.space_id,
                &row.local_binding_id,
                &selected,
            )?],
            "gemini-cli" => vec![shared_context_write(
                &root,
                "GEMINI.md",
                &row.space_id,
                &row.local_binding_id,
                &selected,
            )?],
            "claude-code" => selected
                .iter()
                .map(|(relative, bytes)| {
                    native_context_write(
                        format!(
                            ".claude/rules/capaport/{}/{}/{}.md",
                            row.space_id, row.local_binding_id, relative
                        ),
                        format!("# CapaPort context: {relative}\n\n{}", String::from_utf8_lossy(bytes)),
                    )
                })
                .collect(),
            "cursor" => selected
                .iter()
                .map(|(relative, bytes)| {
                    native_context_write(
                        format!(
                            ".cursor/rules/capaport/{}/{}/{}.mdc",
                            row.space_id, row.local_binding_id, relative
                        ),
                        format!(
                            "---\ndescription: CapaPort managed project context\nalwaysApply: true\n---\n\n{}",
                            String::from_utf8_lossy(bytes)
                        ),
                    )
                })
                .collect(),
            _ => return Err(RuntimeError::InvalidInput),
        };
        let capability_slug = format!("project-{}", row.space_id);
        if let Some(lock_json) = database.load_lock(&agent, &capability_slug, &root.to_string_lossy())? {
            let lock: serde_json::Value = serde_json::from_str(&lock_json).map_err(|_| RuntimeError::InvalidInput)?;
            if let Some(files) = lock.get("files").and_then(serde_json::Value::as_array) {
                for write in &mut writes {
                    if write.expected_digest.is_some() {
                        continue;
                    }
                    write.expected_digest = files.iter().find_map(|file| {
                        (file.get("relative_path").or_else(|| file.get("relativePath"))?.as_str()?
                            == write.relative_path)
                            .then(|| {
                                file.get("after_digest")
                                    .or_else(|| file.get("afterDigest"))?
                                    .as_str()
                                    .map(str::to_owned)
                            })
                            .flatten()
                    });
                }
            }
        }
        Ok(InstallPlan {
            transaction_id: Uuid::new_v4().to_string(),
            adapter_id: agent,
            capability_slug,
            package_digest: package.digest,
            root_path: root.to_string_lossy().into(),
            writes,
        })
    }

    fn find(&self, database: &Database, local_binding_id: &str) -> RuntimeResult<LocalProjectBindingRow> {
        validate_uuid(local_binding_id)?;
        database.project_bindings(None)?.into_iter().find(|row| row.local_binding_id == local_binding_id).ok_or(RuntimeError::NotFound)
    }

    fn selected_files(
        &self,
        database: &Database,
        local_binding_id: &str,
        selected_paths: &[String],
    ) -> RuntimeResult<Vec<(String, Vec<u8>)>> {
        if selected_paths.is_empty() || selected_paths.len() > MAX_FILES { return Err(RuntimeError::InvalidInput); }
        let row = self.find(database, local_binding_id)?;
        if row.status != "active" { return Err(RuntimeError::NotFound); }
        let root = PathBuf::from(&row.local_path);
        if !root.is_dir() { return Err(RuntimeError::NotFound); }
        self.policy.add_root(root.clone())?;
        let inventory = self.inventory(database, local_binding_id)?;
        let mut normalized = selected_paths.to_vec();
        normalized.sort();
        normalized.dedup();
        if normalized.len() != selected_paths.len() { return Err(RuntimeError::InvalidInput); }
        let mut total = 0u64;
        let mut result = Vec::new();
        for relative in normalized {
            let entry = inventory.entries.iter().find(|entry| entry.relative_path == relative && entry.eligible).ok_or(RuntimeError::SourceTreeRejected)?;
            let path = self.policy.resolve(&root, Path::new(&relative))?;
            let bytes = std::fs::read(path).map_err(|_| RuntimeError::TransactionFailed)?;
            if bytes.len() as u64 != entry.size_bytes || file_rejection(Path::new(&relative), bytes.len() as u64).is_some() {
                return Err(RuntimeError::SourceTreeRejected);
            }
            total += bytes.len() as u64;
            if total > MAX_TOTAL_BYTES { return Err(RuntimeError::InvalidInput); }
            result.push((relative, bytes));
        }
        Ok(result)
    }
}

fn native_context_write(relative_path: String, content: String) -> PlannedWrite {
    let bytes = content.into_bytes();
    PlannedWrite {
        relative_path,
        content_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        content_digest: hex::encode(Sha256::digest(&bytes)),
        expected_digest: None,
    }
}

fn shared_context_write(
    root: &Path,
    file_name: &str,
    space_id: &str,
    local_binding_id: &str,
    selected: &[(String, Vec<u8>)],
) -> RuntimeResult<PlannedWrite> {
    let path = root.join(file_name);
    let current = if path.exists() {
        Some(std::fs::read(&path).map_err(|_| RuntimeError::TransactionFailed)?)
    } else {
        None
    };
    let current_text = current
        .as_deref()
        .map(|bytes| std::str::from_utf8(bytes).map(str::to_owned).map_err(|_| RuntimeError::InvalidInput))
        .transpose()?
        .unwrap_or_default();
    let marker = format!("{space_id}:{local_binding_id}");
    let start = format!("<!-- CAPAPORT:BEGIN {marker} -->");
    let end = format!("<!-- CAPAPORT:END {marker} -->");
    let mut managed = format!("{start}\n## CapaPort project context\n");
    for (relative, bytes) in selected {
        let text = std::str::from_utf8(bytes).map_err(|_| RuntimeError::InvalidInput)?;
        managed.push_str(&format!("\n### Source: `{relative}`\n\n{text}\n"));
    }
    managed.push_str(&format!("{end}\n"));
    let content = replace_managed_block(&current_text, &start, &end, &managed)?;
    let bytes = content.into_bytes();
    Ok(PlannedWrite {
        relative_path: file_name.into(),
        content_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        content_digest: hex::encode(Sha256::digest(&bytes)),
        expected_digest: current.as_ref().map(|bytes| hex::encode(Sha256::digest(bytes))),
    })
}

fn replace_managed_block(current: &str, start: &str, end: &str, managed: &str) -> RuntimeResult<String> {
    match (current.find(start), current.find(end)) {
        (Some(start_index), Some(end_index)) if end_index >= start_index => {
            let suffix_index = end_index + end.len();
            let mut output = String::with_capacity(current.len() + managed.len());
            output.push_str(&current[..start_index]);
            output.push_str(managed);
            output.push_str(current[suffix_index..].trim_start_matches(['\r', '\n']));
            Ok(output)
        }
        (None, None) => {
            let separator = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
            Ok(format!("{current}{separator}{managed}"))
        }
        _ => Err(RuntimeError::InvalidInput),
    }
}

fn binding(row: LocalProjectBindingRow) -> LocalProjectBinding {
    let status = if row.status == "active" && !Path::new(&row.local_path).is_dir() { "missing".into() } else { row.status.clone() };
    LocalProjectBinding {
        local_binding_id: row.local_binding_id,
        space_id: row.space_id,
        local_path: row.local_path,
        agents: row.agents,
        status,
        created_at: row.created_at,
    }
}

fn normalize_agents(mut agents: Vec<String>) -> RuntimeResult<Vec<String>> {
    agents.sort();
    agents.dedup();
    if agents.is_empty() || agents.len() > 4 || agents.iter().any(|agent| !matches!(agent.as_str(), "codex" | "claude-code" | "cursor" | "gemini-cli")) {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(agents)
}

fn validate_id(value: &str) -> RuntimeResult<()> {
    if value.is_empty()
        || value.len() > 120
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Err(RuntimeError::InvalidInput)
    } else {
        Ok(())
    }
}
fn validate_uuid(value: &str) -> RuntimeResult<()> { Uuid::parse_str(value).map(|_| ()).map_err(|_| RuntimeError::InvalidInput) }
fn normalized_relative(root: &Path, path: &Path) -> RuntimeResult<String> {
    let relative = path.strip_prefix(root).map_err(|_| RuntimeError::PathNotAllowed)?;
    if relative.components().any(|component| !matches!(component, Component::Normal(_))) { return Err(RuntimeError::PathNotAllowed); }
    Ok(relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
}
fn ignored_component(value: &str) -> bool {
    matches!(value, ".git" | ".capaport" | "node_modules" | "vendor" | "target" | "dist" | "build" | ".next" | "coverage" | "__pycache__")
}
fn file_rejection(path: &Path, size: u64) -> Option<String> {
    if size == 0 { return Some("empty".into()); }
    if size > MAX_FILE_BYTES { return Some("file-size-limit".into()); }
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    if matches!(name.as_str(), ".env" | ".npmrc" | ".pypirc" | "id_rsa" | "id_ed25519") { return Some("sensitive-file".into()); }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(extension.as_str(), "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "rb" | "go" | "rs" | "java" | "kt" | "swift" | "c" | "h" | "cpp" | "cs" | "php" | "vue" | "svelte" | "sql" | "sh" | "ps1") {
        return Some("source-code".into());
    }
    let allowed = matches!(extension.as_str(), "md" | "mdx" | "txt" | "yaml" | "yml" | "json" | "toml") || matches!(name.as_str(), "agents.md" | "claude.md" | "gemini.md" | ".cursorrules");
    if !allowed { return Some("unsupported-type".into()); }
    None
}
fn secret_regex() -> RuntimeResult<Regex> {
    Regex::new(r"(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s]{8,})").map_err(|_| RuntimeError::InvalidInput)
}
fn build_zip(files: &[(String, Vec<u8>)]) -> RuntimeResult<Vec<u8>> {
    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o644);
    for (path, bytes) in files {
        writer.start_file(path, options).map_err(|_| RuntimeError::TransactionFailed)?;
        writer.write_all(bytes).map_err(|_| RuntimeError::TransactionFailed)?;
    }
    writer.finish().map(|cursor| cursor.into_inner()).map_err(|_| RuntimeError::TransactionFailed)
}
fn now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    format!("{:020}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis())
}
fn now_iso8601() -> String {
    // The cloud validates RFC 3339. Unix seconds are formatted without relying on a platform clock crate.
    let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    time_from_unix(seconds)
}
fn time_from_unix(seconds: u64) -> String {
    // Civil date conversion by Howard Hinnant, UTC only.
    let days = (seconds / 86_400) as i64;
    let day_seconds = seconds % 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", day_seconds / 3600, (day_seconds % 3600) / 60, day_seconds % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture() -> (tempfile::TempDir, Database, PathPolicy, LocalProjectBinding) {
        let directory = tempdir().unwrap();
        let project = directory.path().join("project");
        std::fs::create_dir_all(project.join("docs")).unwrap();
        std::fs::create_dir_all(project.join("src")).unwrap();
        std::fs::create_dir_all(project.join("node_modules/pkg")).unwrap();
        std::fs::write(project.join("README.md"), "# Safe context").unwrap();
        std::fs::write(project.join("docs/rules.yaml"), "review: required").unwrap();
        std::fs::write(project.join("src/index.ts"), "export const secret = 1").unwrap();
        std::fs::write(project.join("node_modules/pkg/readme.md"), "ignored").unwrap();
        let database = Database::open(&directory.path().join("state.db")).unwrap();
        let policy = PathPolicy::new([]).unwrap();
        let engine = ProjectEngine::new(policy.clone());
        let binding = engine.bind(&database, &BindProjectInput {
            space_id: "project-a".into(),
            path: project.to_string_lossy().into(),
            agents: Some(vec!["codex".into(), "claude-code".into(), "cursor".into(), "gemini-cli".into()]),
        }).unwrap();
        (directory, database, policy, binding)
    }

    #[test]
    fn inventories_bounded_context_and_rejects_source_trees() {
        let (_directory, database, policy, binding) = fixture();
        let engine = ProjectEngine::new(policy);
        let inventory = engine.inventory(&database, &binding.local_binding_id).unwrap();
        assert_eq!(inventory.eligible_files, 2);
        assert_eq!(inventory.entries.iter().find(|entry| entry.relative_path == "src/index.ts").unwrap().ignore_reason.as_deref(), Some("source-code"));
        assert!(inventory.ignored.iter().any(|item| item.reason == "default-ignore"));
        let rejected = engine.package(&database, &ContextPackageInput {
            local_binding_id: binding.local_binding_id,
            selected_paths: vec!["src/index.ts".into()],
            agents: vec!["codex".into()],
        });
        assert!(matches!(rejected, Err(RuntimeError::SourceTreeRejected)));
    }

    #[test]
    fn rejects_space_identifiers_that_could_escape_native_projection_paths() {
        let directory = tempdir().unwrap();
        let project = directory.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let database = Database::open(&directory.path().join("state.db")).unwrap();
        let engine = ProjectEngine::new(PathPolicy::new([]).unwrap());

        assert!(matches!(
            engine.bind(&database, &BindProjectInput {
                space_id: "../escape".into(),
                path: project.to_string_lossy().into(),
                agents: Some(vec!["cursor".into()]),
            }),
            Err(RuntimeError::InvalidInput)
        ));
    }

    #[test]
    fn packages_only_explicit_selection_and_rescans_secrets() {
        let (directory, database, policy, binding) = fixture();
        let engine = ProjectEngine::new(policy);
        let package = engine.package(&database, &ContextPackageInput {
            local_binding_id: binding.local_binding_id.clone(),
            selected_paths: vec!["README.md".into()],
            agents: vec!["codex".into()],
        }).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(package.archive_base64).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert!(archive.by_name("context/README.md").is_ok());
        assert!(archive.by_name("context/docs/rules.yaml").is_err());
        std::fs::write(directory.path().join("project/README.md"), "api_key=very-private-value").unwrap();
        assert!(matches!(engine.package(&database, &ContextPackageInput {
            local_binding_id: binding.local_binding_id,
            selected_paths: vec!["README.md".into()],
            agents: vec!["codex".into()],
        }), Err(RuntimeError::SensitiveContent)));
    }

    #[test]
    fn projects_to_all_adapters_and_recovers_a_removed_directory() {
        let (directory, database, policy, binding) = fixture();
        for (agent, expected) in [("codex", "AGENTS.md"), ("claude-code", ".claude/rules/capaport"), ("cursor", ".cursor/rules/capaport"), ("gemini-cli", "GEMINI.md")] {
            let target = directory.path().join(agent);
            std::fs::create_dir(&target).unwrap();
            if agent == "codex" {
                std::fs::write(target.join("AGENTS.md"), "# Existing project instructions\n").unwrap();
            }
            policy.add_root(target.clone()).unwrap();
            let plan = ProjectEngine::new(policy.clone()).projection(&database, &ProjectProjectionInput {
                local_binding_id: binding.local_binding_id.clone(),
                selected_paths: vec!["README.md".into()],
                adapter_id: agent.into(),
                root_path: target.to_string_lossy().into(),
            }).unwrap();
            assert!(plan.writes.iter().any(|write| write.relative_path.starts_with(expected)));
            if agent == "cursor" {
                assert!(plan.writes.iter().all(|write| write.relative_path.ends_with(".mdc")));
                let content = base64::engine::general_purpose::STANDARD.decode(&plan.writes[0].content_base64).unwrap();
                assert!(String::from_utf8(content).unwrap().contains("alwaysApply: true"));
            }
            if agent == "codex" {
                let content = base64::engine::general_purpose::STANDARD.decode(&plan.writes[0].content_base64).unwrap();
                let content = String::from_utf8(content).unwrap();
                assert!(content.contains("# Existing project instructions"));
                assert!(content.contains("<!-- CAPAPORT:BEGIN project-a:"));
                assert!(plan.writes[0].expected_digest.is_some());
            }
        }
        std::fs::remove_dir_all(directory.path().join("project")).unwrap();
        let engine = ProjectEngine::new(policy);
        assert_eq!(engine.list(&database, Some("project-a")).unwrap()[0].status, "missing");
        engine.remove(&database, &binding.local_binding_id).unwrap();
        assert_eq!(engine.list(&database, Some("project-a")).unwrap()[0].status, "removed");
    }
}
