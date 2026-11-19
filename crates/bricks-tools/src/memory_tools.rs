//! Long-term memory tools (`memory_search`, `memory_list`, `memory_write`,
//! `memory_update`, `memory_delete`), scoped to `project` (default) or `global`.
//!
//! All tools use the memory the run started with ([`RunMemory`], set by the
//! session at the start of each run). When memory is off for the run, they
//! refuse with `memory_disabled`. Permissions follow the session policy:
//! `memory_search` and `memory_list` are `ReadOnly`; `memory_write`,
//! `memory_update`, and `memory_delete` are `Write`.

use super::*;
use bricks_memory::{LongTermMemory, MemoryScope};
use serde::Deserialize;

/// Read-only memory tool names.
pub const MEMORY_READ_TOOLS: [&str; 2] = ["memory_search", "memory_list"];

/// Mutating memory tool names.
pub const MEMORY_WRITE_TOOLS: [&str; 3] = ["memory_write", "memory_update", "memory_delete"];

/// Names of all memory tools.
pub const MEMORY_TOOLS: [&str; 5] = [
    "memory_search",
    "memory_list",
    "memory_write",
    "memory_update",
    "memory_delete",
];

/// The memory of the current run (`None`: off for this run).
#[derive(Clone, Default)]
pub struct RunMemory(pub Option<Arc<dyn LongTermMemory>>);

/// The run's memory from the context, or the `memory_disabled` refusal.
fn run_memory(ctx: &ToolContext) -> std::result::Result<Arc<dyn LongTermMemory>, ToolResult> {
    ctx.extensions
        .get::<RunMemory>()
        .and_then(|m| m.0.clone())
        .ok_or_else(|| ToolResult::error("memory_disabled: the memory is off for this run."))
}

fn scope_schema() -> Value {
    serde_json::json!({
        "type": "string",
        "enum": ["project", "global"],
        "description": "project (default): this project's memory. global: shared by every project."
    })
}

fn default_search_limit() -> usize {
    5
}

fn default_list_limit() -> usize {
    20
}

pub struct MemorySearchTool;

