# Bricks Project Instructions

## Language

- Default to English for all code, comments, commit messages, documentation, and changelog entries unless the user explicitly asks for another language.

## Engineering and Verification

- Run Rust tests with `cargo nextest` (for example `cargo nextest run --workspace`), not bare `cargo test`, unless running doc tests separately.
- Keep changes tightly scoped to the request. Remove dead modules and unused code when refactoring rather than leaving legacy code behind.
- For substantial code or workflow changes, run a verification pass with a subagent before concluding.
- Never run `git commit` or `git push` without explicit user approval.

## Frontend UI (`apps/bricks-desktop`)

- Agents must use the `shadcn-svelte` skill and the `svelte-autofixer` MCP tool when working on Svelte or desktop UI code.
- Use official `shadcn-svelte` components and `@lucide/svelte` icons strictly across the desktop UI, including buttons and animations. Do not introduce custom UI primitives when a `shadcn-svelte` component exists.
- Validate Svelte changes with `svelte-autofixer` and run `npm run check && npm run test:types` in `apps/bricks-desktop`.

## Documentation and Release Notes Style

- Write documentation and release notes in plain, direct, concise, accurate, human English.
- Organize documentation into clear sections and keep technical jargon minimal.
- Never use em dashes in documentation, changelog entries, or release notes.
- Write release notes in the first-person singular (`I` instead of `we`) and keep the `Automatic release methodology & checks` section brief.

## Git Commits

- Format commit titles using the Bricks bracket convention: `[Type : scope] <infinitive verb> <what was done>` (omit `: scope` only when the change is repository-wide, for example `[Docs] update README`).
- For breaking changes, prepend `!` at the start inside the brackets: `[!Type : scope] <infinitive verb> <what was done>`.
- Do not use parenthesized lowercase headers like `perf(UI): ...`.
- Allowed commit types:
  - `Feat`: add a new user-facing feature (example: `[Feat : ui] add dark mode`)
  - `Fix`: fix a bug (example: `[Fix : api] handle request timeout`)
  - `Docs`: update documentation only (example: `[Docs] update README`)
  - `Refactor`: restructure code without changing behavior (example: `[Refactor : auth] simplify token validation`)
  - `Style`: formatting, whitespace, or indentation only (example: `[Style : css] remove unused margins`)
  - `Test`: add or fix tests (example: `[Test : login] add unit coverage`)
  - `Chore`: maintenance or configuration outside shipped code (example: `[Chore] update .gitignore`)
  - `Ci`: continuous integration workflows and scripts (example: `[Ci] cache cargo build artifacts`)
  - `Build`: build tooling or dependencies (example: `[Build : deps] upgrade tauri to 2.x`)
  - `Perf`: improve performance (example: `[Perf : cache] reduce lookup latency`)
- Write the commit body as short, direct, effective paragraphs rather than bloated lists.

## Changelog (`CHANGELOG.md`)

- Update `CHANGELOG.md` on every commit.
- Each entry must include the commit number, date (`YYYY/MM/DD`), and a very concise summary of what the commit adds or changes.

## Versioning, CI Releases, and Auto-Updater

- Use CalVer `YYYY.M.D` (4-digit year, no leading zeroes so Cargo, npm, and Tauri SemVer checks pass, e.g. `2026.11.15`) for official release package versions and `YYYY.MM.DD-HHMM` for Nightly and On-Demand Release (ODR) tags.
- Target desktop builds for Windows and macOS ARM64 only (`.dmg`, `.setup.exe`, and `.zip`).
- Keep the in-app auto-updater (`tauri-plugin-updater`) pointed strictly at official GitHub Releases, never Nightly or ODR pre-releases.
- Preserve the open-source unsigned-binary transparency notice in release descriptions. Never commit secrets such as API keys into the repository or rule files.

## Bricks Internal Memory

- Keep saved Bricks memory notes very concise and removable from `Settings / Memory / View`.
