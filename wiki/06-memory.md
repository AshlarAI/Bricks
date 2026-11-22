# Memory

This page is a summary. The full reference is [Memory API](/docs/api-memory) on the documentation site. `docs/memory.md` in the repository covers the file layout and the desktop settings.

Bricks separates short-term session history from long-term notes:

- **Session history (`Memory` trait):** Saves and reloads conversation messages by `session_id` (for example with `JsonlMemory` in `bricks-memory`). Attach it with `Agent::builder().memory(...)` and `.session_id(...)`.
- **Long-term notes (`LongTermMemory` trait):** Short Markdown notes, one file per note, with a generated `MEMORY.md` index. `ScopedFileMemory` combines a project store and a global store. Its index of notes is added to the system prompt of each run, within a token budget.
- **Note limit:** Each note holds at most `NOTE_MAX_CHARS` (280 characters). Writing text that is already stored returns the existing note.
- **Agent tools:** `memory_list`, `memory_search`, `memory_write`, `memory_update`, and `memory_delete`. Each takes a `scope` (`project` by default, or `global`).
- **No automatic capture:** Conversations are not recorded into the note store. Notes come from the agent's `memory_write` calls or from the application.
- **Sub-agents:** Read-only by default. Set `memory: read_write` in a profile, or `subagent_memory_write = true` in `[agents]`.
