//! The desktop's memory scopes: a global file store shared by every project,
//! and per-project file stores under `<bricks_home>/memory`.

use crate::MemoryConfig;
use bricks_agent::control::RunMemory;
use bricks_memory::{FileNoteStore, MemoryNote, MemoryNotePage, MemoryScope, ScopedFileMemory};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

type Result<T> = std::result::Result<T, String>;

/// A store of a project no longer in the list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RetiredStore {
    pub project_id: String,
    /// The last name known for it, when recorded.
    pub name: Option<String>,
}

/// File-backed memory service managing `global/` and `projects/<project_id>/`.
pub struct MemoryService {
    dir: PathBuf,
    stores: Mutex<HashMap<PathBuf, Arc<FileNoteStore>>>,
}

impl MemoryService {
    /// The memory directory under `<home>/memory`.
    pub fn in_home(home: &Path) -> Self {
        Self {
            dir: home.join("memory"),
            stores: Mutex::new(HashMap::new()),
        }
    }

    /// Return the shared [`FileNoteStore`] for `dir`, ensuring all concurrent
    /// callers (runs + Desktop UI) serialize writes and `MEMORY.md` updates.
    fn shared_store(&self, dir: PathBuf) -> Arc<FileNoteStore> {
        let mut map = self.stores.lock().unwrap_or_else(|e| e.into_inner());
        Arc::clone(
            map.entry(dir.clone())
                .or_insert_with(|| Arc::new(FileNoteStore::new(dir))),
        )
    }

    /// Root memory directory (`<home>/memory`).
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn global_dir(&self) -> PathBuf {
        self.dir.join("global")
    }

    fn project_dir(&self, project_id: &str) -> Result<PathBuf> {
        check_project_id(project_id)?;
        Ok(self.dir.join("projects").join(project_id))
    }

    fn project_meta_path(&self, project_id: &str) -> PathBuf {
        self.dir.join("projects").join(format!("{project_id}.json"))
    }

    fn record_project_name(&self, project_id: &str, name: &str) {
        if check_project_id(project_id).is_err() || name.trim().is_empty() {
            return;
        }
        let path = self.project_meta_path(project_id);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let body = serde_json::json!({ "name": name }).to_string();
        let _ = std::fs::write(path, body);
    }

    fn store_for(
        &self,
        scope: MemoryScope,
        project_id: Option<&str>,
    ) -> Result<Arc<FileNoteStore>> {
        match (scope, project_id) {
            (MemoryScope::Global, _) => Ok(self.shared_store(self.global_dir())),
            (MemoryScope::Project, Some(id)) => Ok(self.shared_store(self.project_dir(id)?)),
            (MemoryScope::Project, None) => Err("the project memory needs a project".into()),
        }
    }

    /// The memory of a run starting now.
    pub fn for_run(&self, project: Option<(&str, &str)>) -> RunMemory {
        self.for_run_in_project(project.map(|(id, name)| (id, name, None)))
    }

    /// Like [`Self::for_run`], optionally receiving the project's directory to
    /// read optional `[memory]` index limits from `bricks.toml`.
    pub fn for_run_in_project(&self, project: Option<(&str, &str, Option<&Path>)>) -> RunMemory {
        let global = self.shared_store(self.global_dir());
        let mut warnings = Vec::new();
        let mut cfg = MemoryConfig::default();

        let (project_store, project_id) = match project {
            Some((id, name, dir)) => {
                if let Some(d) = dir
                    && let Ok(text) = std::fs::read_to_string(d.join("bricks.toml"))
                {
                    match MemoryConfig::from_bricks_toml(&text) {
                        Ok(parsed) => cfg = parsed,
                        Err(e) => warnings.push(format!("bricks.toml: {e}")),
                    }
                }
                match self.project_dir(id) {
                    Ok(pdir) => {
                        self.record_project_name(id, name);
                        (Some(self.shared_store(pdir)), Some(id.to_string()))
                    }
                    Err(e) => {
                        warnings.push(e.to_string());
                        (None, None)
                    }
                }
            }
            None => (None, None),
        };

        let mem = ScopedFileMemory::new(project_store, Some(global), project_id)
            .with_index_limits(cfg.max_index_notes, cfg.max_index_tokens);
        RunMemory {
            memory: Some(Arc::new(mem)),
            warnings,
            guard: None,
        }
    }

    /// Number of stored notes in `scope`.
    pub fn count(&self, scope: MemoryScope, project_id: Option<&str>) -> Result<usize> {
        self.store_for(scope, project_id)?
            .count()
            .map_err(|e| e.to_string())
    }

