//! The long-term memory of the desktop: each run's file-backed note memory,
//! from the preference and configured projects. Reading, editing and clearing
//! work whatever the preference.

use super::AppState;
use crate::contract::*;
use crate::i18n::{msg, tr};
use crate::services::error;
use crate::services::prefs::PrefsStore;
use crate::services::projects::ProjectStore;
use bricks_agent::control::{MemoryResolver, RunMemory};
use bricks_config::MemoryService;
use bricks_memory::MemoryScope as BackendScope;
use std::path::Path;
use std::sync::Arc;

fn to_backend_scope(s: MemoryScope) -> BackendScope {
    match s {
        MemoryScope::Project => BackendScope::Project,
        MemoryScope::Global => BackendScope::Global,
    }
}

fn memory_err(e: impl std::fmt::Display) -> IpcError {
    error(IpcErrorCode::Invalid, e.to_string())
}

/// The memory of each run of one session of `project_id`.
pub(crate) struct DesktopMemory {
    pub service: Arc<MemoryService>,
    pub prefs: Arc<PrefsStore>,
    pub projects: Arc<ProjectStore>,
    pub project_id: String,
}

impl MemoryResolver for DesktopMemory {
    fn resolve(&self, _session_id: &str) -> RunMemory {
        if !self.prefs.get().memory_enabled {
            return RunMemory::default();
        }
        // The conversations of no project have no project memory.
        let project = self
            .projects
            .get(&self.project_id)
            .ok()
            .filter(|p| !p.chats);
        self.service.for_run_in_project(
            project
                .as_ref()
                .map(|p| (p.id.as_str(), p.name.as_str(), Some(Path::new(&p.path)))),
        )
    }
}

impl AppState {
    /// The project id a memory command uses: none for the conversations of
    /// no project.
    fn memory_project(&self, project_id: Option<&str>) -> IpcResult<Option<String>> {
        match project_id {
            None => Ok(None),
            Some(id) => {
                let p = self.projects.get(id)?;
                Ok((!p.chats).then_some(p.id))
            }
        }
    }

    /// The project id of a scope: a project scope needs a project.
    fn scoped_project(
        &self,
        s: MemoryScope,
        project_id: Option<&str>,
    ) -> IpcResult<Option<String>> {
        let project = self.memory_project(project_id)?;
        if s == MemoryScope::Project && project.is_none() {
            return Err(error(IpcErrorCode::Invalid, tr!(msg::NO_OPEN_PROJECT)));
        }
        Ok(project)
    }

    fn note_counts(&self, s: MemoryScope, project_id: Option<&str>) -> IpcResult<MemoryCounts> {
        let notes = self
            .memory
            .count(to_backend_scope(s), project_id)
            .map_err(memory_err)?;
        Ok(MemoryCounts {
            notes: notes.min(u32::MAX as usize) as u32,
        })
    }

    pub async fn memory_overview(&self, project_id: Option<String>) -> IpcResult<MemoryOverview> {
        let project = self.memory_project(project_id.as_deref())?;
        let known: Vec<String> = self.projects.list().into_iter().map(|p| p.id).collect();
        let retired = self
            .memory
            .retired(&known)
            .into_iter()
            .map(|r| RetiredMemory {
                project_id: r.project_id,
                name: r.name,
            })
            .collect();
        let global = self.note_counts(MemoryScope::Global, None)?;
        let project_counts = match project.as_deref() {
            Some(pid) => Some(self.note_counts(MemoryScope::Project, Some(pid))?),
            None => None,
        };
        Ok(MemoryOverview {
            global,
            project: project_counts,
            retired,
        })
    }

    pub async fn memory_counts(
        &self,
        s: MemoryScope,
        project_id: Option<String>,
    ) -> IpcResult<MemoryCounts> {
        let project = self.scoped_project(s, project_id.as_deref())?;
        self.note_counts(s, project.as_deref())
    }

    pub async fn memory_entries(
        &self,
        s: MemoryScope,
        project_id: Option<String>,
        f: MemoryEntryFilter,
        query: String,
        offset: u32,
        limit: u32,
    ) -> IpcResult<MemoryEntryPage> {
        if !(1..=50).contains(&limit) {
            return Err(error(IpcErrorCode::Invalid, tr!(msg::A_PAGE_HOLDS_1_TO_50)));
        }
        let project = self.scoped_project(s, project_id.as_deref())?;
        if !matches!(f, MemoryEntryFilter::All | MemoryEntryFilter::Notes) {
            return Ok(MemoryEntryPage {
                entries: Vec::new(),
                total: 0,
            });
        }
        let q = query.trim();
        let page = self
            .memory
            .list_notes(
                to_backend_scope(s),
                project.as_deref(),
                (!q.is_empty()).then_some(q),
                offset as usize,
                limit as usize,
            )
            .map_err(memory_err)?;
        let entries = page
            .notes
            .into_iter()
            .map(|n| {
                let project_name = n.project_id.as_deref().and_then(|pid| {
                    self.projects
                        .get(pid)
                        .ok()
                        .map(|p| p.name)
                        .or_else(|| self.memory.known_name(pid))
                });
                MemoryEntry {
                    id: n.id,
                    kind: MemoryEntryKind::Note,
                    text: n.text,
                    at: n.updated_at,
                    role: Some("note".to_string()),
                    project_id: n.project_id,
                    project_name,
                    session_id: n.session_id,
                }
            })
            .collect();
        Ok(MemoryEntryPage {
            entries,
            total: page.total.min(u32::MAX as usize) as u32,
        })
    }

    /// Updates a single stored note in place.
    pub async fn memory_update_note(
        &self,
        s: MemoryScope,
        project_id: Option<String>,
        id: String,
        text: String,
    ) -> IpcResult<bool> {
        let project = self.scoped_project(s, project_id.as_deref())?;
        let updated = self
            .memory
            .update_note(to_backend_scope(s), project.as_deref(), &id, &text)
            .map_err(memory_err)?;
        Ok(updated.is_some())
    }

    /// Deletes a single stored note entry.
    pub async fn memory_delete_entry(
        &self,
        s: MemoryScope,
        project_id: Option<String>,
        kind: MemoryEntryKind,
        id: String,
    ) -> IpcResult<bool> {
        let project = self.scoped_project(s, project_id.as_deref())?;
        if kind != MemoryEntryKind::Note {
            return Ok(false);
        }
        self.memory
            .delete_note(to_backend_scope(s), project.as_deref(), &id)
            .map_err(memory_err)
    }

    /// Clears a scope's store.
    pub async fn memory_delete(&self, s: MemoryScope, project_id: Option<String>) -> IpcResult<()> {
        let project = self.scoped_project(s, project_id.as_deref())?;
        self.memory
            .clear(to_backend_scope(s), project.as_deref())
            .map_err(memory_err)?;
        Ok(())
    }

    /// Deletes the store of a project no longer in the list.
    pub async fn memory_delete_retired(&self, project_id: String) -> IpcResult<()> {
        if self.projects.get(&project_id).is_ok() {
            return Err(error(
                IpcErrorCode::Invalid,
                tr!(msg::THIS_PROJECT_IS_STILL_IN_THE),
            ));
        }
        self.memory
            .delete_retired(&project_id)
            .map_err(memory_err)?;
        Ok(())
    }
}
