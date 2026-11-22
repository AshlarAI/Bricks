# Long-term memory

Bricks can remember short, durable notes between sessions. Memory is off by default.
When enabled, Bricks injects a compact index of active notes into the system prompt at the start of each run and gives the agent tools to list, search, write, update, and delete notes.

The implementation lives in `crates/bricks-memory/src/file_store.rs`. Conversation history (saved transcripts) is separate and stays in JSONL files (`session_storage.rs`).

## How it works

1. **Markdown files on disk.** Each note is stored as a `<id>.md` file with minimal YAML frontmatter (`id`, `created_at`, `updated_at`, and optional `project_id` / `session_id`) followed by the note text. Ids look like `note_3f9c1a2b4d5e`.
2. **Generated index (`MEMORY.md`).** Every write, update, or delete atomically regenerates `MEMORY.md` in that scope directory so you can inspect your notes in any editor.
3. **Prompt index.** At the start of each run, Bricks injects a compact list of active project and global notes (with their `id`s) within the configured token and note limits. Notes beyond those limits stay on disk and are reached with `memory_search` or `memory_list`.
4. **In-place editing.** Updating a note keeps its `id` and `created_at` timestamp intact. Deleting a note removes its file and updates `MEMORY.md`.
5. **Limits.** A note holds at most 280 characters. Writing text that already exists in the same scope returns the existing note instead of adding a copy.
6. **No automatic capture.** Conversations are not recorded into memory. Notes are saved by the agent (`memory_write`) or by you, in the desktop app.

## Scopes

Bricks Desktop keeps two scope directories under the Bricks home folder (`~/.bricks/memory/`):

| Scope | Path |
|---|---|
| Global (shared across all projects) | `~/.bricks/memory/global/` |
| Project | `~/.bricks/memory/projects/<project_id>/` |

Outside Desktop (CLI / SDK), enabling `[memory]` in `bricks.toml` stores project notes in `<workspace>/.bricks/memory/` and shares `~/.bricks/memory/global/`.

## Agent tools

When memory is enabled for a run, the agent receives five dedicated tools:

- `memory_list` (read-only): lists saved notes (newest first) with their `id`s, with optional substring filtering and pagination (20 notes by default, 50 at most).
- `memory_search` (read-only): finds notes that contain any of the query's words (case and accents ignored), best matches first, up to 20 results.
- `memory_write` (write): saves a concise atomic note (max 280 characters) and returns its `id`.
- `memory_update` (write): updates an existing note in place by `id`.
- `memory_delete` (write): deletes an obsolete note by `id`.

Each tool takes a `scope` (`project`, the default, or `global`).

Sub-agents follow their profile's `memory` setting. By default (`[agents] subagent_memory_write = false`), a sub-agent only gets `memory_search` and `memory_list`. Set `subagent_memory_write = true` to let sub-agents write by default, or set `memory: read_write` in a profile. A profile with `memory: off` gets no memory tools.

## Settings

Memory can be configured in the `[memory]` section of `bricks.toml`:

```toml
[memory]
enabled = false
max_index_notes = 200
max_index_tokens = 1500
```

* `enabled` turns the CLI's memory on or off. The desktop app has its own switch, so `enabled` does not affect it.
* `max_index_notes` and `max_index_tokens` limit the index injected into the prompt. The desktop app reads these two limits from `bricks.toml` too.

In Bricks Desktop, turn memory on or off in **Settings > Memory**. Its **View** buttons open the memory view, where you can search notes, edit them in place, and delete them, for either scope. Clearing a scope deletes its notes.