    /// List notes in `scope`, newest first.
    pub fn list_notes(
        &self,
        scope: MemoryScope,
        project_id: Option<&str>,
        query: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<MemoryNotePage> {
        self.store_for(scope, project_id)?
            .list(query, offset, limit)
            .map_err(|e| e.to_string())
    }

    /// Write a note in `scope`.
    pub fn write_note(
        &self,
        scope: MemoryScope,
        project_id: Option<&str>,
        session_id: Option<&str>,
        text: &str,
    ) -> Result<MemoryNote> {
        self.store_for(scope, project_id)?
            .write(project_id, session_id, text)
            .map_err(|e| e.to_string())
    }

    /// Update an existing note in place in `scope`.
    pub fn update_note(
        &self,
        scope: MemoryScope,
        project_id: Option<&str>,
        id: &str,
        text: &str,
    ) -> Result<Option<MemoryNote>> {
        self.store_for(scope, project_id)?
            .update(id, text)
            .map_err(|e| e.to_string())
    }

    /// Delete one note by `id` in `scope`.
    pub fn delete_note(
        &self,
        scope: MemoryScope,
        project_id: Option<&str>,
        id: &str,
    ) -> Result<bool> {
        self.store_for(scope, project_id)?
            .delete(id)
            .map_err(|e| e.to_string())
    }

    /// Clear every note in `scope`. Returns the number of notes removed.
    pub fn clear(&self, scope: MemoryScope, project_id: Option<&str>) -> Result<usize> {
        self.store_for(scope, project_id)?
            .clear()
            .map_err(|e| e.to_string())
    }

    /// The last name recorded for a project's store.
    pub fn known_name(&self, project_id: &str) -> Option<String> {
        check_project_id(project_id).ok()?;
        std::fs::read_to_string(self.project_meta_path(project_id))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(str::to_string))
    }

    /// Stores of projects not in `known` (ids), with their last names.
    pub fn retired(&self, known: &[String]) -> Vec<RetiredStore> {
        let Ok(dir) = std::fs::read_dir(self.dir.join("projects")) else {
            return Vec::new();
        };
        let mut out: Vec<RetiredStore> = dir
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                if !path.is_dir() {
                    return None;
                }
                let id = e.file_name().to_string_lossy().to_string();
                if check_project_id(&id).is_err() || known.contains(&id) {
                    return None;
                }
                // Only surface retired directories that still contain at least one note.
                let count = FileNoteStore::new(&path).count().unwrap_or(0);
                (count > 0).then_some(id)
            })
            .map(|project_id| RetiredStore {
                name: self.known_name(&project_id),
                project_id,
            })
            .collect();
        out.sort_by(|a, b| a.project_id.cmp(&b.project_id));
        out
    }

    /// Delete the store of a project no longer in the list.
    pub fn delete_retired(&self, project_id: &str) -> Result<usize> {
        let path = self.project_dir(project_id)?;
        let store = self.shared_store(path.clone());
        let removed = store.clear().map_err(|e| e.to_string())?;
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        }
        let _ = std::fs::remove_file(self.project_meta_path(project_id));
        self.stores
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&path);
        Ok(removed)
    }
}

fn check_project_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(format!("invalid project id `{id}`"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn projects_are_isolated_and_global_is_shared() {
        let home = tempfile::tempdir().unwrap();
        let svc = MemoryService::in_home(home.path());

        let a = svc.for_run(Some(("pa", "Alpha"))).memory.unwrap();
        let b = svc.for_run(Some(("pb", "Beta"))).memory.unwrap();

        let id_a = a
            .write_note(MemoryScope::Project, Some("s1"), "Alpha uses Postgres.")
            .await
            .unwrap();
        let id_g = a
            .write_note(MemoryScope::Global, Some("s1"), "Prefers concise replies.")
            .await
            .unwrap();

        assert!(
            b.search(MemoryScope::Project, "Postgres", 5)
                .await
                .unwrap()
                .is_none()
        );
        let found_g = b
            .search(MemoryScope::Global, "concise", 5)
            .await
            .unwrap()
            .unwrap();
        assert!(found_g.text.contains(&id_g));

        assert_eq!(svc.count(MemoryScope::Project, Some("pa")).unwrap(), 1);
        assert!(
            svc.update_note(
                MemoryScope::Project,
                Some("pa"),
                &id_a,
                "Alpha uses Postgres 17."
            )
            .unwrap()
            .is_some()
        );
        assert_eq!(svc.retired(&["pb".into()]).len(), 1);
        assert_eq!(svc.delete_retired("pa").unwrap(), 1);
        assert!(svc.retired(&["pb".into()]).is_empty());
    }
}
