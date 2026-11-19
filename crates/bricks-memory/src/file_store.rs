//! File-based long-term memory: one Markdown file per note plus a generated
//! `MEMORY.md` index, scoped to `project` and `global`.
//!
//! Layout under a scope directory:
//! - `<id>.md`: YAML frontmatter (`id`, `created_at`, `updated_at`, optional
//!   `project_id` and `session_id`) followed by the note text.
//! - `MEMORY.md`: human-readable index regenerated atomically on every write,
//!   update, or delete.
//!
//! Reading never creates directories or files on disk. Writes use temp-file +
//! atomic rename serialized per store.

use crate::{
    LongTermMemory, MemoryNote, MemoryNotePage, MemoryScope, NOTE_MAX_CHARS, RecalledContext,
};
use async_trait::async_trait;
use bricks_types::{BricksError, Result};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

/// Maximum notes returned in a single page.
pub const PAGE_MAX: usize = 200;

/// Default maximum notes injected into the system prompt index.
pub const DEFAULT_MAX_INDEX_NOTES: usize = 200;

/// Default maximum estimated tokens for the injected memory index.
pub const DEFAULT_MAX_INDEX_TOKENS: usize = 1500;

const INDEX_FILE: &str = "MEMORY.md";

/// File-backed store of notes for one scope (`global` or one project).
pub struct FileNoteStore {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl FileNoteStore {
    /// Open a store backed by `dir`. Does not create `dir` until the first write.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            lock: Mutex::new(()),
        }
    }

    /// Directory on disk.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Number of stored notes (0 when the directory does not exist).
    pub fn count(&self) -> Result<usize> {
        let _g = self.lock.lock();
        Ok(self.load_all_unlocked()?.len())
    }

    /// List notes matching optional `query` (case- and accent-insensitive
    /// substring), newest `updated_at` first, ties broken by `id`.
    pub fn list(&self, query: Option<&str>, offset: usize, limit: usize) -> Result<MemoryNotePage> {
        if limit == 0 || limit > PAGE_MAX {
            return Err(BricksError::Config(format!(
                "a page holds 1 to {PAGE_MAX} notes (got {limit})"
            )));
        }
        let _g = self.lock.lock();
        let needle = query.map(normalize_text).unwrap_or_default();
        let mut notes: Vec<MemoryNote> = self
            .load_all_unlocked()?
            .into_iter()
            .filter(|n| needle.is_empty() || normalize_text(&n.text).contains(&needle))
            .collect();
        sort_notes(&mut notes);
        let total = notes.len();
        let page = notes.into_iter().skip(offset).take(limit).collect();
        Ok(MemoryNotePage { notes: page, total })
    }

    /// Search notes by query tokens (case- and accent-insensitive).
    /// Ranks by fraction of matched query tokens, then recency (`updated_at`).
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<MemoryNote>> {
        let limit = limit.clamp(1, PAGE_MAX);
        let norm_query = normalize_text(query);
        let tokens: Vec<&str> = norm_query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| !t.is_empty())
            .collect();
        if tokens.is_empty() {
            return Ok(Vec::new());
        }

        let _g = self.lock.lock();
        let mut scored: Vec<(usize, bool, MemoryNote)> = self
            .load_all_unlocked()?
            .into_iter()
            .filter_map(|note| {
                let hay = normalize_text(&note.text);
                let phrase_match = hay.contains(&norm_query);
                let hits = tokens.iter().filter(|t| hay.contains(**t)).count();
                if hits == 0 {
                    None
                } else {
                    Some((hits, phrase_match, note))
                }
            })
            .collect();

        scored.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| b.1.cmp(&a.1))
                .then_with(|| b.2.updated_at.cmp(&a.2.updated_at))
                .then_with(|| a.2.id.cmp(&b.2.id))
        });

        Ok(scored.into_iter().take(limit).map(|(_, _, n)| n).collect())
    }

    /// Write a new note (or return the existing one if the exact trimmed text
    /// is already stored in this scope). Regenerates `MEMORY.md`.
    pub fn write(
        &self,
        project_id: Option<&str>,
        session_id: Option<&str>,
        text: &str,
    ) -> Result<MemoryNote> {
        let text = validate_note_text(text)?;
        let _g = self.lock.lock();
        let mut existing = self.load_all_unlocked()?;
        if let Some(found) = existing.iter().find(|n| n.text == text) {
            return Ok(found.clone());
        }

        std::fs::create_dir_all(&self.dir).map_err(BricksError::Io)?;
        let now = now_millis();
        let id = new_note_id();
        let note = MemoryNote {
            id: id.clone(),
            text: text.to_string(),
            created_at: now,
            updated_at: now,
            project_id: project_id.map(str::to_string),
            session_id: session_id.map(str::to_string),
        };
        self.write_note_file_unlocked(&note)?;
        existing.push(note.clone());
        self.write_index_unlocked(&existing)?;
        Ok(note)
    }

    /// Update an existing note in place, preserving its `id`, `created_at`,
    /// `project_id`, and `session_id`. Returns `Ok(None)` if `id` does not exist.
    pub fn update(&self, id: &str, text: &str) -> Result<Option<MemoryNote>> {
        validate_note_id(id)?;
        let text = validate_note_text(text)?;
        let _g = self.lock.lock();
        let path = self.note_path(id);
        if !path.is_file() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&path).map_err(BricksError::Io)?;
        let Some(mut note) = parse_note_file(&raw, id) else {
            return Ok(None);
        };
        note.text = text.to_string();
        note.updated_at = now_millis();
        self.write_note_file_unlocked(&note)?;
        let all = self.load_all_unlocked()?;
        self.write_index_unlocked(&all)?;
        Ok(Some(note))
    }

    /// Delete one note by `id`. Returns `true` when the note existed.
    pub fn delete(&self, id: &str) -> Result<bool> {
        validate_note_id(id)?;
        let _g = self.lock.lock();
        let path = self.note_path(id);
        if !path.is_file() {
            return Ok(false);
        }
        std::fs::remove_file(&path).map_err(BricksError::Io)?;
        let all = self.load_all_unlocked()?;
        if all.is_empty() {
            let _ = std::fs::remove_file(self.dir.join(INDEX_FILE));
        } else {
            self.write_index_unlocked(&all)?;
        }
        Ok(true)
    }

    /// Remove all notes and `MEMORY.md` from this store. Returns the count removed.
    pub fn clear(&self) -> Result<usize> {
        let _g = self.lock.lock();
        if !self.dir.exists() {
            return Ok(0);
        }
        let mut removed = 0usize;
        for entry in std::fs::read_dir(&self.dir).map_err(BricksError::Io)? {
            let entry = entry.map_err(BricksError::Io)?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if name == INDEX_FILE {
                let _ = std::fs::remove_file(&path);
            } else if is_note_filename(name) && path.is_file() {
                std::fs::remove_file(&path).map_err(BricksError::Io)?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn note_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.md"))
    }

    fn load_all_unlocked(&self) -> Result<Vec<MemoryNote>> {
        if !self.dir.exists() {
            return Ok(Vec::new());
        }
        let mut notes = Vec::new();
        for entry in std::fs::read_dir(&self.dir).map_err(BricksError::Io)? {
            let entry = entry.map_err(BricksError::Io)?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if !is_note_filename(name) || !path.is_file() {
                continue;
            }
            let fallback_id = name.strip_suffix(".md").unwrap_or(name);
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Some(note) = parse_note_file(&raw, fallback_id) {
                notes.push(note);
            }
        }
        Ok(notes)
    }

    fn write_note_file_unlocked(&self, note: &MemoryNote) -> Result<()> {
        let content = render_note_file(note);
        atomic_write(&self.note_path(&note.id), content.as_bytes())
    }

    fn write_index_unlocked(&self, notes: &[MemoryNote]) -> Result<()> {
        let mut sorted = notes.to_vec();
        sort_notes(&mut sorted);
        let mut out = String::from("# Bricks Memory Index\n\n");
        for note in &sorted {
            out.push_str("- [");
            out.push_str(&note.id);
            out.push_str("] ");
            out.push_str(&single_line(&note.text));
            out.push('\n');
        }
        atomic_write(&self.dir.join(INDEX_FILE), out.as_bytes())
    }
}

/// Combined `project` + `global` file-backed long-term memory exposed to an agent.
pub struct ScopedFileMemory {
    project: Option<Arc<FileNoteStore>>,
    global: Option<Arc<FileNoteStore>>,
    project_id: Option<String>,
    max_index_notes: usize,
    max_index_tokens: usize,
}

impl ScopedFileMemory {
    pub fn new(
        project: Option<Arc<FileNoteStore>>,
        global: Option<Arc<FileNoteStore>>,
        project_id: Option<String>,
    ) -> Self {
        Self {
            project,
            global,
            project_id,
            max_index_notes: DEFAULT_MAX_INDEX_NOTES,
            max_index_tokens: DEFAULT_MAX_INDEX_TOKENS,
        }
    }

    pub fn with_index_limits(mut self, max_notes: usize, max_tokens: usize) -> Self {
        self.max_index_notes = max_notes.max(1);
        self.max_index_tokens = max_tokens.max(64);
        self
    }

    fn store(&self, scope: MemoryScope) -> Result<&FileNoteStore> {
        match scope {
            MemoryScope::Project => self.project.as_deref(),
            MemoryScope::Global => self.global.as_deref(),
        }
        .ok_or_else(|| {
            BricksError::Config(format!(
                "the {} memory is not available here",
                scope.as_str()
            ))
        })
    }
}

#[async_trait]
impl LongTermMemory for ScopedFileMemory {
    async fn recall_context(
        &self,
        _query: &str,
        max_tokens: usize,
    ) -> Result<Option<RecalledContext>> {
        let token_budget = max_tokens.min(self.max_index_tokens).max(64);
        let char_budget = token_budget.saturating_mul(4);

        let (project_notes, project_total) = match &self.project {
            Some(s) => {
                let page = s.list(None, 0, PAGE_MAX)?;
                (page.notes, page.total)
            }
            None => (Vec::new(), 0),
        };
        let (global_notes, global_total) = match &self.global {
            Some(s) => {
                let page = s.list(None, 0, PAGE_MAX)?;
                (page.notes, page.total)
            }
            None => (Vec::new(), 0),
        };

        let total_available = project_total + global_total;
        if total_available == 0 {
            return Ok(None);
        }

        let mut rendered = String::new();
        let mut included = 0usize;

        let mut append_section = |title: &str, notes: &[MemoryNote]| {
            if notes.is_empty() || included >= self.max_index_notes {
                return;
            }
            let header = if rendered.is_empty() {
                format!("{title}:\n")
            } else {
                format!("\n{title}:\n")
            };
            if rendered.len() + header.len() > char_budget {
                return;
            }
            let mut wrote_header = false;
            for note in notes {
                if included >= self.max_index_notes {
                    break;
                }
                let line = format!("- [{}] {}\n", note.id, single_line(&note.text));
                let needed = line.len() + if wrote_header { 0 } else { header.len() };
                if rendered.len() + needed > char_budget {
                    break;
                }
                if !wrote_header {
                    rendered.push_str(&header);
                    wrote_header = true;
                }
                rendered.push_str(&line);
                included += 1;
            }
        };

        append_section("Project memory notes", &project_notes);
        append_section("Global memory notes", &global_notes);

        if included == 0 {
            return Ok(None);
        }

        let tokens = rendered.len().div_ceil(4) as u64;
        Ok(Some(RecalledContext {
            text: rendered.trim_end().to_string(),
            tokens,
            items: included,
            omitted: total_available.saturating_sub(included),
            warnings: Vec::new(),
        }))
    }

    async fn search(
        &self,
        scope: MemoryScope,
        query: &str,
        limit: usize,
    ) -> Result<Option<RecalledContext>> {
        let store = self.store(scope)?;
        let found = store.search(query, limit.clamp(1, 20))?;
        if found.is_empty() {
            return Ok(None);
        }
        let mut text = String::new();
        for note in &found {
            text.push_str("- [");
            text.push_str(&note.id);
            text.push_str("] ");
            text.push_str(&single_line(&note.text));
            text.push('\n');
        }
        let text = text.trim_end().to_string();
        let tokens = text.len().div_ceil(4) as u64;
        Ok(Some(RecalledContext {
            text,
            tokens,
            items: found.len(),
            omitted: 0,
            warnings: Vec::new(),
        }))
    }

    async fn list_notes(
        &self,
        scope: MemoryScope,
        query: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<MemoryNotePage> {
        let store = self.store(scope)?;
        store.list(query, offset, limit)
    }

    async fn write_note(
        &self,
        scope: MemoryScope,
        session_id: Option<&str>,
        text: &str,
    ) -> Result<String> {
        let store = self.store(scope)?;
        let note = store.write(self.project_id.as_deref(), session_id, text)?;
        Ok(note.id)
    }

    async fn update_note(&self, scope: MemoryScope, id: &str, text: &str) -> Result<bool> {
        let store = self.store(scope)?;
        Ok(store.update(id, text)?.is_some())
    }

    async fn delete_note(&self, scope: MemoryScope, id: &str) -> Result<bool> {
        let store = self.store(scope)?;
        store.delete(id)
    }
}

fn validate_note_text(text: &str) -> Result<&str> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(BricksError::Config("a note needs text".into()));
    }
    if trimmed.chars().count() > NOTE_MAX_CHARS {
        return Err(BricksError::Config(format!(
            "a note holds at most {NOTE_MAX_CHARS} characters"
        )));
    }
    Ok(trimmed)
}

