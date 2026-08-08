use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillSourceKind {
    Global,
    Shared,
    Plugin,
    Workspace,
}

impl SkillSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Shared => "shared",
            Self::Plugin => "plugin",
            Self::Workspace => "workspace",
        }
    }
}

#[derive(Debug, Clone)]
pub struct TrustedSkillRoot {
    pub adapter_id: String,
    pub display_name: String,
    pub scope: String,
    pub source_kind: SkillSourceKind,
    pub path: PathBuf,
}

impl TrustedSkillRoot {
    pub fn new(
        adapter_id: impl Into<String>,
        display_name: impl Into<String>,
        scope: impl Into<String>,
        source_kind: SkillSourceKind,
        path: PathBuf,
    ) -> Self {
        Self {
            adapter_id: adapter_id.into(),
            display_name: display_name.into(),
            scope: scope.into(),
            source_kind,
            path,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DiscoveredSkillPackage {
    pub adapter_id: String,
    pub display_name: String,
    pub scope: String,
    pub source_kind: SkillSourceKind,
    pub source_root: PathBuf,
    pub package_root: PathBuf,
    pub slug: String,
    pub linked: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryIssue {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct SkillDiscoveryReport {
    pub packages: Vec<DiscoveredSkillPackage>,
    pub issues: Vec<DiscoveryIssue>,
}

struct Walker<'a> {
    root: &'a TrustedSkillRoot,
    packages: Vec<DiscoveredSkillPackage>,
    issues: Vec<DiscoveryIssue>,
    active: HashSet<PathBuf>,
    visited: HashSet<PathBuf>,
    package_roots: HashSet<PathBuf>,
}

impl<'a> Walker<'a> {
    fn issue(&mut self, path: &Path, reason: &str) {
        self.issues.push(DiscoveryIssue {
            path: path.to_string_lossy().into_owned(),
            reason: reason.into(),
        });
    }

    fn visit_directory(&mut self, lexical: &Path, canonical: PathBuf, linked: bool) {
        if self.active.contains(&canonical) {
            self.issue(lexical, "symlink-cycle");
            return;
        }
        if !self.visited.insert(canonical.clone()) {
            return;
        }
        self.active.insert(canonical.clone());

        let entries = match std::fs::read_dir(lexical) {
            Ok(entries) => {
                let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
                entries.sort_by_key(|entry| entry.file_name());
                entries
            }
            Err(error) => {
                self.issue(
                    lexical,
                    if error.kind() == std::io::ErrorKind::PermissionDenied {
                        "permission-denied"
                    } else {
                        "unreadable-directory"
                    },
                );
                self.active.remove(&canonical);
                return;
            }
        };

        let manifest = entries
            .iter()
            .find(|entry| entry.file_name().to_string_lossy() == "SKILL.md");
        if let Some(manifest) = manifest {
            let manifest_path = manifest.path();
            let manifest_metadata = std::fs::symlink_metadata(&manifest_path);
            let valid = match manifest_metadata {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    match manifest_path.canonicalize() {
                        Ok(target) if target.starts_with(&canonical) && target.is_file() => true,
                        Ok(_) => {
                            self.issue(&manifest_path, "package-symlink-escape");
                            false
                        }
                        Err(_) => {
                            self.issue(&manifest_path, "broken-symlink");
                            false
                        }
                    }
                }
                Ok(metadata) => metadata.is_file(),
                Err(_) => false,
            };
            if valid && self.package_roots.insert(canonical.clone()) {
                if let Some(slug) = canonical.file_name().and_then(|value| value.to_str()) {
                    self.packages.push(DiscoveredSkillPackage {
                        adapter_id: self.root.adapter_id.clone(),
                        display_name: self.root.display_name.clone(),
                        scope: self.root.scope.clone(),
                        source_kind: self.root.source_kind,
                        source_root: self.root.path.clone(),
                        package_root: canonical.clone(),
                        slug: slug.into(),
                        linked,
                    });
                }
                self.active.remove(&canonical);
                return;
            }
        }

        for entry in entries {
            let path = entry.path();
            let metadata = match std::fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.file_type().is_symlink() {
                let target = match path.canonicalize() {
                    Ok(target) => target,
                    Err(_) => {
                        self.issue(&path, "broken-symlink");
                        continue;
                    }
                };
                if target.is_dir() {
                    if self.active.contains(&target) {
                        self.issue(&path, "symlink-cycle");
                    } else {
                        self.visit_directory(&path, target, true);
                    }
                }
            } else if metadata.is_dir() {
                let child = match path.canonicalize() {
                    Ok(child) => child,
                    Err(_) => continue,
                };
                self.visit_directory(&path, child, linked);
            }
        }
        self.active.remove(&canonical);
    }
}

pub fn discover_skill_packages(roots: &[TrustedSkillRoot]) -> SkillDiscoveryReport {
    let mut report = SkillDiscoveryReport::default();
    let mut globally_seen_packages = HashSet::new();
    for root in roots {
        let canonical = match root.path.canonicalize() {
            Ok(canonical) if canonical.is_dir() => canonical,
            _ => continue,
        };
        let linked = std::fs::symlink_metadata(&root.path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false);
        let mut walker = Walker {
            root,
            packages: Vec::new(),
            issues: Vec::new(),
            active: HashSet::new(),
            visited: HashSet::new(),
            package_roots: HashSet::new(),
        };
        walker.visit_directory(&root.path, canonical, linked);
        for package in walker.packages {
            if globally_seen_packages.insert(package.package_root.clone()) {
                report.packages.push(package);
            }
        }
        report.issues.extend(walker.issues);
    }
    report.packages.sort_by(|left, right| {
        (&left.adapter_id, &left.slug, &left.package_root).cmp(&(
            &right.adapter_id,
            &right.slug,
            &right.package_root,
        ))
    });
    report
        .issues
        .sort_by(|left, right| (&left.reason, &left.path).cmp(&(&right.reason, &right.path)));
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    #[test]
    fn discovers_nested_and_external_linked_skills_once() {
        use std::os::unix::fs::symlink;

        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let skills = home.path().join(".codex/skills");
        std::fs::create_dir_all(skills.join(".system/imagegen")).unwrap();
        std::fs::write(skills.join(".system/imagegen/SKILL.md"), "# Imagegen").unwrap();
        std::fs::create_dir_all(outside.path().join("shared")).unwrap();
        std::fs::write(outside.path().join("shared/SKILL.md"), "# Shared").unwrap();
        symlink(outside.path().join("shared"), skills.join("shared-a")).unwrap();
        symlink(outside.path().join("shared"), skills.join("shared-b")).unwrap();

        let report = discover_skill_packages(&[TrustedSkillRoot::new(
            "codex",
            "Codex",
            "user",
            SkillSourceKind::Global,
            skills,
        )]);

        assert_eq!(
            report
                .packages
                .iter()
                .filter(|item| item.slug == "shared")
                .count(),
            1
        );
        assert!(
            report
                .packages
                .iter()
                .any(|item| item.slug == "imagegen" && !item.linked)
        );
        assert!(
            report
                .packages
                .iter()
                .any(|item| item.slug == "shared" && item.linked)
        );
    }

    #[cfg(unix)]
    #[test]
    fn isolates_broken_cycles_and_escaped_skill_manifests() {
        use std::os::unix::fs::symlink;

        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let skills = home.path().join(".agents/skills");
        std::fs::create_dir_all(skills.join("valid")).unwrap();
        std::fs::write(skills.join("valid/SKILL.md"), "# Valid").unwrap();
        std::fs::create_dir_all(skills.join("escaped")).unwrap();
        std::fs::write(outside.path().join("SKILL.md"), "# Outside").unwrap();
        symlink(
            outside.path().join("SKILL.md"),
            skills.join("escaped/SKILL.md"),
        )
        .unwrap();
        symlink(skills.join("missing"), skills.join("broken")).unwrap();
        symlink(&skills, skills.join("cycle")).unwrap();

        let report = discover_skill_packages(&[TrustedSkillRoot::new(
            "codex",
            "Codex",
            "user",
            SkillSourceKind::Shared,
            skills,
        )]);

        assert_eq!(
            report
                .packages
                .iter()
                .map(|item| item.slug.as_str())
                .collect::<Vec<_>>(),
            vec!["valid"]
        );
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.reason == "broken-symlink")
        );
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.reason == "symlink-cycle")
        );
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.reason == "package-symlink-escape")
        );
    }
}
