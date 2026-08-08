#[cfg(feature = "tauri-app")]
use capaport_runtime::commands::{
    ExportPackageInput, InventoryInput, PathInput, QueueClaimInput, QueueItemInput,
    QueueRescheduleInput, QueueRetryFailedInput, QueueWriteInput, Runtime,
};
#[cfg(feature = "tauri-app")]
use capaport_runtime::projects::{
    BindProjectInput, ContextPackageInput, ProjectBindingInput, ProjectProjectionInput,
    ProjectSpaceInput,
};
#[cfg(feature = "tauri-app")]
use capaport_runtime::credentials::OsCredentialStore;
#[cfg(feature = "tauri-app")]
use capaport_runtime::error::CommandError;
#[cfg(feature = "tauri-app")]
use capaport_runtime::files::InstallPlan;

#[cfg(feature = "tauri-app")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiRequest {
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
}

#[cfg(feature = "tauri-app")]
#[derive(serde::Serialize)]
struct ApiResponse {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body: String,
}

#[cfg(feature = "tauri-app")]
fn validate_api_url(url: &reqwest::Url) -> Result<(), String> {
    let is_local_api = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(3210)
        && (url.path() == "/api/v1" || url.path().starts_with("/api/v1/"));
    if url.scheme() == "https" || is_local_api {
        Ok(())
    } else {
        Err("API request destination is not allowed".to_string())
    }
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
async fn api_request(request: ApiRequest) -> Result<ApiResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|_| "API request URL is invalid".to_string())?;
    validate_api_url(&url)?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| "API request method is invalid".to_string())?;
    let client = reqwest::Client::new();
    let mut builder = client.request(method, url);
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|value| (name.to_string(), value.to_string())))
        .collect();
    let body = response.text().await.map_err(|error| error.to_string())?;
    Ok(ApiResponse { status, headers, body })
}

#[cfg(all(test, feature = "tauri-app"))]
mod api_request_tests {
    use super::validate_api_url;

    #[test]
    fn limits_plain_http_to_the_local_capaport_api() {
        assert!(validate_api_url(&reqwest::Url::parse("http://127.0.0.1:3210/api/v1/auth/register").unwrap()).is_ok());
        assert!(validate_api_url(&reqwest::Url::parse("https://api.capaport.example/api/v1/auth/register").unwrap()).is_ok());
        assert!(validate_api_url(&reqwest::Url::parse("http://127.0.0.1:3210/private").unwrap()).is_err());
        assert!(validate_api_url(&reqwest::Url::parse("http://example.com/api/v1/auth/register").unwrap()).is_err());
    }

}

#[cfg(feature = "tauri-app")]
struct AppState {
    runtime: Runtime,
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn detect_agents(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<capaport_runtime::commands::AgentDescriptor>, CommandError> {
    state.runtime.detect_agents().map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn inventory_agent(
    input: InventoryInput,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<capaport_runtime::commands::LocalCapabilitySummary>, CommandError> {
    state.runtime.inventory_agent(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn scan_local_package(
    input: PathInput,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::commands::LocalScanReport, CommandError> {
    state.runtime.scan_local_package(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn read_managed_file(
    input: capaport_runtime::commands::ManagedFileInput,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::commands::ManagedFileContent, CommandError> {
    state.runtime.read_managed_file(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn export_local_package(
    input: ExportPackageInput,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::commands::LocalPackageExport, CommandError> {
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
) -> Result<capaport_runtime::files::InstallPreview, CommandError> {
    state.runtime.preview_install(&plan).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn apply_install(
    plan: InstallPlan,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::files::ApplyResult, CommandError> {
    state.runtime.apply_install(&plan).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn rollback_install(
    transaction_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::files::ApplyResult, CommandError> {
    state
        .runtime
        .rollback_install(&transaction_id)
        .map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn load_install_lock(
    input: capaport_runtime::commands::UninstallInput,
    state: tauri::State<'_, AppState>,
) -> Result<Option<capaport_runtime::commands::InstallLock>, CommandError> {
    state.runtime.load_install_lock(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn uninstall(
    input: capaport_runtime::commands::UninstallInput,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::files::ApplyResult, CommandError> {
    state.runtime.uninstall(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn bind_project_directory(
    input: BindProjectInput,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::projects::LocalProjectBinding, CommandError> {
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
) -> Result<Vec<capaport_runtime::projects::LocalProjectBinding>, CommandError> {
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
) -> Result<capaport_runtime::projects::ProjectInventory, CommandError> {
    state.runtime.inventory_project_context(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn export_project_context(
    input: ContextPackageInput,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::projects::ContextPackageExport, CommandError> {
    state.runtime.export_project_context(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn project_context_plan(
    input: ProjectProjectionInput,
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::files::InstallPlan, CommandError> {
    state.runtime.project_context_plan(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn sync_queue_status(
    state: tauri::State<'_, AppState>,
) -> Result<capaport_runtime::database::SyncQueueStatus, CommandError> {
    state.runtime.sync_queue_status().map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn enqueue_write(
    input: QueueWriteInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    state.runtime.enqueue_write(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn claim_ready_writes(
    input: QueueClaimInput,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<capaport_runtime::database::RetryOperation>, CommandError> {
    state.runtime.claim_ready_writes(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn complete_write(
    input: QueueItemInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    state.runtime.complete_write(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn reschedule_write(
    input: QueueRescheduleInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    state.runtime.reschedule_write(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn retry_failed_writes(
    input: QueueRetryFailedInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    state.runtime.retry_failed_writes(&input).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn store_session(
    session: capaport_runtime::commands::SecureSession,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    state.runtime.store_session(&session).map_err(Into::into)
}
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn load_session(
    state: tauri::State<'_, AppState>,
) -> Result<Option<capaport_runtime::commands::SecureSession>, CommandError> {
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
    let project = ProjectDirs::from("com", "capaport", "CapaPort")
        .expect("platform data directory is required");
    let runtime = Runtime::new(
        &project.data_local_dir().join("capaport.db"),
        base.home_dir().into(),
        None,
        Arc::new(OsCredentialStore::new("com.capaport.desktop")),
    )
    .expect("local runtime initialization failed");
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState { runtime })
        .invoke_handler(tauri::generate_handler![
            detect_agents,
            inventory_agent,
            scan_local_package,
            read_managed_file,
            export_local_package,
            preview_install,
            apply_install,
            rollback_install,
            load_install_lock,
            uninstall,
            bind_project_directory,
            list_project_bindings,
            remove_project_binding,
            inventory_project_context,
            export_project_context,
            project_context_plan,
            sync_queue_status,
            enqueue_write,
            claim_ready_writes,
            complete_write,
            reschedule_write,
            retry_failed_writes,
            store_session,
            load_session,
            clear_session,
            api_request
        ])
        .run(tauri::generate_context!())
        .expect("CapaPort desktop runtime failed");
}

#[cfg(not(feature = "tauri-app"))]
fn main() {}
