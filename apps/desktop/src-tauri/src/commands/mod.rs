use crate::credentials::CredentialStore;
use crate::database::{Database, SyncQueueStatus};
use crate::files::{
    ApplyResult, FileEngine, InstallPlan, InstallPreview, PlannedRemoval, UninstallPlan,
    validate_identifier,
};
use crate::paths::PathPolicy;
use crate::projects::{
    BindProjectInput, ContextPackageExport, ContextPackageInput, LocalProjectBinding,
    ProjectBindingInput, ProjectEngine, ProjectInventory, ProjectProjectionInput,
    ProjectSpaceInput,
};
use crate::skill_discovery::{
    DiscoveryIssue, SkillSourceKind, TrustedSkillRoot, discover_skill_packages,
};
use crate::{RuntimeError, RuntimeResult};
use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
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
pub struct DiscoveredLocalSkill {
    pub adapter_id: String,
    pub display_name: String,
    pub scope: String,
    pub source_kind: String,
    pub linked: bool,
    pub source_path: String,
    pub slug: String,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkillDiscoveryResult {
    pub skills: Vec<DiscoveredLocalSkill>,
    pub issues: Vec<DiscoveryIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFinding {
    pub rule: String,
    pub severity: String,
    pub relative_path: String,
    pub evidence_digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalScanReport {
    pub files: usize,
    pub bytes: u64,
    pub findings: Vec<ScanFinding>,
    pub blocked: bool,
    pub requires_confirmation: bool,
}

fn redacted_finding(
    rule: &str,
    severity: &str,
    relative_path: &str,
    evidence: &[u8],
) -> ScanFinding {
    ScanFinding {
        rule: rule.into(),
        severity: severity.into(),
        relative_path: relative_path.into(),
        evidence_digest: hex::encode(Sha256::digest(evidence)),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPackageExport {
    pub file_name: String,
    pub size_bytes: usize,
    pub sha256: String,
    pub archive_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecureSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: Option<u64>,
    pub organization_id: Option<String>,
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
pub struct QueueWriteInput {
    pub id: String,
    pub operation: String,
    pub payload_json: String,
    pub idempotency_key: String,
    pub available_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueClaimInput {
    pub now: String,
    pub limit: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItemInput {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRescheduleInput {
    pub id: String,
    pub error_code: String,
    pub available_at: String,
    pub permanently_failed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRetryFailedInput {
    pub now: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedFileInput {
    pub root_path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedFileContent {
    pub content_base64: String,
    pub digest: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPackageInput {
    pub adapter_id: String,
    pub root_path: String,
    pub component_type: String,
    pub slug: String,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallInput {
    pub adapter_id: String,
    pub capability_slug: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLockFile {
    pub relative_path: String,
    pub before_digest: Option<String>,
    pub after_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLock {
    pub schema_version: String,
    pub adapter_id: String,
    pub capability_slug: String,
    pub package_digest: String,
    pub transaction_id: String,
    pub files: Vec<InstallLockFile>,
}

pub struct Runtime {
    database: Database,
    engine: FileEngine,
    discovery_policy: PathPolicy,
    projects: ProjectEngine,
    home_dir: PathBuf,
    project_root: Option<PathBuf>,
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
            engine: FileEngine::new(policy.clone()),
            discovery_policy: PathPolicy::new([])?,
            projects: ProjectEngine::new(policy),
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
        for binding in self.database.project_bindings(None)? {
            if binding.status != "active" {
                continue;
            }
            let project = PathBuf::from(binding.local_path);
            for (adapter_id, display_name, directory) in agent_directories() {
                if !binding.agents.iter().any(|agent| agent == adapter_id) {
                    continue;
                }
                let root = project.join(directory);
                if !root.is_dir() {
                    continue;
                }
                let root_path = root
                    .canonicalize()
                    .map_err(|_| RuntimeError::PathNotAllowed)?
                    .to_string_lossy()
                    .into_owned();
                if agents
                    .iter()
                    .any(|agent: &AgentDescriptor| agent.root_path == root_path)
                {
                    continue;
                }
                agents.push(AgentDescriptor {
                    adapter_id: adapter_id.into(),
                    display_name: display_name.into(),
                    scope: "workspace".into(),
                    root_path,
                });
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
        for (component_type, directory, extension) in component_formats(&input.adapter_id) {
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
                    continue;
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
                            != Some(extension)
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

    pub fn discover_local_skills(&self) -> RuntimeResult<LocalSkillDiscoveryResult> {
        let report = discover_skill_packages(&self.trusted_skill_roots());
        let mut issues = report.issues;
        let mut skills = Vec::new();
        let mut readable_roots = Vec::new();
        for package in report.packages {
            let digest = match package_digest(&package.package_root) {
                Ok(digest) => digest,
                Err(error) => {
                    issues.push(DiscoveryIssue {
                        path: package.package_root.to_string_lossy().into_owned(),
                        reason: if matches!(error, RuntimeError::SymlinkRejected) {
                            "package-symlink-escape".into()
                        } else {
                            "invalid-package".into()
                        },
                    });
                    continue;
                }
            };
            readable_roots.push(package.package_root.clone());
            skills.push(DiscoveredLocalSkill {
                adapter_id: package.adapter_id,
                display_name: package.display_name,
                scope: package.scope,
                source_kind: package.source_kind.as_str().into(),
                linked: package.linked,
                source_path: package.package_root.to_string_lossy().into_owned(),
                slug: package.slug,
                digest,
            });
        }
        self.discovery_policy.replace_roots(readable_roots)?;
        skills.sort_by(|left, right| {
            (&left.adapter_id, &left.slug, &left.source_path).cmp(&(
                &right.adapter_id,
                &right.slug,
                &right.source_path,
            ))
        });
        issues.sort_by(|left, right| (&left.reason, &left.path).cmp(&(&right.reason, &right.path)));
        Ok(LocalSkillDiscoveryResult { skills, issues })
    }

    fn trusted_skill_roots(&self) -> Vec<TrustedSkillRoot> {
        let mut roots = Vec::new();
        for (adapter_id, display_name, directory) in agent_directories() {
            let user_skills = self.home_dir.join(directory).join("skills");
            if user_skills.is_dir() {
                roots.push(TrustedSkillRoot::new(
                    adapter_id,
                    display_name,
                    "user",
                    if adapter_id == "codex" {
                        SkillSourceKind::Shared
                    } else {
                        SkillSourceKind::Global
                    },
                    user_skills,
                ));
            }
            if let Some(project_root) = &self.project_root {
                let workspace_skills = project_root.join(directory).join("skills");
                if workspace_skills.is_dir() {
                    roots.push(TrustedSkillRoot::new(
                        adapter_id,
                        display_name,
                        "workspace",
                        SkillSourceKind::Workspace,
                        workspace_skills,
                    ));
                }
            }
        }
        let codex_skills = self.home_dir.join(".codex/skills");
        if codex_skills.is_dir() {
            roots.push(TrustedSkillRoot::new(
                "codex",
                "Codex",
                "user",
                SkillSourceKind::Global,
                codex_skills,
            ));
        }
        let plugin_cache = self.home_dir.join(".codex/plugins/cache");
        if plugin_cache.is_dir() {
            for entry in WalkDir::new(&plugin_cache)
                .follow_links(false)
                .max_depth(8)
                .into_iter()
                .filter_map(Result::ok)
            {
                if entry.file_name() == "skills"
                    && (entry.file_type().is_dir() || entry.file_type().is_symlink())
                {
                    roots.push(TrustedSkillRoot::new(
                        "codex",
                        "Codex",
                        "user",
                        SkillSourceKind::Plugin,
                        entry.path().to_path_buf(),
                    ));
                }
            }
        }
        if let Ok(bindings) = self.database.project_bindings(None) {
            for binding in bindings.into_iter().filter(|binding| binding.status == "active") {
                for (adapter_id, display_name, directory) in agent_directories() {
                    if !binding.agents.iter().any(|agent| agent == adapter_id) {
                        continue;
                    }
                    let skills = PathBuf::from(&binding.local_path).join(directory).join("skills");
                    if skills.is_dir() {
                        roots.push(TrustedSkillRoot::new(
                            adapter_id,
                            display_name,
                            "workspace",
                            SkillSourceKind::Workspace,
                            skills,
                        ));
                    }
                }
            }
        }
        roots.sort_by(|left, right| left.path.cmp(&right.path));
        roots.dedup_by(|left, right| left.path == right.path);
        roots
    }

    pub fn scan_local_package(&self, input: &PathInput) -> RuntimeResult<LocalScanReport> {
        let selected = Path::new(&input.path)
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        let managed_root = self
            .engine
            .policy()
            .roots()
            .into_iter()
            .find(|root| selected.starts_with(root));
        let selected = if let Some(root) = managed_root {
            let relative = selected
                .strip_prefix(&root)
                .map_err(|_| RuntimeError::PathNotAllowed)?;
            if relative.as_os_str().is_empty() {
                root
            } else {
                self.engine.policy().resolve(&root, relative)?
            }
        } else if self
            .discovery_policy
            .roots()
            .iter()
            .any(|root| root == &selected)
        {
            selected
        } else {
            return Err(RuntimeError::PathNotAllowed);
        };
        let secret = Regex::new(r"(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s]{8,})").map_err(|_| RuntimeError::InvalidInput)?;
        let personal = Regex::new(
            r"(?i)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?86[- ]?)?1[3-9][0-9]{9})",
        )
        .map_err(|_| RuntimeError::InvalidInput)?;
        let internal = Regex::new(r"(?i)(10(?:\.[0-9]{1,3}){3}|192\.168(?:\.[0-9]{1,3}){2}|172\.(?:1[6-9]|2[0-9]|3[01])(?:\.[0-9]{1,3}){2}|[a-z0-9.-]+\.internal)")
            .map_err(|_| RuntimeError::InvalidInput)?;
        let network = Regex::new(r"(?i)https?://[a-z0-9.-]+(?::[0-9]+)?")
            .map_err(|_| RuntimeError::InvalidInput)?;
        let mut report = LocalScanReport {
            files: 0,
            bytes: 0,
            findings: Vec::new(),
            blocked: false,
            requires_confirmation: false,
        };
        for file in safe_package_files(&selected)? {
            let metadata = file
                .source_path
                .metadata()
                .map_err(|_| RuntimeError::TransactionFailed)?;
            let relative_path = normalized_relative_path(&file.relative_path);
            let lower_path = relative_path.to_ascii_lowercase();
            let file_name = file
                .source_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if [
                ".env",
                ".env.local",
                "id_rsa",
                "id_ed25519",
                "credentials",
                "credentials.json",
            ]
            .contains(&file_name.as_str())
                || file_name.ends_with(".pem")
                || file_name.ends_with(".key")
            {
                report.findings.push(redacted_finding(
                    "SEC_SENSITIVE_FILE",
                    "high",
                    &relative_path,
                    relative_path.as_bytes(),
                ));
            }
            if [".bat", ".cmd", ".com", ".exe", ".msi", ".ps1", ".sh"]
                .iter()
                .any(|extension| file_name.ends_with(extension))
            {
                report.findings.push(redacted_finding(
                    "SEC_EXECUTABLE_FILE",
                    "medium",
                    &relative_path,
                    relative_path.as_bytes(),
                ));
            }
            if lower_path.starts_with("src/")
                || lower_path.starts_with("app/")
                || lower_path.starts_with("node_modules/")
                || lower_path.starts_with(".git/")
            {
                report.findings.push(redacted_finding(
                    "SEC_SOURCE_TREE",
                    "high",
                    &relative_path,
                    relative_path.as_bytes(),
                ));
            }
            if metadata.len() > 2_000_000 {
                report.findings.push(redacted_finding(
                    "SEC_OVERSIZED_FILE",
                    "high",
                    &relative_path,
                    format!("{relative_path}:{}", metadata.len()).as_bytes(),
                ));
                report.files += 1;
                report.bytes += metadata.len();
                continue;
            }
            report.files += 1;
            report.bytes += metadata.len();
            let content = std::fs::read(&file.source_path)
                .map_err(|_| RuntimeError::TransactionFailed)?;
            if let Ok(text) = std::str::from_utf8(&content) {
                for (rule, severity, matcher) in [
                    ("potential-secret", "high", &secret),
                    ("SEC_PERSONAL_DATA", "medium", &personal),
                    ("SEC_INTERNAL_ADDRESS", "high", &internal),
                    ("SEC_NETWORK_HOST", "medium", &network),
                ] {
                    if let Some(found) = matcher.find(text) {
                        report.findings.push(redacted_finding(
                            rule,
                            severity,
                            &relative_path,
                            found.as_str().as_bytes(),
                        ));
                    }
                }
            }
        }
        if report.bytes > 50_000_000 {
            report.findings.push(redacted_finding(
                "SEC_OVERSIZED_PACKAGE",
                "high",
                "[package]",
                report.bytes.to_string().as_bytes(),
            ));
        }
        report
            .findings
            .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        report.blocked = report
            .findings
            .iter()
            .any(|finding| finding.severity == "high" || finding.severity == "critical");
        report.requires_confirmation = report
            .findings
            .iter()
            .any(|finding| finding.severity == "medium");
        Ok(report)
    }

    pub fn read_managed_file(&self, input: &ManagedFileInput) -> RuntimeResult<ManagedFileContent> {
        let root = Path::new(&input.root_path)
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        if !self
            .engine
            .policy()
            .roots()
            .iter()
            .any(|allowed| allowed == &root)
        {
            return Err(RuntimeError::PathNotAllowed);
        }
        let path = self
            .engine
            .policy()
            .resolve(&root, Path::new(&input.relative_path))?;
        let metadata = path.metadata().map_err(|_| RuntimeError::NotFound)?;
        if !metadata.is_file() || metadata.len() > 2_000_000 {
            return Err(RuntimeError::InvalidInput);
        }
        let content = std::fs::read(path).map_err(|_| RuntimeError::TransactionFailed)?;
        Ok(ManagedFileContent {
            content_base64: base64::engine::general_purpose::STANDARD.encode(&content),
            digest: hex::encode(Sha256::digest(&content)),
        })
    }

    pub fn export_local_package(
        &self,
        input: &ExportPackageInput,
    ) -> RuntimeResult<LocalPackageExport> {
        validate_slug(&input.slug)?;
        let (component_directory, native_extension) = component_formats(&input.adapter_id)
            .iter()
            .find(|(component_type, _, _)| component_type == &input.component_type)
            .map(|(_, directory, extension)| (*directory, *extension))
            .ok_or(RuntimeError::InvalidInput)?;
        let root = Path::new(&input.root_path);
        let source = if let Some(source_path) = &input.source_path {
            if input.component_type != "skill" {
                return Err(RuntimeError::InvalidInput);
            }
            let source = Path::new(source_path)
                .canonicalize()
                .map_err(|_| RuntimeError::PathNotAllowed)?;
            if !self
                .discovery_policy
                .roots()
                .iter()
                .any(|allowed| allowed == &source)
            {
                return Err(RuntimeError::PathNotAllowed);
            }
            source
        } else {
            let source_relative = if input.component_type == "skill" {
                format!("{component_directory}/{}", input.slug)
            } else {
                format!("{component_directory}/{}.{native_extension}", input.slug)
            };
            self.engine
                .policy()
                .resolve(root, Path::new(&source_relative))?
        };
        if (input.component_type == "skill" && !source.is_dir())
            || (input.component_type != "skill" && !source.is_file())
        {
            return Err(RuntimeError::InvalidInput);
        }
        let canonical_root = match input.component_type.as_str() {
            "skill" => format!("skills/{}", input.slug),
            "prompt" => format!("prompts/{}.md", input.slug),
            "context" => format!("context/{}.md", input.slug),
            _ => return Err(RuntimeError::InvalidInput),
        };
        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        if source.is_file() {
            let native = std::fs::read(&source).map_err(|_| RuntimeError::TransactionFailed)?;
            files.push((
                canonical_root.clone(),
                canonical_component_content(&input.adapter_id, &input.component_type, native)?,
            ));
        } else {
            for file in safe_package_files(&source)? {
                let relative = normalized_relative_path(&file.relative_path);
                files.push((
                    format!("{canonical_root}/{relative}"),
                    std::fs::read(file.source_path)
                        .map_err(|_| RuntimeError::TransactionFailed)?,
                ));
            }
        }
        files.sort_by(|left, right| left.0.cmp(&right.0));
        let entrypoint = if input.component_type == "skill" {
            format!("{canonical_root}/SKILL.md")
        } else {
            canonical_root.clone()
        };
        if !files.iter().any(|(path, _)| path == &entrypoint) {
            return Err(RuntimeError::InvalidInput);
        }
        let manifest = format!(
            "schemaVersion: capaport.io/v1alpha1\nkind: CapabilityPackage\nmetadata:\n  slug: {slug}\n  name: {slug}\n  description: \"\"\n  tags: []\nspec:\n  components:\n    - type: {component_type}\n      path: {canonical_root}\n  compatibility:\n    agents:\n      - {adapter_id}\n  permissions:\n    filesystem: read-project\n    network: none\n  entrypoints:\n    default: {entrypoint}\n  dependencies: []\n",
            slug = input.slug,
            component_type = input.component_type,
            adapter_id = input.adapter_id,
        );
        let agent_name = agent_directories()
            .iter()
            .find(|(adapter_id, _, _)| adapter_id == &input.adapter_id)
            .map(|(_, display_name, _)| *display_name)
            .ok_or(RuntimeError::InvalidInput)?;
        let readme = format!(
            "# {slug}\n\nImported from {agent_name} by CapaPort.\n",
            slug = input.slug,
        );
        let mut package_files = vec![
            ("capaport.yaml".to_string(), manifest.into_bytes()),
            ("README.md".to_string(), readme.into_bytes()),
        ];
        package_files.extend(files);
        package_files.sort_by(|left, right| left.0.cmp(&right.0));
        let archive = build_zip(&package_files)?;
        let sha256 = hex::encode(Sha256::digest(&archive));
        Ok(LocalPackageExport {
            file_name: format!("{}.zip", input.slug),
            size_bytes: archive.len(),
            sha256,
            archive_base64: base64::engine::general_purpose::STANDARD.encode(archive),
        })
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
    pub fn load_install_lock(&self, input: &UninstallInput) -> RuntimeResult<Option<InstallLock>> {
        validate_identifier(&input.adapter_id)?;
        validate_slug(&input.capability_slug)?;
        let root = Path::new(&input.root_path)
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        if !self
            .engine
            .policy()
            .roots()
            .iter()
            .any(|allowed| allowed == &root)
        {
            return Err(RuntimeError::PathNotAllowed);
        }
        let canonical_root = root.to_string_lossy().into_owned();
        let mut lock =
            self.database
                .load_lock(&input.adapter_id, &input.capability_slug, &canonical_root)?;
        if lock.is_none() && canonical_root != input.root_path {
            lock = self.database.load_lock(
                &input.adapter_id,
                &input.capability_slug,
                &input.root_path,
            )?;
        }
        lock.map(|json| serde_json::from_str(&json).map_err(|_| RuntimeError::Database))
            .transpose()
    }
    pub fn uninstall(&self, input: &UninstallInput) -> RuntimeResult<ApplyResult> {
        validate_identifier(&input.adapter_id)?;
        validate_slug(&input.capability_slug)?;
        let root = Path::new(&input.root_path)
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        if !self
            .engine
            .policy()
            .roots()
            .iter()
            .any(|allowed| allowed == &root)
        {
            return Err(RuntimeError::PathNotAllowed);
        }
        let lock = self
            .load_install_lock(input)?
            .ok_or(RuntimeError::NotFound)?;
        let canonical_root = root.to_string_lossy().into_owned();
        self.database.normalize_lock_root(
            &input.adapter_id,
            &input.capability_slug,
            &input.root_path,
            &canonical_root,
        )?;
        self.engine.uninstall(
            &UninstallPlan {
                transaction_id: format!("uninstall-{}", Uuid::new_v4()),
                adapter_id: input.adapter_id.clone(),
                capability_slug: input.capability_slug.clone(),
                root_path: canonical_root,
                files: lock
                    .files
                    .into_iter()
                    .map(|file| PlannedRemoval {
                        relative_path: file.relative_path,
                        expected_digest: file.after_digest,
                    })
                    .collect(),
            },
            &self.database,
        )
    }
    pub fn bind_project_directory(
        &self,
        input: &BindProjectInput,
    ) -> RuntimeResult<LocalProjectBinding> {
        self.projects.bind(&self.database, input)
    }
    pub fn list_project_bindings(
        &self,
        input: &ProjectSpaceInput,
    ) -> RuntimeResult<Vec<LocalProjectBinding>> {
        self.projects.list(&self.database, Some(&input.space_id))
    }
    pub fn remove_project_binding(&self, input: &ProjectBindingInput) -> RuntimeResult<()> {
        self.projects
            .remove(&self.database, &input.local_binding_id)
    }
    pub fn inventory_project_context(
        &self,
        input: &ProjectBindingInput,
    ) -> RuntimeResult<ProjectInventory> {
        self.projects
            .inventory(&self.database, &input.local_binding_id)
    }
    pub fn export_project_context(
        &self,
        input: &ContextPackageInput,
    ) -> RuntimeResult<ContextPackageExport> {
        self.projects.package(&self.database, input)
    }
    pub fn project_context_plan(
        &self,
        input: &ProjectProjectionInput,
    ) -> RuntimeResult<InstallPlan> {
        self.projects.projection(&self.database, input)
    }
    pub fn sync_queue_status(&self) -> RuntimeResult<SyncQueueStatus> {
        self.database.queue_status()
    }

    pub fn enqueue_write(&self, input: &QueueWriteInput) -> RuntimeResult<()> {
        Uuid::parse_str(&input.id).map_err(|_| RuntimeError::InvalidInput)?;
        Uuid::parse_str(&input.idempotency_key).map_err(|_| RuntimeError::InvalidInput)?;
        if input.operation.is_empty()
            || input.operation.len() > 120
            || !input
                .operation
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
            || input.payload_json.len() > 2_000_000
            || serde_json::from_str::<serde_json::Value>(&input.payload_json).is_err()
        {
            return Err(RuntimeError::InvalidInput);
        }
        self.database.enqueue_retry(
            &input.id,
            &input.operation,
            &input.payload_json,
            &input.idempotency_key,
            &input.available_at,
            &input.available_at,
        )
    }

    pub fn claim_ready_writes(
        &self,
        input: &QueueClaimInput,
    ) -> RuntimeResult<Vec<crate::database::RetryOperation>> {
        self.database
            .claim_ready_retries(&input.now, input.limit.min(100))
    }

    pub fn complete_write(&self, input: &QueueItemInput) -> RuntimeResult<()> {
        self.database.complete_retry(&input.id)
    }

    pub fn reschedule_write(&self, input: &QueueRescheduleInput) -> RuntimeResult<()> {
        self.database.reschedule_retry(
            &input.id,
            &input.error_code,
            &input.available_at,
            &input.available_at,
            input.permanently_failed,
        )
    }

    pub fn retry_failed_writes(&self, input: &QueueRetryFailedInput) -> RuntimeResult<()> {
        self.database.retry_failed(&input.now)
    }

    pub fn store_session(&self, session: &SecureSession) -> RuntimeResult<()> {
        validate_session(session)?;
        let value = serde_json::to_string(session).map_err(|_| RuntimeError::InvalidInput)?;
        self.credentials.set("authenticated-session", &value)
    }

    pub fn load_session(&self) -> RuntimeResult<Option<SecureSession>> {
        self.credentials
            .get("authenticated-session")?
            .map(|value| {
                let session = serde_json::from_str::<SecureSession>(&value)
                    .map_err(|_| RuntimeError::CredentialStore)?;
                validate_session(&session)?;
                Ok(session)
            })
            .transpose()
    }

    pub fn clear_session(&self) -> RuntimeResult<()> {
        self.credentials.delete("authenticated-session")
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
fn component_formats(adapter_id: &str) -> &'static [(&'static str, &'static str, &'static str)] {
    match adapter_id {
        "codex" => &[("skill", "skills", "")],
        "gemini-cli" => &[("skill", "skills", ""), ("prompt", "commands", "toml")],
        "claude-code" => &[
            ("skill", "skills", ""),
            ("prompt", "commands", "md"),
            ("context", "rules", "md"),
        ],
        "cursor" => &[
            ("skill", "skills", ""),
            ("prompt", "commands", "md"),
            ("context", "rules", "mdc"),
        ],
        _ => &[],
    }
}

fn canonical_component_content(
    adapter_id: &str,
    component_type: &str,
    native: Vec<u8>,
) -> RuntimeResult<Vec<u8>> {
    if adapter_id == "gemini-cli" && component_type == "prompt" {
        let text = std::str::from_utf8(&native).map_err(|_| RuntimeError::InvalidInput)?;
        let document =
            toml::from_str::<toml::Table>(text).map_err(|_| RuntimeError::InvalidInput)?;
        return document
            .get("prompt")
            .and_then(toml::Value::as_str)
            .map(|prompt| prompt.as_bytes().to_vec())
            .ok_or(RuntimeError::InvalidInput);
    }
    if adapter_id == "cursor" && component_type == "context" {
        let text = std::str::from_utf8(&native).map_err(|_| RuntimeError::InvalidInput)?;
        let body = Regex::new(r"(?s)\A---\r?\n.*?\r?\n---\r?\n?")
            .map_err(|_| RuntimeError::InvalidInput)?
            .replace(text, "");
        return Ok(body.as_bytes().to_vec());
    }
    Ok(native)
}

#[derive(Debug)]
struct PackageFile {
    relative_path: PathBuf,
    source_path: PathBuf,
}

fn safe_package_files(source: &Path) -> RuntimeResult<Vec<PackageFile>> {
    let canonical_source = source
        .canonicalize()
        .map_err(|_| RuntimeError::PathNotAllowed)?;
    if canonical_source.is_file() {
        return Ok(vec![PackageFile {
            relative_path: canonical_source
                .file_name()
                .map(PathBuf::from)
                .ok_or(RuntimeError::InvalidInput)?,
            source_path: canonical_source,
        }]);
    }
    if !canonical_source.is_dir() {
        return Err(RuntimeError::InvalidInput);
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(&canonical_source)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| !ignored(entry.path()))
    {
        let entry = entry.map_err(|error| {
            if error.loop_ancestor().is_some() || error.io_error().is_some() {
                RuntimeError::SymlinkRejected
            } else {
                RuntimeError::TransactionFailed
            }
        })?;
        let canonical_entry = entry
            .path()
            .canonicalize()
            .map_err(|_| RuntimeError::SymlinkRejected)?;
        if !canonical_entry.starts_with(&canonical_source) {
            return Err(RuntimeError::SymlinkRejected);
        }
        if !canonical_entry.is_file() {
            continue;
        }
        let relative_path = entry
            .path()
            .strip_prefix(&canonical_source)
            .map_err(|_| RuntimeError::PathNotAllowed)?
            .to_path_buf();
        files.push(PackageFile {
            relative_path,
            source_path: canonical_entry,
        });
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

fn normalized_relative_path(relative: &Path) -> String {
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn package_digest(source: &Path) -> RuntimeResult<String> {
    let files = safe_package_files(source)?;
    let mut hash = Sha256::new();
    for file in files {
        let normalized = normalized_relative_path(&file.relative_path);
        let content =
            std::fs::read(&file.source_path).map_err(|_| RuntimeError::TransactionFailed)?;
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
            Some(".git" | ".capaport" | "node_modules" | "target" | "dist")
        )
    })
}

fn validate_slug(value: &str) -> RuntimeResult<()> {
    let valid = !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--");
    if valid {
        Ok(())
    } else {
        Err(RuntimeError::InvalidInput)
    }
}

fn validate_session(session: &SecureSession) -> RuntimeResult<()> {
    let valid_token =
        |value: &str| (40..=4096).contains(&value.len()) && !value.chars().any(char::is_whitespace);
    if !valid_token(&session.access_token) || !valid_token(&session.refresh_token) {
        return Err(RuntimeError::InvalidInput);
    }
    if session.organization_id.as_ref().is_some_and(|value| {
        value.is_empty() || value.len() > 120 || value.chars().any(char::is_whitespace)
    }) {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}

fn build_zip(files: &[(String, Vec<u8>)]) -> RuntimeResult<Vec<u8>> {
    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for (path, content) in files {
        writer
            .start_file(path, options)
            .map_err(|_| RuntimeError::TransactionFailed)?;
        writer
            .write_all(content)
            .map_err(|_| RuntimeError::TransactionFailed)?;
    }
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|_| RuntimeError::TransactionFailed)
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
                    path: project.to_string_lossy().into(),
                    agents: Some(vec!["codex".into()]),
                })
                .unwrap()
                .space_id,
            "space-1"
        );
        assert_eq!(runtime.sync_queue_status().unwrap().pending, 0);
    }

    #[test]
    fn detects_agent_directories_inside_persisted_project_bindings() {
        let root = tempdir().unwrap();
        let project = root.path().join("bound-project");
        std::fs::create_dir_all(project.join(".cursor/rules")).unwrap();
        std::fs::write(
            project.join(".cursor/rules/security.mdc"),
            "Always scan uploads",
        )
        .unwrap();
        let runtime = Runtime::new(
            &root.path().join("state.db"),
            root.path().join("empty-home"),
            None,
            Arc::new(MemoryCredentialStore::default()),
        );
        std::fs::create_dir_all(root.path().join("empty-home")).unwrap();
        let runtime = runtime.unwrap();
        runtime
            .bind_project_directory(&BindProjectInput {
                space_id: "space-1".into(),
                path: project.to_string_lossy().into(),
                agents: Some(vec!["cursor".into()]),
            })
            .unwrap();

        let agents = runtime.detect_agents().unwrap();

        assert!(agents.iter().any(|agent| {
            agent.adapter_id == "cursor"
                && agent.scope == "workspace"
                && agent.root_path.ends_with("bound-project/.cursor")
        }));
    }

    #[test]
    fn inventories_and_canonicalizes_cursor_mdc_and_gemini_toml() {
        use std::io::Read;

        let root = tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(".cursor/rules")).unwrap();
        std::fs::write(
            root.path().join(".cursor/rules/security.mdc"),
            "---\ndescription: Security\nalwaysApply: true\n---\n\nAlways scan uploads.",
        )
        .unwrap();
        std::fs::create_dir_all(root.path().join(".gemini/commands")).unwrap();
        std::fs::write(
            root.path().join(".gemini/commands/review.toml"),
            "description = \"Review\"\nprompt = \"Review for security.\"\n",
        )
        .unwrap();
        let runtime = Runtime::new(
            &root.path().join("state.db"),
            root.path().into(),
            None,
            Arc::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let agents = runtime.detect_agents().unwrap();
        let cursor = agents
            .iter()
            .find(|agent| agent.adapter_id == "cursor")
            .unwrap();
        let gemini = agents
            .iter()
            .find(|agent| agent.adapter_id == "gemini-cli")
            .unwrap();
        assert!(
            runtime
                .inventory_agent(&InventoryInput {
                    adapter_id: "cursor".into(),
                    root_path: cursor.root_path.clone(),
                })
                .unwrap()
                .iter()
                .any(|item| item.slug == "security" && item.component_type == "context")
        );
        assert!(
            runtime
                .inventory_agent(&InventoryInput {
                    adapter_id: "gemini-cli".into(),
                    root_path: gemini.root_path.clone(),
                })
                .unwrap()
                .iter()
                .any(|item| item.slug == "review" && item.component_type == "prompt")
        );

        let exported = runtime
            .export_local_package(&ExportPackageInput {
                adapter_id: "gemini-cli".into(),
                root_path: gemini.root_path.clone(),
                component_type: "prompt".into(),
                slug: "review".into(),
                source_path: None,
            })
            .unwrap();
        let archive = base64::engine::general_purpose::STANDARD
            .decode(exported.archive_base64)
            .unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(archive)).unwrap();
        let mut prompt = String::new();
        archive
            .by_name("prompts/review.md")
            .unwrap()
            .read_to_string(&mut prompt)
            .unwrap();
        assert_eq!(prompt, "Review for security.");
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
    fn scanner_requires_confirmation_for_executables_without_blocking_clean_content() {
        let (root, runtime) = runtime();
        let directory = root.path().join(".agents/skills/release");
        std::fs::write(directory.join("run.sh"), "#!/bin/sh\necho safe").unwrap();
        let report = runtime
            .scan_local_package(&PathInput {
                path: directory.to_string_lossy().into(),
            })
            .unwrap();
        assert!(!report.blocked);
        assert!(report.requires_confirmation);
        assert!(report.findings.iter().any(|finding| {
            finding.rule == "SEC_EXECUTABLE_FILE" && finding.evidence_digest.len() == 64
        }));
    }

    #[test]
    fn scanner_blocks_project_source_trees_before_export() {
        let (root, runtime) = runtime();
        let directory = root.path().join(".agents/skills/release");
        std::fs::create_dir(directory.join("src")).unwrap();
        std::fs::write(
            directory.join("src/customer.ts"),
            "export const customer = true",
        )
        .unwrap();
        let report = runtime
            .scan_local_package(&PathInput {
                path: directory.to_string_lossy().into(),
            })
            .unwrap();
        assert!(report.blocked);
        assert!(
            report
                .findings
                .iter()
                .any(|finding| finding.rule == "SEC_SOURCE_TREE")
        );
    }

    #[test]
    fn exposes_the_persisted_install_lock_for_safe_updates() {
        let (root, runtime) = runtime();
        let agent = runtime.detect_agents().unwrap().remove(0);
        let plan = InstallPlan {
            transaction_id: "tx-lock-read".into(),
            adapter_id: "codex".into(),
            capability_slug: "release".into(),
            package_digest: "a".repeat(64),
            root_path: agent.root_path.clone(),
            writes: vec![crate::files::PlannedWrite {
                relative_path: "skills/release/SKILL.md".into(),
                content_base64: base64::engine::general_purpose::STANDARD.encode("# Release v2"),
                content_digest: hex::encode(Sha256::digest(b"# Release v2")),
                expected_digest: Some(hex::encode(Sha256::digest(b"# Release"))),
            }],
        };
        runtime.apply_install(&plan).unwrap();

        let lock = runtime
            .load_install_lock(&UninstallInput {
                adapter_id: "codex".into(),
                capability_slug: "release".into(),
                root_path: agent.root_path,
            })
            .unwrap()
            .unwrap();

        assert_eq!(lock.transaction_id, "tx-lock-read");
        assert_eq!(lock.files[0].relative_path, "skills/release/SKILL.md");
        assert_eq!(
            lock.files[0].after_digest,
            hex::encode(Sha256::digest(b"# Release v2"))
        );
        assert!(root.path().join(".agents/skills/release/SKILL.md").exists());
    }

    #[test]
    fn reads_only_an_allowlisted_managed_file_for_conflict_diffing() {
        let (root, runtime) = runtime();
        let agent = runtime.detect_agents().unwrap().remove(0);
        let file = runtime
            .read_managed_file(&ManagedFileInput {
                root_path: agent.root_path,
                relative_path: "skills/release/SKILL.md".into(),
            })
            .unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(file.content_base64)
                .unwrap(),
            b"# Release"
        );
        assert_eq!(file.digest, hex::encode(Sha256::digest(b"# Release")));
        assert!(matches!(
            runtime.read_managed_file(&ManagedFileInput {
                root_path: root.path().join(".agents").to_string_lossy().into(),
                relative_path: "../private.txt".into(),
            }),
            Err(RuntimeError::PathNotAllowed)
        ));
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

    #[cfg(unix)]
    #[test]
    fn inventory_skips_symlinked_entries_without_losing_regular_capabilities() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let skills = root.path().join(".agents/skills");
        std::fs::create_dir_all(skills.join("release")).unwrap();
        std::fs::write(skills.join("release/SKILL.md"), "# Release").unwrap();
        let linked = tempdir().unwrap();
        std::fs::create_dir_all(linked.path().join("shared")).unwrap();
        std::fs::write(linked.path().join("shared/SKILL.md"), "# Shared").unwrap();
        symlink(linked.path().join("shared"), skills.join("shared")).unwrap();

        let runtime = Runtime::new(
            &root.path().join("state.db"),
            root.path().into(),
            None,
            Arc::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let agent = runtime.detect_agents().unwrap().remove(0);
        let inventory = runtime
            .inventory_agent(&InventoryInput {
                adapter_id: "codex".into(),
                root_path: agent.root_path,
            })
            .unwrap();

        assert_eq!(inventory.len(), 1);
        assert_eq!(inventory[0].slug, "release");
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

    #[cfg(unix)]
    #[test]
    fn discovers_all_trusted_skill_sources_without_authorizing_arbitrary_paths() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let home = root.path().join("home");
        let external = tempdir().unwrap();
        let arbitrary = tempdir().unwrap();
        for path in [
            home.join(".agents/skills/shared"),
            home.join(".codex/skills/global"),
            home.join(".codex/plugins/cache/vendor/plugin/1.0.0/skills/plugin-skill"),
            external.path().join("linked-skill"),
            arbitrary.path().join("untrusted"),
        ] {
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(path.join("SKILL.md"), format!("# {}", path.display())).unwrap();
        }
        symlink(
            external.path().join("linked-skill"),
            home.join(".agents/skills/linked-skill"),
        )
        .unwrap();
        let runtime = Runtime::new(
            &root.path().join("state.db"),
            home,
            None,
            Arc::new(MemoryCredentialStore::default()),
        )
        .unwrap();

        let report = runtime.discover_local_skills().unwrap();

        assert_eq!(
            report
                .skills
                .iter()
                .map(|skill| (skill.slug.as_str(), skill.source_kind.as_str(), skill.linked))
                .collect::<Vec<_>>(),
            vec![
                ("global", "global", false),
                ("linked-skill", "shared", true),
                ("plugin-skill", "plugin", false),
                ("shared", "shared", false),
            ]
        );
        assert!(runtime
            .scan_local_package(&PathInput {
                path: arbitrary
                    .path()
                    .join("untrusted")
                    .to_string_lossy()
                    .into(),
            })
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn allows_in_package_links_and_rejects_package_link_escapes() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let home = root.path().join("home");
        let skills = home.join(".codex/skills");
        let safe = skills.join("safe-linked-files");
        let escaped = skills.join("escaped-files");
        let outside = root.path().join("outside-secret.md");
        std::fs::create_dir_all(safe.join("references")).unwrap();
        std::fs::write(safe.join("SKILL.md"), "# Safe linked files").unwrap();
        std::fs::write(safe.join("references/source.md"), "inside package").unwrap();
        symlink("references/source.md", safe.join("alias.md")).unwrap();
        std::fs::create_dir_all(&escaped).unwrap();
        std::fs::write(escaped.join("SKILL.md"), "# Escaped files").unwrap();
        std::fs::write(&outside, "outside package").unwrap();
        symlink(&outside, escaped.join("secret.md")).unwrap();
        let runtime = Runtime::new(
            &root.path().join("state.db"),
            home,
            None,
            Arc::new(MemoryCredentialStore::default()),
        )
        .unwrap();

        let report = runtime.discover_local_skills().unwrap();

        assert!(report.skills.iter().any(|skill| skill.slug == "safe-linked-files"));
        assert!(!report.skills.iter().any(|skill| skill.slug == "escaped-files"));
        assert!(report.issues.iter().any(|issue| {
            issue.path.ends_with("escaped-files") && issue.reason == "package-symlink-escape"
        }));
        let safe_path = safe.canonicalize().unwrap();
        let scan = runtime
            .scan_local_package(&PathInput {
                path: safe_path.to_string_lossy().into_owned(),
            })
            .unwrap();
        assert_eq!(scan.files, 3);
        let exported = runtime
            .export_local_package(&ExportPackageInput {
                adapter_id: "codex".into(),
                root_path: String::new(),
                component_type: "skill".into(),
                slug: "safe-linked-files".into(),
                source_path: Some(safe_path.to_string_lossy().into_owned()),
            })
            .unwrap();
        let archive = base64::engine::general_purpose::STANDARD
            .decode(exported.archive_base64)
            .unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).unwrap();
        assert!(zip
            .by_name("skills/safe-linked-files/alias.md")
            .is_ok());

        symlink(&outside, safe.join("later-escape.md")).unwrap();
        let refreshed = runtime.discover_local_skills().unwrap();
        assert!(!refreshed
            .skills
            .iter()
            .any(|skill| skill.slug == "safe-linked-files"));
        assert!(matches!(
            runtime.scan_local_package(&PathInput {
                path: safe_path.to_string_lossy().into_owned(),
            }),
            Err(RuntimeError::PathNotAllowed)
        ));
    }

    #[test]
    fn scanner_never_includes_local_transaction_metadata() {
        let (root, runtime) = runtime();
        let internal = root.path().join(".agents/.capaport/recovery");
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
    fn exports_a_scanned_local_capability_as_a_canonical_zip() {
        let (_root, runtime) = runtime();
        let agent = runtime.detect_agents().unwrap().remove(0);
        let exported = runtime
            .export_local_package(&ExportPackageInput {
                adapter_id: "codex".into(),
                root_path: agent.root_path,
                component_type: "skill".into(),
                slug: "release".into(),
                source_path: None,
            })
            .unwrap();
        assert_eq!(exported.file_name, "release.zip");
        assert_eq!(exported.sha256.len(), 64);
        assert!(exported.size_bytes > 100);
        let archive = base64::engine::general_purpose::STANDARD
            .decode(exported.archive_base64)
            .unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).unwrap();
        assert!(zip.by_name("capaport.yaml").is_ok());
        assert!(zip.by_name("README.md").is_ok());
        assert!(zip.by_name("skills/release/SKILL.md").is_ok());
    }

    #[test]
    fn stores_loads_and_clears_the_session_through_the_credential_abstraction() {
        let (_root, runtime) = runtime();
        let session = SecureSession {
            access_token: "a".repeat(64),
            refresh_token: "r".repeat(64),
            expires_in: Some(900),
            organization_id: Some("organization-a".into()),
        };
        runtime.store_session(&session).unwrap();
        assert_eq!(runtime.load_session().unwrap(), Some(session));
        runtime.clear_session().unwrap();
        assert_eq!(runtime.load_session().unwrap(), None);
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
                agents: Some(vec!["codex".into()]),
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
