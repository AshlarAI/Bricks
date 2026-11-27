//! Provider and model editing. Every write:
//! checks the revision the desktop read, edits only the target table, validates
//! the whole file with the provider crate, writes atomically, then reloads the
//! catalog. Each command returns the file as it now is, reloaded.
use crate::contract::*;
use crate::engine::AppState;
use crate::engine::catalog::DesktopCatalog;
use crate::services::join_error;
use crate::services::provider_catalog;
use crate::services::providers::{self, view};
use crate::services::providers_json::Edit;
use parking_lot::Mutex;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

/// The providers file as it is now.
pub(crate) fn current_file(path: &Path) -> ProvidersFile {
    view(path)
}

/// Applies one edit under the edit lock, then reloads the catalog from the
/// file as written. A failed edit changes neither the file nor the catalog.
pub(crate) fn apply_edit(
    path: &Path,
    lock: &Mutex<()>,
    catalog: &DesktopCatalog,
    revision: &str,
    edit: &Edit,
) -> IpcResult<ProvidersFile> {
    let _guard = lock.lock();
    providers::commit(path, revision, edit)?;
    let reloaded = bricks_config::load_registry(Some(path)).map(Arc::new);
    catalog.replace(reloaded);
    Ok(current_file(path))
}

async fn run_edit(state: &AppState, revision: String, edit: Edit) -> IpcResult<ProvidersFile> {
    let path = state.providers_path.clone();
    let lock = Arc::clone(&state.providers_lock);
    let catalog = Arc::clone(&state.catalog);
    tokio::task::spawn_blocking(move || apply_edit(&path, &lock, &catalog, &revision, &edit))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn providers_config(state: State<'_, AppState>) -> IpcResult<ProvidersFile> {
    let path = state.providers_path.clone();
    tokio::task::spawn_blocking(move || current_file(&path))
        .await
        .map_err(join_error)
}

#[tauri::command]
pub async fn provider_update(
    state: State<'_, AppState>,
    provider_id: String,
    patch: ProviderPatch,
    revision: String,
) -> IpcResult<ProvidersFile> {
    run_edit(
        &state,
        revision,
        Edit::ProviderUpdate { provider_id, patch },
    )
    .await
}

#[tauri::command]
pub async fn model_update(
    state: State<'_, AppState>,
    provider_id: String,
    model_id: String,
    patch: ModelPatch,
    revision: String,
) -> IpcResult<ProvidersFile> {
    run_edit(
        &state,
        revision,
        Edit::ModelUpdate {
            provider_id,
            model_id,
            patch,
        },
    )
    .await
}

#[tauri::command]
pub async fn provider_delete(
    state: State<'_, AppState>,
    provider_id: String,
    revision: String,
) -> IpcResult<ProvidersFile> {
    run_edit(&state, revision, Edit::ProviderDelete { provider_id }).await
}

#[tauri::command]
pub async fn model_delete(
    state: State<'_, AppState>,
    provider_id: String,
    model_id: String,
    revision: String,
) -> IpcResult<ProvidersFile> {
    run_edit(
        &state,
        revision,
        Edit::ModelDelete {
            provider_id,
            model_id,
        },
    )
    .await
}

#[tauri::command]
pub async fn provider_create(
    state: State<'_, AppState>,
    provider_id: String,
    patch: ProviderPatch,
    revision: String,
) -> IpcResult<ProvidersFile> {
    run_edit(
        &state,
        revision,
        Edit::ProviderCreate { provider_id, patch },
    )
    .await
}

#[tauri::command]
pub async fn model_create(
    state: State<'_, AppState>,
    provider_id: String,
    model_id: String,
    patch: ModelPatch,
    revision: String,
) -> IpcResult<ProvidersFile> {
    run_edit(
        &state,
        revision,
        Edit::ModelCreate {
            provider_id,
            model_id,
            patch,
        },
    )
    .await
}

#[tauri::command]
pub async fn providers_fill_missing_prices(
    state: State<'_, AppState>,
    revision: String,
) -> IpcResult<ProvidersFile> {
    run_edit(&state, revision, Edit::FillMissingPrices).await
}

#[cfg(test)]
mod tests;

/// The providers Bricks adds in one step.
#[tauri::command]
pub fn provider_templates() -> Vec<ProviderTemplate> {
    provider_catalog::templates()
}

/// Adds the provider of template `template_id` with its current models (read
/// from the model catalogue first) and the key, if one is given.
#[tauri::command]
pub async fn provider_create_from_template(
    state: State<'_, AppState>,
    template_id: String,
    api_key: Option<String>,
    revision: String,
) -> IpcResult<ProvidersFile> {
    let template = provider_catalog::template(&template_id)?;
    let models = provider_catalog::models_for(&template).await?;
    let patch = ProviderPatch {
        name: Some(template.name.clone()),
        endpoint: Some(template.endpoint.clone()),
        protocol: Some(template.protocol.clone()),
        auth: Some("bearer".to_string()),
        auth_header: None,
        api_key: api_key.filter(|k| !k.trim().is_empty()),
    };
    let edit = Edit::ProviderCreateWithModels {
        base_id: template.id,
        patch,
        models: models.into_iter().map(|m| (m.id, m.patch)).collect(),
    };
    run_edit(&state, revision, edit).await
}

/// How long a model test waits for the reply.
const TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Sends a two-word prompt to the model, as configured now, and answers how
/// long the reply took (milliseconds). The error is the provider's.
#[tauri::command]
pub async fn model_test(
    state: State<'_, AppState>,
    provider_id: String,
    model_id: String,
) -> IpcResult<u64> {
    use bricks_provider::{CompletionRequest, Provider, SESSION_ID_OPTION};
    let registry = state
        .catalog
        .registry()
        .map_err(|e| crate::services::error(IpcErrorCode::Config, e))?;
    let config = |e: String| crate::services::error(IpcErrorCode::Config, e);
    let provider = registry
        .resolve(&format!("{provider_id}/{model_id}"))
        .map_err(|e| config(e.to_string()))?
        .build_provider()
        .map_err(|e| config(e.to_string()))?;
    let mut request = CompletionRequest::new(String::new());
    request.messages = vec![bricks_types::Message::user("Reply OK")];
    request.max_tokens = 64;
    request
        .options
        .set(SESSION_ID_OPTION, uuid::Uuid::new_v4().to_string());
    let started = std::time::Instant::now();
    tokio::time::timeout(TEST_TIMEOUT, provider.complete_blocking(request))
        .await
        .map_err(|_| {
            crate::services::error(
                IpcErrorCode::Rejected,
                crate::i18n::tr!(crate::i18n::msg::MODEL_TEST_TIMED_OUT),
            )
        })?
        .map_err(|e| crate::services::error(IpcErrorCode::Rejected, e.to_string()))?;
    Ok(started.elapsed().as_millis() as u64)
}
