//! GitHub Releases auto-updater orchestration over `tauri-plugin-updater`.
//!
//! Only official releases are served (`/releases/latest/download/latest.json`).
//! Background checks never surface network errors or download automatically;
//! downloads and restarts are always initiated by the user, and `engine` + `pty`
//! are shut down before installing to avoid Windows file-lock failures.

use crate::commands::app::save_preferences;
use crate::contract::{DesktopEvent, IpcErrorCode, IpcResult, UpdateMetadata, UpdateStatus};
use crate::engine::{self, AppState};
use crate::pty;
use crate::services::error;
use parking_lot::Mutex;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(4);
const BACKGROUND_CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(120);

struct DownloadedPackage {
    version: String,
    bytes: Vec<u8>,
}

struct UpdaterInner {
    status: UpdateStatus,
    pending_update: Option<Update>,
    downloaded: Option<DownloadedPackage>,
    download_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    download_gen: u64,
    check_in_flight: bool,
    installing: bool,
}

impl Default for UpdaterInner {
    fn default() -> Self {
        Self {
            status: UpdateStatus::Idle,
            pending_update: None,
            downloaded: None,
            download_handle: None,
            download_gen: 0,
            check_in_flight: false,
            installing: false,
        }
    }
}

#[derive(Default)]
pub struct UpdaterService {
    inner: Arc<Mutex<UpdaterInner>>,
}

impl UpdaterService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn state(&self) -> UpdateStatus {
        self.inner.lock().status.clone()
    }

    fn set_status(&self, app: &AppHandle, status: UpdateStatus) {
        self.inner.lock().status = status.clone();
        publish_status(app, status);
    }
}

fn publish_status(app: &AppHandle, status: UpdateStatus) {
    if let Some(app_state) = app.try_state::<AppState>() {
        app_state
            .hub
            .publish(DesktopEvent::UpdateStateChanged { state: status });
    }
}

fn to_metadata(update: &Update) -> UpdateMetadata {
    let pub_date = update
        .date
        .and_then(|d| chrono::DateTime::from_timestamp(d.unix_timestamp(), 0))
        .map(|dt| dt.to_rfc3339());
    let notes = update
        .body
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        pub_date,
        notes,
    }
}

fn current_app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn should_skip_version(skipped: Option<&str>, candidate: &str, manual: bool) -> bool {
    !manual && skipped.is_some_and(|s| s == candidate)
}

fn should_skip_background_poll(
    status: &UpdateStatus,
    check_in_flight: bool,
    installing: bool,
) -> bool {
    check_in_flight
        || installing
        || matches!(
            status,
            UpdateStatus::Checking | UpdateStatus::Downloading { .. } | UpdateStatus::Ready { .. }
        )
}

/// Starts silent startup & periodic release checks in the background.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_CHECK_DELAY).await;
        loop {
            let service = app.state::<UpdaterService>();
            let skip = {
                let guard = service.inner.lock();
                should_skip_background_poll(&guard.status, guard.check_in_flight, guard.installing)
            };
            if !skip {
                let _ = run_check(&app, service.inner(), false).await;
            }
            tokio::time::sleep(BACKGROUND_CHECK_INTERVAL).await;
        }
    });
}

pub async fn check_now(app: &AppHandle, service: &UpdaterService) -> IpcResult<UpdateStatus> {
    {
        let guard = service.inner.lock();
        if matches!(
            guard.status,
            UpdateStatus::Downloading { .. } | UpdateStatus::Ready { .. }
        ) || guard.installing
        {
            return Ok(guard.status.clone());
        }
    }
    run_check(app, service, true).await
}

