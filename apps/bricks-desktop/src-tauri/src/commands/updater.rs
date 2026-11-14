//! Tauri IPC commands for checking, downloading, cancelling, ignoring and installing updates.

use crate::contract::{IpcResult, UpdateStatus};
use crate::services::updater::{self, UpdaterService};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn update_state(service: State<'_, UpdaterService>) -> IpcResult<UpdateStatus> {
    Ok(service.state())
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    service: State<'_, UpdaterService>,
) -> IpcResult<UpdateStatus> {
    updater::check_now(&app, &service).await
}

#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    service: State<'_, UpdaterService>,
) -> IpcResult<UpdateStatus> {
    updater::start_download(&app, &service).await
}

#[tauri::command]
pub async fn update_cancel(
    app: AppHandle,
    service: State<'_, UpdaterService>,
) -> IpcResult<UpdateStatus> {
    Ok(updater::cancel_download(&app, &service))
}

#[tauri::command]
pub async fn update_ignore(
    app: AppHandle,
    service: State<'_, UpdaterService>,
    version: String,
) -> IpcResult<UpdateStatus> {
    updater::ignore_version(&app, &service, version).await
}

#[tauri::command]
pub async fn update_install(app: AppHandle, service: State<'_, UpdaterService>) -> IpcResult<()> {
    updater::install_and_restart(&app, &service).await
}
