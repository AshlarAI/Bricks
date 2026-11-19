# Sub-agents and profiles

A Bricks agent can delegate a self-contained task to a **sub-agent** using the `Agent` tool. Sub-agents run in the background and in parallel. `Agent` returns their ids immediately, and each completion report reaches the parent between turns.

| Tool | What it does |
|---|---|
| `Agent` | Starts one sub-agent (`prompt`) or several (`missions`, up to 16). |
| `Managent` | Lists and inspects sub-agents, waits (`any` or `all`), reads results, resumes or cancels sub-agents, and manages ChangeSets. |
| `Messagent` | Internal mail between the agents of one session. |
| `Job` | Reads and stops background shell commands (`Bash` with `background: true`). |

Available profiles (built-in and custom) are loaded dynamically and embedded directly into the `Agent` tool description.

## Built-in profiles

Bricks ships two built-in profiles in `crates/bricks-agent/agents/`:

| Profile | Purpose | Tools & isolation |
|---|---|---|
| `general` | Default general-purpose sub-agent for coding, debugging, research, and multi-step execution. | `tools: inherit`, `permissions: inherit`, `isolation: shared`. |
| `explore` | Read-only exploration and planning sub-agent for inspecting codebases, running read-only commands, and mapping changes. | `Bash` and read/search tools allowed; `Write`, `Edit`, `ApplyPatch`, `Agent`, `Managent`, `Messagent`, `memory_write`, `memory_update`, and `memory_delete` denied. `isolation: shared`, `memory: read_only`. |

## Using `Agent`

Single mission:

```json
{
  "profile": "explore",
  "description": "Map payment call sites",
  "prompt": "Find where the payment total is computed and list the call sites with file paths and line numbers."
}
```

Parameters:

* `prompt` (required for a single mission; `task` is accepted as an alias): the full mission for the sub-agent.
* `profile` (optional, default `"general"`): profile name to run with.
* `description` (optional): short 3 to 5 word label shown in the UI and in `Managent` `list` and `status` output. It is not injected into the sub-agent's prompt.
* `model` (optional): inherits the parent's model by default. Do not override unless the user explicitly asks for a specific `provider_id/model_id`.
* `effort` (optional): inherits the parent's reasoning effort by default (`low`, `medium`, `high`, `inherit`, or a model-specific reasoning id). Do not override unless requested.
* `fork` (optional, default `false`): when `true`, copies the parent's active conversation history into the sub-agent, truncated before the current assistant turn so there is no unanswered tool call. When `false`, the sub-agent starts with a fresh context.
* `isolation` (optional): `"shared"` or `"worktree"`. When omitted, uses the profile's `isolation` (`"shared"` for built-ins).
* `missions` (optional): array of 1 to 16 mission objects (using the same fields above), used instead of a top-level `prompt` to launch several sub-agents in one call.

`system_prompt` is not accepted; choose a `profile` instead. Every mission is validated before anything starts. One invalid mission rejects the call and starts nothing.

A sub-agent gets the system prompt for its allowed tools, its profile instructions, its own environment and git state, and its `prompt` (plus parent history before the current turn when `fork: true`). Its shell state is its own; code search and MCP connections are shared.

## Managing sub-agents with `Managent`

Use `Managent` to monitor, wait for, resume, cancel, and integrate sub-agents:

| Action | Parameters | What it does |
|---|---|---|
| `list` | none | Lists visible sub-agents with `agent_id`, `description`, `profile`, `state`, elapsed duration (`elapsed_ms`), `last_action`, ChangeSet id and state (if any), and slot counts. |
| `status` | `agent_id` | Shows the same enriched status for one sub-agent. |
| `result` | `agent_id` | Returns the sub-agent's final summary, changed files, commands run, and warnings. |
| `wait` | `mode`, `agent_id` or `agent_ids`, `timeout_ms` | Waits for sub-agents up to `timeout_ms` (default `60000`, max `600000`; timeout stops nothing). `mode: "any"` (default) returns on the first delivery or finished target; `mode: "all"` waits until all targeted (or active visible) sub-agents finish. Returns both `finished` and `pending` entries. |
| `resume` | `agent_id`, `prompt` | Resumes an ended sub-agent in its own conversation with a new prompt. |
| `cancel` | `agent_id` | Requests cancellation of `agent_id` and its descendants. |
| `inspect_changes` | `changeset_id` or `agent_id` | Shows changed files and patch diff for an isolated worktree ChangeSet. |
| `check_changes` | `changeset_id` or `agent_id` | Checks whether the ChangeSet applies cleanly to the working tree without writing files. |
| `rebase_changes` | `changeset_id` or `agent_id`, optional `verify_cmd` | Rebases the ChangeSet onto current `HEAD` in a temporary worktree and optionally runs `verify_cmd`. Returns a new `ready` ChangeSet (with `rebased_from`), a `conflict` with conflicting file paths, or a `verify_failed` result with exit code and output. |
| `apply_changes` | `changeset_id` or `agent_id` | Applies the ChangeSet to the working tree without committing. On conflict, nothing is written. |
| `discard_changes` | `changeset_id` or `agent_id` | Discards the ChangeSet and removes its worktree while keeping its patch record. |

An `agent_result` header reports status (`completed`, `incomplete`, `failed`, or `cancelled`), duration, turns, tool calls, summary (capped at `[agents] summary_chars`), files changed, and commands actually run.

## Custom profiles

### Discovery and dynamic loading

Bricks checks three scopes in decreasing priority order:

```text
<workspace>/.bricks/agents/*.md   (project, wins on duplicate name)
  > ~/.bricks/agents/*.md         (user)
  > built-in profiles             (general, explore)
```

The workspace is the session's working directory; parent directories are not searched. Profiles are loaded dynamically from disk on every delegation, listing, and `Agent` tool description build. Adding, editing, or deleting a `.md` profile takes effect immediately without restarting. Sub-agents that are already running keep the profile they started with.

A higher scope shadows a lower scope by name even if the higher-scope file is invalid: a broken project profile surfaces an error and is never silently replaced by a user or built-in profile. Defining the same name twice in one scope makes that name unavailable until the duplicate is resolved. At most 256 files per folder, 64 KiB per file, and 8 KiB of frontmatter are read.

In Bricks Desktop and the CLI, `/agents` lists available profiles and diagnostics, and `/agents reload` refreshes the catalog view.

### File format and strict YAML validation

A custom profile is a Markdown file whose YAML frontmatter opens with `---` on the first line and closes on a line that is exactly `---`:

```markdown
---
name: reviewer
description: Reviews changes for bugs, regressions, and missing tests.
model: inherit
effort: high
permissions: read_only
tools:
  deny:
    - Write
    - Edit
isolation: shared
memory: read_only
skills: []
---

# Reviewer

Instructions go here (the Markdown body is kept verbatim).
```

Frontmatter uses strict YAML validation:

* Unknown or misspelled fields are rejected with an explicit error naming the file and field.
* `max_turns`, `maxTurns`, and `max-turns` are explicitly rejected (sub-agents have no turn cap).
* Duplicate YAML keys, unsupported YAML tags, and environment variable interpolation are rejected.

Allowed frontmatter fields:

* `name` (required): 1 to 64 characters among `a-z`, `0-9`, `_`, `-`, starting with a letter or digit.
* `description` (required): non-empty summary, at most 1024 characters.
* `tools` (optional, default `inherit`): `inherit`, `{ allow: [...] }`, or `{ deny: [...] }` (up to 256 tool names).
* `permissions` (optional, default `inherit`): `inherit`, `read_only`, `ask`, or `execute`.
* `model` (optional, default `inherit`): `inherit` or `provider_id/model_id`.
* `effort` (optional, default `inherit`): `inherit`, `low`, `medium`, `high`, or a reasoning id (1 to 64 characters among letters, digits, `_`, `-`, `.`).
* `isolation` (optional, default `shared`): `shared` or `worktree`.
* `memory` (optional): `off`, `read_only`, or `read_write`. See `docs/memory.md`.
* `skills` (optional): list of up to 32 skill names loaded into the sub-agent's system prompt.

Example custom profiles live in [`docs/agents/examples/`](agents/examples/).

## Isolation and permissions

* `shared`: runs in the parent's working directory. Writing tool calls (`Edit`, `Write`, `ApplyPatch`) coordinate with a file/writer lease so parallel writers do not corrupt files.
* `worktree`: runs in a dedicated git worktree created from the parent's current tracked and untracked state. Changes return as a **ChangeSet** managed via `Managent`.
* `Agent` is an `execute` tool and never prompts. Under `EXECUTE` it runs; under `CUSTOM` it needs `Agent` allowed; under `ASK` it is refused.
* Every tool call inside a sub-agent obeys the effective permission policy (profile `permissions` plus parent deny rules).
* When `child_depth >= max_depth` or when a profile denies delegation tools (such as `explore`), `Agent`, `Managent`, and `Messagent` are omitted from the child's available tools.
* `Managent` is `read_only` for `list`, `status`, `result`, `wait`, `inspect_changes`, and `check_changes`; `execute` for `resume` and `cancel`; and `write` for `apply_changes` and `discard_changes`.

## Limits

Configure `[agents]` in `bricks.toml` (see `docs/bricks.example.toml`):

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Turn sub-agents on or off. |
| `auto_model` | none | Optional fallback model name. |
| `max_context_chars` | `16000` | Character limit for explicit context payloads. |
| `summary_chars` | `30000` | Character limit for returned sub-agent summaries. |
| `max_concurrent` | `16` | Sub-agents active at once in a session. |
| `max_depth` | `1` | Delegation depth below the main agent (`1` means no grandchildren). |
| `max_queued` | `64` | Sub-agents allowed to wait for an execution slot. |
| `admission_timeout_ms` | `60000` | How long a queued sub-agent waits for a slot. |
| `background_drain_ms` | `600000` | Headless runs: drain window for running sub-agents after the main run ends. |
| `default_isolation` | `"auto"` | Default isolation setting (`"auto"`, `"shared"`, or `"worktree"`). |
| `skills_max_bytes` | `24000` | Total byte budget for profile skills loaded into a sub-agent. |
| `subagent_memory_write` | `false` | Whether sub-agents without an explicit `memory` setting may write memory. |

If the queue is full or admission times out, the affected sub-agent fails (`AgentQueueFull` or `AgentAdmissionTimeout`) while other missions continue.

## Messagent

`Messagent` provides internal mail within a session. The main agent is `main` and sub-agents have ids like `sub_0000`.

* `send`: message `main`, one or more agent ids, or `team` (at most 16 KiB per message).
* `read`: read unread messages (`all: true` reads the full thread).
* `members`: list team members and their states.

Messages are delivered between turns. A message wakes a waiting `Managent wait` call, never interrupts an active command, and does not restart an ended sub-agent.
