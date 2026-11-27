//! The « Usage » settings: daily totals from the usage ledger, and the share
//! of OpenCode Go's limits a provider's key has used.
use crate::contract::{GoQuota, IpcResult, UsageStats};
use crate::engine::AppState;
use crate::services::join_error;
use crate::services::usage_ledger;
use bricks_provider::config::ProvidersConfig;
use tauri::State;

#[tauri::command]
pub async fn usage_stats() -> IpcResult<UsageStats> {
    tokio::task::spawn_blocking(|| {
        let entries = usage_ledger::global()
            .map(|l| l.entries())
            .unwrap_or_default();
        usage_ledger::stats(&entries)
    })
    .await
    .map_err(join_error)
}

/// `None` when the provider is not OpenCode Go, has no key, or the gateway
/// does not answer.
#[tauri::command]
pub async fn usage_go_quota(
    state: State<'_, AppState>,
    provider_id: String,
) -> IpcResult<Option<GoQuota>> {
    let path = state.providers_path.clone();
    let key = tokio::task::spawn_blocking(move || {
        let text = std::fs::read_to_string(&path).ok()?;
        let config = ProvidersConfig::from_json_str(&text, "config.json").ok()?;
        let provider = config.providers.into_iter().find(|p| p.id == provider_id)?;
        usage_ledger::is_opencode_go(&provider.endpoint)
            .then(|| provider.key().map(str::to_string))
            .flatten()
    })
    .await
    .map_err(join_error)?;
    Ok(match key {
        Some(key) => usage_ledger::go_quota(&key).await,
        None => None,
    })
}