fn validate_note_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(BricksError::Config(format!("invalid note id `{id}`")));
    }
    Ok(())
}

fn new_note_id() -> String {
    let hex = Uuid::new_v4().simple().to_string();
    format!("note_{}", &hex[..12])
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn is_note_filename(name: &str) -> bool {
    name.ends_with(".md") && name != INDEX_FILE && !name.starts_with('.')
}

fn sort_notes(notes: &mut [MemoryNote]) {
    notes.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn single_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn render_note_file(note: &MemoryNote) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("id: {}\n", note.id));
    out.push_str(&format!("created_at: {}\n", note.created_at));
    out.push_str(&format!("updated_at: {}\n", note.updated_at));
    if let Some(pid) = &note.project_id {
        out.push_str(&format!("project_id: {pid}\n"));
    }
    if let Some(sid) = &note.session_id {
        out.push_str(&format!("session_id: {sid}\n"));
    }
    out.push_str("---\n");
    out.push_str(&note.text);
    out.push('\n');
    out
}

fn parse_note_file(raw: &str, fallback_id: &str) -> Option<MemoryNote> {
    let stripped = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"));
    let (frontmatter, body) = if let Some(rest) = stripped {
        if let Some(idx) = rest.find("\n---\n") {
            (&rest[..idx], &rest[idx + 5..])
        } else if let Some(idx) = rest.find("\r\n---\r\n") {
            (&rest[..idx], &rest[idx + 7..])
        } else {
            ("", raw)
        }
    } else {
        ("", raw)
    };

    let mut id = fallback_id.to_string();
    let mut created_at: i64 = 0;
    let mut updated_at: i64 = 0;
    let mut project_id: Option<String> = None;
    let mut session_id: Option<String> = None;

    for line in frontmatter.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim();
        match key {
            "id" if !val.is_empty() => id = val.to_string(),
            "created_at" => {
                if let Ok(n) = val.parse::<i64>() {
                    created_at = n;
                }
            }
            "updated_at" => {
                if let Ok(n) = val.parse::<i64>() {
                    updated_at = n;
                }
            }
            "project_id" if !val.is_empty() => project_id = Some(val.to_string()),
            "session_id" if !val.is_empty() => session_id = Some(val.to_string()),
            _ => {}
        }
    }

    if updated_at == 0 {
        updated_at = created_at;
    }
    let text = body.trim().to_string();
    if text.is_empty() {
        return None;
    }

    Some(MemoryNote {
        id,
        text,
        created_at,
        updated_at,
        project_id,
        session_id,
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| BricksError::Config(format!("invalid path: {}", path.display())))?;
    std::fs::create_dir_all(parent).map_err(BricksError::Io)?;
    let tmp = parent.join(format!(".tmp.{}", Uuid::new_v4().simple()));
    std::fs::write(&tmp, bytes).map_err(BricksError::Io)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(BricksError::Io(e));
    }
    Ok(())
}

