use agentdoor_runtime::RuntimeError;
use agentdoor_runtime::commands::{ExportPackageInput, Runtime, UninstallInput};
use agentdoor_runtime::credentials::MemoryCredentialStore;
use agentdoor_runtime::files::{ChangeKind, InstallPlan, PlannedWrite};
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessReport {
    clean_update: bool,
    conflict_blocked: bool,
    local_import_exported: bool,
    rollback_recovered: bool,
    uninstall_removed: bool,
    uninstall_rollback_recovered: bool,
    final_uninstall_removed: bool,
}

fn digest(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}

fn plan(root: &Path, id: &str, content: &[u8], expected_digest: Option<String>) -> InstallPlan {
    let content_digest = digest(content);
    InstallPlan {
        transaction_id: id.into(),
        adapter_id: "codex".into(),
        capability_slug: "release".into(),
        package_digest: content_digest.clone(),
        root_path: root.to_string_lossy().into(),
        writes: vec![PlannedWrite {
            relative_path: "skills/release/SKILL.md".into(),
            content_base64: base64::engine::general_purpose::STANDARD.encode(content),
            content_digest,
            expected_digest,
        }],
    }
}

fn run() -> Result<HarnessReport, Box<dyn std::error::Error>> {
    let fixture = std::env::temp_dir().join(format!("agentdoor-runtime-harness-{}", Uuid::new_v4()));
    let home = fixture.join("home");
    let project = fixture.join("project");
    let root = project.join(".agents");
    std::fs::create_dir_all(root.join("skills/release"))?;
    std::fs::create_dir_all(&home)?;
    let runtime = Runtime::new(
        &fixture.join("runtime.db"),
        home,
        Some(project),
        Arc::new(MemoryCredentialStore::default()),
    )?;
    let target = root.join("skills/release/SKILL.md");
    let version_1 = b"# Version 1\n";
    let version_2 = b"# Version 2\n";
    let version_3 = b"# Version 3\n";

    let install = plan(&root, "runtime-install-v1", version_1, None);
    runtime.apply_install(&install)?;
    let update = plan(
        &root,
        "runtime-update-v2",
        version_2,
        Some(digest(version_1)),
    );
    let update_preview = runtime.preview_install(&update)?;
    let clean_update = update_preview.conflicts == 0
        && update_preview.changes[0].kind == ChangeKind::Update;
    runtime.apply_install(&update)?;

    std::fs::write(&target, b"# Version 2\nLocal customization.\n")?;
    let conflict = plan(
        &root,
        "runtime-update-v3-conflict",
        version_3,
        Some(digest(version_2)),
    );
    let conflict_preview = runtime.preview_install(&conflict)?;
    let conflict_blocked = conflict_preview.conflicts == 1
        && matches!(runtime.apply_install(&conflict), Err(RuntimeError::LocalModificationConflict));
    let exported = runtime.export_local_package(&ExportPackageInput {
        adapter_id: "codex".into(),
        root_path: root.to_string_lossy().into(),
        component_type: "skill".into(),
        slug: "release".into(),
    })?;
    let local_import_exported = exported.size_bytes > 0 && !exported.archive_base64.is_empty();

    std::fs::write(&target, version_2)?;
    let recovery = plan(
        &root,
        "runtime-update-v3-recovery",
        version_3,
        Some(digest(version_2)),
    );
    runtime.apply_install(&recovery)?;
    runtime.rollback_install("runtime-update-v3-recovery")?;
    let rollback_recovered = std::fs::read(&target)? == version_2;

    let uninstall_input = UninstallInput {
        adapter_id: "codex".into(),
        capability_slug: "release".into(),
        root_path: root.to_string_lossy().into(),
    };
    let uninstall = runtime.uninstall(&uninstall_input)?;
    let uninstall_removed = !target.exists();
    runtime.rollback_install(&uninstall.transaction_id)?;
    let uninstall_rollback_recovered = std::fs::read(&target)? == version_2
        && runtime.load_install_lock(&uninstall_input)?.is_some();
    runtime.uninstall(&uninstall_input)?;
    let final_uninstall_removed = !target.exists() && runtime.load_install_lock(&uninstall_input)?.is_none();

    std::fs::remove_dir_all(&fixture)?;
    Ok(HarnessReport {
        clean_update,
        conflict_blocked,
        local_import_exported,
        rollback_recovered,
        uninstall_removed,
        uninstall_rollback_recovered,
        final_uninstall_removed,
    })
}

fn main() {
    match run() {
        Ok(report) => println!("{}", serde_json::to_string(&report).expect("report serialization failed")),
        Err(error) => {
            eprintln!("runtime-harness-error={error}");
            std::process::exit(1);
        }
    }
}