async fn run_check(
    app: &AppHandle,
    service: &UpdaterService,
    manual: bool,
) -> IpcResult<UpdateStatus> {
    {
        let mut guard = service.inner.lock();
        if guard.check_in_flight || guard.installing {
            return Ok(guard.status.clone());
        }
        guard.check_in_flight = true;
    }

    if manual {
        service.set_status(app, UpdateStatus::Checking);
    }

    let check_result = async {
        let updater = app
            .updater()
            .map_err(|e| error(IpcErrorCode::Internal, e.to_string()))?;
        updater
            .check()
            .await
            .map_err(|e| error(IpcErrorCode::Internal, e.to_string()))
    }
    .await;

    match check_result {
        Ok(Some(update)) => {
            let skipped = app
                .try_state::<AppState>()
                .map(|s| s.prefs.get().skipped_update_version)
                .unwrap_or(None);
            if should_skip_version(skipped.as_deref(), &update.version, manual) {
                let mut guard = service.inner.lock();
                guard.check_in_flight = false;
                guard.pending_update = None;
                guard.downloaded = None;
                guard.status = UpdateStatus::Idle;
                drop(guard);
                publish_status(app, UpdateStatus::Idle);
                return Ok(UpdateStatus::Idle);
            }

            if manual
                && skipped.is_some()
                && let Some(app_state) = app.try_state::<AppState>()
            {
                let mut prefs = app_state.prefs.get();
                prefs.skipped_update_version = None;
                let _ = save_preferences(&app_state, prefs).await;
            }

            let info = to_metadata(&update);
            let next_status = UpdateStatus::Available { info };
            let mut guard = service.inner.lock();
            guard.check_in_flight = false;
            guard.pending_update = Some(update);
            guard.downloaded = None;
            guard.status = next_status.clone();
            drop(guard);
            publish_status(app, next_status.clone());
            Ok(next_status)
        }
        Ok(None) => {
            let next_status = if manual {
                UpdateStatus::UpToDate {
                    current_version: current_app_version(app),
                }
            } else {
                UpdateStatus::Idle
            };
            let mut guard = service.inner.lock();
            guard.check_in_flight = false;
            guard.pending_update = None;
            guard.downloaded = None;
            guard.status = next_status.clone();
            drop(guard);
            publish_status(app, next_status.clone());
            Ok(next_status)
        }
        Err(err) => {
            let mut guard = service.inner.lock();
            guard.check_in_flight = false;
            if manual {
                let next_status = UpdateStatus::Error {
                    message: err.message.clone(),
                    info: guard.pending_update.as_ref().map(to_metadata),
                };
                guard.status = next_status.clone();
                drop(guard);
                publish_status(app, next_status);
                Err(err)
            } else {
                // Silent failure on background checks (e.g. offline or pre-first-release).
                let reset = matches!(guard.status, UpdateStatus::Checking);
                if reset {
                    guard.status = UpdateStatus::Idle;
                }
                let current = guard.status.clone();
                drop(guard);
                if reset {
                    publish_status(app, UpdateStatus::Idle);
                }
                Ok(current)
            }
        }
    }
}

pub async fn start_download(app: &AppHandle, service: &UpdaterService) -> IpcResult<UpdateStatus> {
    let update = {
        let guard = service.inner.lock();
        if matches!(
            guard.status,
            UpdateStatus::Downloading { .. } | UpdateStatus::Ready { .. }
        ) {
            return Ok(guard.status.clone());
        }
        guard.pending_update.clone()
    };

    let update = match update {
        Some(u) => u,
        None => {
            let status = run_check(app, service, true).await?;
            let guard = service.inner.lock();
            match guard.pending_update.clone() {
                Some(u) => u,
                None => return Ok(status),
            }
        }
    };

    let info = to_metadata(&update);
    let initial = UpdateStatus::Downloading {
        info: info.clone(),
        downloaded_bytes: 0,
        total_bytes: None,
    };

    {
        let mut guard = service.inner.lock();
        guard.download_gen = guard.download_gen.wrapping_add(1);
        let my_gen = guard.download_gen;
        if let Some(prev) = guard.download_handle.take() {
            prev.abort();
        }
        guard.downloaded = None;
        guard.status = initial.clone();

        let inner = Arc::clone(&service.inner);
        let app_handle = app.clone();
        let update_for_task = update.clone();
        let info_for_task = info.clone();

        let handle = tauri::async_runtime::spawn(async move {
            let mut downloaded_bytes: u64 = 0;
            let mut last_emit = Instant::now() - PROGRESS_EMIT_INTERVAL;

            let result = update_for_task
                .download(
                    |chunk_len, content_length| {
                        downloaded_bytes += chunk_len as u64;
                        if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                            last_emit = Instant::now();
                            let progress_status = UpdateStatus::Downloading {
                                info: info_for_task.clone(),
                                downloaded_bytes,
                                total_bytes: content_length,
                            };
                            let mut guard = inner.lock();
                            if guard.download_gen != my_gen {
                                return;
                            }
                            guard.status = progress_status.clone();
                            drop(guard);
                            publish_status(&app_handle, progress_status);
                        }
                    },
                    || {},
                )
                .await;

            let mut guard = inner.lock();
            if guard.download_gen != my_gen {
                return;
            }
            guard.download_handle = None;
            match result {
                Ok(bytes) => {
                    let ready = UpdateStatus::Ready {
                        info: info_for_task,
                    };
                    guard.downloaded = Some(DownloadedPackage {
                        version: update_for_task.version,
                        bytes,
                    });
                    guard.status = ready.clone();
                    drop(guard);
                    publish_status(&app_handle, ready);
                }
                Err(err) => {
                    let err_status = UpdateStatus::Error {
                        message: err.to_string(),
                        info: Some(info_for_task),
                    };
                    guard.status = err_status.clone();
                    drop(guard);
                    publish_status(&app_handle, err_status);
                }
            }
        });
        guard.download_handle = Some(handle);
    }
    publish_status(app, initial.clone());
    Ok(initial)
}

pub fn cancel_download(app: &AppHandle, service: &UpdaterService) -> UpdateStatus {
    let next = {
        let mut guard = service.inner.lock();
        guard.download_gen = guard.download_gen.wrapping_add(1);
        if let Some(handle) = guard.download_handle.take() {
            handle.abort();
        }
        let next = match guard.pending_update.as_ref() {
            Some(update) => UpdateStatus::Available {
                info: to_metadata(update),
            },
            None => UpdateStatus::Idle,
        };
        guard.status = next.clone();
        next
    };
    publish_status(app, next.clone());
    next
}