/// Lowercase and fold common Latin diacritics for accent-insensitive matching.
fn normalize_text(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ý' | 'ÿ' => 'y',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_and_index_generation() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileNoteStore::new(dir.path().join("notes"));
        assert_eq!(store.count().unwrap(), 0);
        assert!(!store.dir().exists(), "reading must not create directory");

        let n1 = store
            .write(Some("p1"), Some("s1"), "Use cargo nextest for Rust tests.")
            .unwrap();
        assert!(store.dir().join(format!("{}.md", n1.id)).is_file());
        let index = std::fs::read_to_string(store.dir().join(INDEX_FILE)).unwrap();
        assert!(index.contains(&n1.id));
        assert!(index.contains("cargo nextest"));

        // Duplicate text returns same id.
        let dup = store
            .write(
                Some("p1"),
                Some("s2"),
                "  Use cargo nextest for Rust tests.  ",
            )
            .unwrap();
        assert_eq!(dup.id, n1.id);
        assert_eq!(store.count().unwrap(), 1);

        // Update in place preserves id and created_at.
        let updated = store
            .update(&n1.id, "Always run cargo nextest run --workspace.")
            .unwrap()
            .expect("note exists");
        assert_eq!(updated.id, n1.id);
        assert_eq!(updated.created_at, n1.created_at);
        assert_eq!(updated.text, "Always run cargo nextest run --workspace.");

        // Search is case- and accent-insensitive.
        let found = store.search("NEXTEST workspace", 5).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, n1.id);

        // Delete removes file and cleans index.
        assert!(store.delete(&n1.id).unwrap());
        assert!(!store.delete(&n1.id).unwrap());
        assert_eq!(store.count().unwrap(), 0);
        assert!(!store.dir().join(INDEX_FILE).exists());
    }

    #[test]
    fn rejects_invalid_ids_and_oversized_notes() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileNoteStore::new(dir.path());
        assert!(store.write(None, None, "   ").is_err());
        assert!(
            store
                .write(None, None, &"a".repeat(NOTE_MAX_CHARS + 1))
                .is_err()
        );
        assert!(store.update("../evil", "hi").is_err());
        assert!(store.delete("foo/bar").is_err());
    }

    #[tokio::test]
    async fn scoped_memory_recalls_index_and_isolates_scopes() {
        let dir = tempfile::tempdir().unwrap();
        let proj = Arc::new(FileNoteStore::new(dir.path().join("proj")));
        let glob = Arc::new(FileNoteStore::new(dir.path().join("global")));
        let mem = ScopedFileMemory::new(Some(proj), Some(glob), Some("p1".into()));

        let pid = mem
            .write_note(MemoryScope::Project, Some("s1"), "Project uses Svelte 5.")
            .await
            .unwrap();
        let gid = mem
            .write_note(
                MemoryScope::Global,
                Some("s1"),
                "User prefers French replies.",
            )
            .await
            .unwrap();

        let recalled = mem
            .recall_context("unrelated prompt", 1000)
            .await
            .unwrap()
            .unwrap();
        assert!(recalled.text.contains(&pid));
        assert!(recalled.text.contains(&gid));
        assert_eq!(recalled.items, 2);

        // Updating in global does not affect project.
        assert!(
            mem.update_note(MemoryScope::Global, &gid, "User prefers concise French.")
                .await
                .unwrap()
        );
        assert!(
            !mem.update_note(MemoryScope::Project, &gid, "wrong scope")
                .await
                .unwrap()
        );

        let page = mem
            .list_notes(MemoryScope::Global, None, 0, 10)
            .await
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.notes[0].text, "User prefers concise French.");

        assert!(mem.delete_note(MemoryScope::Project, &pid).await.unwrap());
        assert_eq!(
            mem.list_notes(MemoryScope::Project, None, 0, 10)
                .await
                .unwrap()
                .total,
            0
        );
    }
}
