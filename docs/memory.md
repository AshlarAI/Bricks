# Long-term memory

Bricks can remember short, durable notes between sessions. Memory is off by default.
When enabled, Bricks injects a compact index of active notes into the system prompt at the start of each run and gives the agent tools to read, search, write, update, and delete notes.

The implementation lives in `crates/bricks-memory/src/file_store.rs`. Conversation history (saved transcripts) is separate and stays in JSONL files (`session_storage.rs`).

## How it works

1. **Markdown files on disk.** Each note is stored as a `<id>.md` file with minimal YAML frontmatter (`id`, `created_at`, `updated_at`, and optional `project_id` / `session_id`) followed by the note text (at most 280 characters).
2. **Generated index (`MEMORY.md`).** Every write, update, or delete atomically regenerates `MEMORY.md` in that scope directory so you can inspect your notes in any editor.
3. **Always-on prompt index.** At the start of each run, Bricks injects a compact list of active project and global notes (with their `id`s) within the configured token and note limits.
4. **In-place editing.** Updating a note keeps its `id` and `created_at` timestamp intact. Deleting a note removes its file and updates `MEMORY.md`.

## Scopes

Bricks Desktop keeps two scope directories under the Bricks home folder (`~/.bricks/memory/`):

| Scope | Path |
|---|---|
| Global (shared across all projects) | `~/.bricks/memory/global/` |
| Project | `~/.bricks/memory/projects/<project_id>/` |

Outside Desktop (CLI / SDK), enabling `[memory]` in `bricks.toml` stores project notes in `<workspace>/.bricks/memory/` and shares `~/.bricks/memory/global/`.

## Agent tools

When memory is enabled for a run, the agent receives five dedicated tools:

- `memory_list` (read-only): lists saved notes (newest first) with their `id`s, with optional substring filtering and pagination.
- `memory_search` (read-only): searches notes by keywords (case- and accent-insensitive).
- `memory_write` (write): saves a concise atomic note (max 280 characters) and returns its `id`.
- `memory_update` (write): updates an existing note in place by `id`.
- `memory_delete` (write): deletes an obsolete note by `id`.

Read-only sub-agents only receive `memory_search` and `memory_list`. Sub-agents with `memory: off` receive none.

## Settings

Memory can be configured in the `[memory]` section of `bricks.toml`:

```toml
[memory]
enabled = false
max_index_notes = 200
max_index_tokens = 1500
```

In Bricks Desktop, toggle memory in **Settings > Memory** and use **View** to search, edit notes in place, or delete notes for either scope.