#[async_trait]
impl Tool for MemorySearchTool {
    fn name(&self) -> &str {
        "memory_search"
    }
    fn description(&self) -> &str {
        "Search long-term memory notes by keywords in the project or global scope. \
         Returns matching notes with their ids."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::ReadOnly
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::Memory
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "What to look for" },
                "scope": scope_schema(),
                "limit": {
                    "type": "integer", "minimum": 1, "maximum": 20,
                    "description": "Results at most (default 5)"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            query: String,
            #[serde(default)]
            scope: Option<MemoryScope>,
            #[serde(default = "default_search_limit")]
            limit: usize,
        }
        let input: Input = match crate::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        if input.query.trim().is_empty() {
            return ToolResult::error("`query` is empty.");
        }
        if !(1..=20).contains(&input.limit) {
            return ToolResult::error("`limit` must be between 1 and 20.");
        }
        let memory = match run_memory(ctx) {
            Ok(m) => m,
            Err(e) => return e,
        };
        let scope = input.scope.unwrap_or(MemoryScope::Project);
        match memory.search(scope, &input.query, input.limit).await {
            Ok(Some(found)) => ToolResult::success(found.text),
            Ok(None) => {
                ToolResult::success(format!("Nothing in the {} memory matches.", scope.as_str()))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}

pub struct MemoryListTool;

#[async_trait]
impl Tool for MemoryListTool {
    fn name(&self) -> &str {
        "memory_list"
    }
    fn description(&self) -> &str {
        "List saved long-term memory notes (newest first) with their ids, optionally \
         filtered by a substring query."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::ReadOnly
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::Memory
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "scope": scope_schema(),
                "query": {
                    "type": "string",
                    "description": "Optional substring filter (case- and accent-insensitive)"
                },
                "offset": {
                    "type": "integer", "minimum": 0,
                    "description": "Pagination offset (default 0)"
                },
                "limit": {
                    "type": "integer", "minimum": 1, "maximum": 50,
                    "description": "Notes to return (default 20, max 50)"
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            #[serde(default)]
            scope: Option<MemoryScope>,
            #[serde(default)]
            query: Option<String>,
            #[serde(default)]
            offset: usize,
            #[serde(default = "default_list_limit")]
            limit: usize,
        }
        let input: Input = match crate::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        if !(1..=50).contains(&input.limit) {
            return ToolResult::error("`limit` must be between 1 and 50.");
        }
        let memory = match run_memory(ctx) {
            Ok(m) => m,
            Err(e) => return e,
        };
        let scope = input.scope.unwrap_or(MemoryScope::Project);
        let q = input
            .query
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        match memory.list_notes(scope, q, input.offset, input.limit).await {
            Ok(page) if page.notes.is_empty() => {
                ToolResult::success(format!("No notes in the {} memory.", scope.as_str()))
            }
            Ok(page) => {
                let mut out = format!(
                    "{} memory notes ({}–{} of {}):\n",
                    scope.as_str(),
                    input.offset + 1,
                    input.offset + page.notes.len(),
                    page.total
                );
                for note in &page.notes {
                    out.push_str(&format!("- [{}] {}\n", note.id, note.text));
                }
                ToolResult::success(out.trim_end().to_string())
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}

pub struct MemoryWriteTool;

#[async_trait]
impl Tool for MemoryWriteTool {
    fn name(&self) -> &str {
        "memory_write"
    }
    fn description(&self) -> &str {
        "Save a very brief, single-fact durable note in long-term memory (at most 280 chars). \
         Use memory_update to fix an existing note or memory_delete to remove an obsolete one."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Write
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::Memory
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "maxLength": bricks_memory::NOTE_MAX_CHARS,
                    "description": "Ultra-concise atomic note (1 short sentence, max 280 chars)"
                },
                "scope": scope_schema()
            },
            "required": ["text"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            text: String,
            #[serde(default)]
            scope: Option<MemoryScope>,
        }
        let input: Input = match crate::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        if input.text.trim().is_empty() {
            return ToolResult::error("`text` is empty.");
        }
        let memory = match run_memory(ctx) {
            Ok(m) => m,
            Err(e) => return e,
        };
        let scope = input.scope.unwrap_or(MemoryScope::Project);
        let session = (!ctx.session_id.is_empty()).then_some(ctx.session_id.as_str());
        match memory.write_note(scope, session, &input.text).await {
            Ok(id) => {
                ToolResult::success(format!("Saved in the {} memory as {id}.", scope.as_str()))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}

pub struct MemoryUpdateTool;

#[async_trait]
impl Tool for MemoryUpdateTool {
    fn name(&self) -> &str {
        "memory_update"
    }
    fn description(&self) -> &str {
        "Update an existing long-term memory note in place by id (at most 280 chars), \
         keeping the same id."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Write
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::Memory
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "The note id to update" },
                "text": {
                    "type": "string",
                    "maxLength": bricks_memory::NOTE_MAX_CHARS,
                    "description": "Replacement atomic note text (max 280 chars)"
                },
                "scope": scope_schema()
            },
            "required": ["id", "text"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            id: String,
            text: String,
            #[serde(default)]
            scope: Option<MemoryScope>,
        }
        let input: Input = match crate::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        if input.id.trim().is_empty() {
            return ToolResult::error("`id` is empty.");
        }
        if input.text.trim().is_empty() {
            return ToolResult::error("`text` is empty.");
        }
        let memory = match run_memory(ctx) {
            Ok(m) => m,
            Err(e) => return e,
        };
        let scope = input.scope.unwrap_or(MemoryScope::Project);
        match memory
            .update_note(scope, input.id.trim(), &input.text)
            .await
        {
            Ok(true) => ToolResult::success(format!(
                "Updated note {} in the {} memory.",
                input.id.trim(),
                scope.as_str()
            )),
            Ok(false) => ToolResult::error(format!(
                "Note `{}` was not found in the {} memory.",
                input.id.trim(),
                scope.as_str()
            )),
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}

pub struct MemoryDeleteTool;

#[async_trait]
impl Tool for MemoryDeleteTool {
    fn name(&self) -> &str {
        "memory_delete"
    }
    fn description(&self) -> &str {
        "Delete an obsolete or wrong long-term memory note by id."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Write
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::Memory
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "The note id to delete" },
                "scope": scope_schema()
            },
            "required": ["id"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            id: String,
            #[serde(default)]
            scope: Option<MemoryScope>,
        }
        let input: Input = match crate::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        if input.id.trim().is_empty() {
            return ToolResult::error("`id` is empty.");
        }
        let memory = match run_memory(ctx) {
            Ok(m) => m,
            Err(e) => return e,
        };
        let scope = input.scope.unwrap_or(MemoryScope::Project);
        match memory.delete_note(scope, input.id.trim()).await {
            Ok(true) => ToolResult::success(format!(
                "Deleted note {} from the {} memory.",
                input.id.trim(),
                scope.as_str()
            )),
            Ok(false) => ToolResult::error(format!(
                "Note `{}` was not found in the {} memory.",
                input.id.trim(),
                scope.as_str()
            )),
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}

/// Read-only memory tools (`memory_search`, `memory_list`).
pub fn memory_read_tools() -> Vec<Box<dyn Tool>> {
    vec![Box::new(MemorySearchTool), Box::new(MemoryListTool)]
}

/// Mutating memory tools (`memory_write`, `memory_update`, `memory_delete`).
pub fn memory_write_tools() -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(MemoryWriteTool),
        Box::new(MemoryUpdateTool),
        Box::new(MemoryDeleteTool),
    ]
}

/// All five memory tools.
pub fn memory_tools() -> Vec<Box<dyn Tool>> {
    let mut tools = memory_read_tools();
    tools.extend(memory_write_tools());
    tools
}

#[cfg(test)]
mod tests {
    use super::*;
    use bricks_memory::{FileNoteStore, ScopedFileMemory};

    #[test]
    fn write_and_update_schemas_match_note_char_limit() {
        for schema in [
            MemoryWriteTool.input_schema(),
            MemoryUpdateTool.input_schema(),
        ] {
            assert_eq!(
                schema["properties"]["text"]["maxLength"].as_u64(),
                Some(bricks_memory::NOTE_MAX_CHARS as u64)
            );
        }
    }

    #[tokio::test]
    async fn memory_tools_full_crud_cycle() {
        let dir = tempfile::tempdir().unwrap();
        let mem: Arc<dyn LongTermMemory> = Arc::new(ScopedFileMemory::new(
            Some(Arc::new(FileNoteStore::new(dir.path().join("project")))),
            Some(Arc::new(FileNoteStore::new(dir.path().join("global")))),
            Some("p1".into()),
        ));
        let ctx = ToolContext {
            working_dir: dir.path().to_path_buf(),
            session_id: "s1".into(),
            permissions: Arc::new(permissions::AllowAll),
            cost_tracker: Arc::new(CostTracker::new()),
            mcp_manager: None,
            extensions: Extensions::default(),
        };
        ctx.extensions.insert(RunMemory(Some(mem)));

        let write_res = MemoryWriteTool
            .execute(serde_json::json!({"text": "Use cargo nextest."}), &ctx)
            .await;
        assert!(!write_res.is_error, "{}", write_res.content);
        let id = write_res
            .content
            .split(" as ")
            .nth(1)
            .unwrap()
            .trim_end_matches('.')
            .to_string();

        let list_res = MemoryListTool.execute(serde_json::json!({}), &ctx).await;
        assert!(!list_res.is_error);
        assert!(list_res.content.contains(&id));

        let upd_res = MemoryUpdateTool
            .execute(
                serde_json::json!({"id": id, "text": "Use cargo nextest run --workspace."}),
                &ctx,
            )
            .await;
        assert!(!upd_res.is_error, "{}", upd_res.content);

        let search_res = MemorySearchTool
            .execute(serde_json::json!({"query": "workspace"}), &ctx)
            .await;
        assert!(!search_res.is_error);
        assert!(search_res.content.contains("cargo nextest run --workspace"));

        let del_res = MemoryDeleteTool
            .execute(serde_json::json!({"id": id}), &ctx)
            .await;
        assert!(!del_res.is_error, "{}", del_res.content);

        let list_after = MemoryListTool.execute(serde_json::json!({}), &ctx).await;
        assert!(list_after.content.contains("No notes"));
    }
}
