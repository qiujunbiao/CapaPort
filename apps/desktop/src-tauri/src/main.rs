#[cfg(feature = "tauri-app")]
use agentdoor_runtime::commands::{ExportPackageInput, InventoryInput, PathInput, Runtime};
#[cfg(feature = "tauri-app")]
use agentdoor_runtime::projects::{
    BindProjectInput, ContextPackageInput, ProjectBindingInput, ProjectProjectionInput,
    ProjectSpaceInput,
};
#[cfg(feature = "tauri-app")]
use agentdoor_runtime::credentials::OsCredentialStore;
#[cfg(feature = "tauri-app")]
use agentdoor_runtime::error::CommandError;
#[cfg(feature = "tauri-app")]
use agentdoor_runtime::files::InstallPlan;

#[cfg(feature = "tauri-app")]
struct AppState {
    runtime: Runtime,
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn detect_agents(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<agentdoor_runtime::commands::AgentDescriptor>, CommandError> {
    state.runtime.detect_agents().map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn inventory_agent(
    input: InventoryInput,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<agentdoor_runtime::commands::LocalCapabilitySummary>, CommandError> {
    state.runtime.inventory_agent(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn scan_local_package(
    input: PathInput,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::commands::LocalScanReport, CommandError> {
    state.runtime.scan_local_package(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn export_local_package(
    input: ExportPackageInput,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::commands::LocalPackageExport, CommandError> {
    state
        .runtime
        .export_local_package(&input)
        .map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn preview_install(
    plan: InstallPlan,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::files::InstallPreview, CommandError> {
    state.runtime.preview_install(&plan).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn apply_install(
    plan: InstallPlan,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::files::ApplyResult, CommandError> {
    state.runtime.apply_install(&plan).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn rollback_install(
    transaction_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::files::ApplyResult, CommandError> {
    state
        .runtime
        .rollback_install(&transaction_id)
        .map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn bind_project_directory(
    input: BindProjectInput,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::projects::LocalProjectBinding, CommandError> {
    state
        .runtime
        .bind_project_directory(&input)
        .map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn list_project_bindings(
    input: ProjectSpaceInput,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<agentdoor_runtime::projects::LocalProjectBinding>, CommandError> {
    state.runtime.list_project_bindings(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn remove_project_binding(
    input: ProjectBindingInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    state.runtime.remove_project_binding(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn inventory_project_context(
    input: ProjectBindingInput,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::projects::ProjectInventory, CommandError> {
    state.runtime.inventory_project_context(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn export_project_context(
    input: ContextPackageInput,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::projects::ContextPackageExport, CommandError> {
    state.runtime.export_project_context(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn project_context_plan(
    input: ProjectProjectionInput,
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::files::InstallPlan, CommandError> {
    state.runtime.project_context_plan(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn sync_queue_status(
    state: tauri::State<'_, AppState>,
) -> Result<agentdoor_runtime::database::SyncQueueStatus, CommandError> {
    state.runtime.sync_queue_status().map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn store_session(
    session: agentdoor_runtime::commands::SecureSession,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    state.runtime.store_session(&session).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn load_session(
    state: tauri::State<'_, AppState>,
) -> Result<Option<agentdoor_runtime::commands::SecureSession>, CommandError> {
    state.runtime.load_session().map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn clear_session(state: tauri::State<'_, AppState>) -> Result<(), CommandError> {
    state.runtime.clear_session().map_err(Into::into)
}

#[cfg(feature = "tauri-app")]
fn main() {
    use directories::{BaseDirs, ProjectDirs};
    use std::sync::Arc;
    let base = BaseDirs::new().expect("platform home directory is required");
    let project = ProjectDirs::from("com", "agentdoor", "Agentdoor")
        .expect("platform data directory is required");
    let runtime = Runtime::new(
        &project.data_local_dir().join("agentdoor.db"),
        base.home_dir().into(),
        None,
        Arc::new(OsCredentialStore::new("com.agentdoor.desktop")),
    )
    .expect("local runtime initialization failed");
    tauri::Builder::default()
        .manage(AppState { runtime })
        .invoke_handler(tauri::generate_handler![
            detect_agents,
            inventory_agent,
            scan_local_package,
            export_local_package,
            preview_install,
            apply_install,
            rollback_install,
            bind_project_directory,
            list_project_bindings,
            remove_project_binding,
            inventory_project_context,
            export_project_context,
            project_context_plan,
            sync_queue_status,
            store_session,
            load_session,
            clear_session
        ])
        .run(tauri::generate_context!())
        .expect("Agentdoor desktop runtime failed");
}

#[cfg(not(feature = "tauri-app"))]
fn main() {}