pub async fn ignore_version(
    app: &AppHandle,
    service: &UpdaterService,
    version: String,
) -> IpcResult<UpdateStatus> {
    let trimmed = version.trim().to_string();
    if trimmed.is_empty() {
        return Err(error(IpcErrorCode::Invalid, "empty update version"));
    }

    if let Some(app_state) = app.try_state::<AppState>() {
        let mut prefs = app_state.prefs.get();
        prefs.skipped_update_version = Some(trimmed);
        save_preferences(&app_state, prefs).await?;
    }

    {
        let mut guard = service.inner.lock();
        guard.download_gen = guard.download_gen.wrapping_add(1);
        if let Some(handle) = guard.download_handle.take() {
            handle.abort();
        }
        guard.pending_update = None;
        guard.downloaded = None;
        guard.status = UpdateStatus::Idle;
    }
    publish_status(app, UpdateStatus::Idle);
    Ok(UpdateStatus::Idle)
}

pub async fn install_and_restart(app: &AppHandle, service: &UpdaterService) -> IpcResult<()> {
    let (update, bytes, info) = {
        let mut guard = service.inner.lock();
        if guard.installing {
            return Ok(());
        }
        let Some(update) = guard.pending_update.clone() else {
            return Err(error(IpcErrorCode::Invalid, "no update ready to install"));
        };
        let Some(downloaded) = guard.downloaded.take() else {
            return Err(error(
                IpcErrorCode::Invalid,
                "update package not downloaded",
            ));
        };
        if downloaded.version != update.version {
            return Err(error(
                IpcErrorCode::Invalid,
                "downloaded package version mismatch",
            ));
        }
        let info = to_metadata(&update);
        if let Err(err) = update.verify(&downloaded.bytes) {
            let err_status = UpdateStatus::Error {
                message: err.to_string(),
                info: Some(info),
            };
            guard.status = err_status.clone();
            drop(guard);
            publish_status(app, err_status);
            return Err(error(IpcErrorCode::Internal, err.to_string()));
        }
        guard.installing = true;
        (update, downloaded.bytes, info)
    };

    // Cancel running agent runs, save sessions and kill PTYs so no file locks block installation.
    let handle_for_shutdown = app.clone();
    let shutdown_res = tokio::task::spawn_blocking(move || {
        engine::shutdown(&handle_for_shutdown);
        pty::shutdown(&handle_for_shutdown);
    })
    .await;
    if let Err(e) = &shutdown_res {
        eprintln!("bricks-desktop: pre-update shutdown failed: {e}");
    }

    let install_res = match tokio::task::spawn_blocking(move || update.install(&bytes)).await {
        Ok(res) => res,
        Err(e) => {
            service.inner.lock().installing = false;
            return Err(error(IpcErrorCode::Internal, e.to_string()));
        }
    };

    match install_res {
        Ok(()) => {
            app.restart();
        }
        Err(err) => {
            let mut guard = service.inner.lock();
            guard.installing = false;
            let err_status = UpdateStatus::Error {
                message: err.to_string(),
                info: Some(info),
            };
            guard.status = err_status.clone();
            drop(guard);
            publish_status(app, err_status);
            Err(error(IpcErrorCode::Internal, err.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_checks_respect_skipped_version_and_manual_checks_bypass_it() {
        assert!(should_skip_version(Some("26.11.15"), "26.11.15", false));
        assert!(!should_skip_version(Some("26.11.15"), "26.11.16", false));
        assert!(!should_skip_version(Some("26.11.15"), "26.11.15", true));
        assert!(!should_skip_version(None, "26.11.15", false));
    }

    #[test]
    fn background_poll_skips_active_download_or_ready_states() {
        let info = UpdateMetadata {
            current_version: "26.11.14".into(),
            version: "26.11.15".into(),
            pub_date: None,
            notes: None,
        };
        assert!(!should_skip_background_poll(
            &UpdateStatus::Idle,
            false,
            false
        ));
        assert!(should_skip_background_poll(
            &UpdateStatus::Idle,
            true,
            false
        ));
        assert!(should_skip_background_poll(
            &UpdateStatus::Idle,
            false,
            true
        ));
        assert!(should_skip_background_poll(
            &UpdateStatus::Checking,
            false,
            false
        ));
        assert!(should_skip_background_poll(
            &UpdateStatus::Downloading {
                info: info.clone(),
                downloaded_bytes: 10,
                total_bytes: Some(100),
            },
            false,
            false
        ));
        assert!(should_skip_background_poll(
            &UpdateStatus::Ready { info: info.clone() },
            false,
            false
        ));
        assert!(!should_skip_background_poll(
            &UpdateStatus::Available { info },
            false,
            false
        ));
    }
}
