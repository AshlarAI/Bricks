#!/usr/bin/env python3
"""Render GitHub Release notes matching Bricks release formatting rules."""

from __future__ import annotations

import argparse
import pathlib
import sys


def render_notes(
    *,
    release_kind: str,
    title: str,
    tag: str,
    date_utc: str,
    version: str,
    commit_sha: str,
    tests_status: str,
    vt_summary: str,
    repo: str = "AshlarAI/Bricks",
    extra_notes: str = "",
) -> str:
    short_sha = commit_sha[:7]
    repo_dir = repo.rsplit("/", 1)[-1]
    if release_kind == "nightly":
        intro = f"Automated pre-release built from `main` at commit `{short_sha}`."
    elif release_kind == "on-demand":
        intro = f"On-demand pre-release built from commit `{short_sha}`."
    else:
        intro = f"Official release built from commit `{short_sha}`."

    windows_note = "- `.exe` for Windows"
    tests_line = (
        "`cargo nextest`, doc tests, and Desktop unit tests skipped by request (`skip_tests=true`)."
        if tests_status == "skipped"
        else "`cargo fmt --check`, `cargo clippy -D warnings`, frontend checks, `cargo nextest`, doc tests, and Desktop unit tests passed."
    )
    if tests_status == "skipped":
        code_tests_bullet = (
            "- **Code & tests:** `cargo fmt --check`, `cargo clippy -D warnings`, and frontend type checks passed; "
            + tests_line
        )
    else:
        code_tests_bullet = f"- **Code & tests:** {tests_line}"

    extra_block = ""
    if extra_notes.strip():
        extra_block = f"\n---\n\n### Release Notes\n\n{extra_notes.strip()}\n"

    vt_block = vt_summary.strip()

    return f"""## {title}

{intro}

> **Important: Unsigned Open Source Builds**
>
> These installers and binaries are **not code-signed**. Bricks is an open-source project and I do not pay for commercial Apple or Microsoft signing certificates to distribute free builds. macOS Gatekeeper and Windows SmartScreen will show a warning on first launch.
>
> If you prefer not to run unsigned binaries, you can inspect the source code and compile Bricks yourself from this exact commit:
>
> ```bash
> git clone https://github.com/{repo}.git
> cd {repo_dir}
> git checkout {commit_sha}
>
> # Desktop app
> cd apps/bricks-desktop
> npm ci
> npm run tauri build
> ```

---

### Build Details

| Item | Value |
|---|---|
| Release tag | `{tag}` |
| Date (UTC) | `{date_utc}` |
| Version | `{version}` |
| Commit | `{commit_sha}` |
{extra_block}
---

### Download Guide

Only pick the format that matches your system:

{windows_note}
- `.dmg` for macOS

Bricks is also distributed as a `.zip` archive for both macOS and Windows, with the following benefits:

- **Instant use:** unzip the file and double-click to open and run it.
- **Full portability:** use it from a USB drive or copy it anywhere. Very easy to carry around.
- **No admin rights needed:** no installation on your machine, no elevation required.
- **Easy full uninstall:** uninstalling is very fast, just delete the folder.

---

### Automatic release methodology & checks

{code_tests_bullet}
- **Secrets:** `scripts/check_secrets.py` and `gitleaks` passed.
- **Antivirus:** ClamAV (`0` infected) and VirusTotal (`malicious < 5`, Bitdefender & Kaspersky clean):
{vt_block}
- **Integrity:** SHA-256 verified after build and after scan (`SHA256SUMS.txt` attached), with GitHub `attest-build-provenance`.
"""


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-kind", required=True, choices=("nightly", "on-demand", "release"))
    parser.add_argument("--title", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--date-utc", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--tests-status", required=True, choices=("passed", "skipped"))
    parser.add_argument("--vt-summary-file", required=True, type=pathlib.Path)
    parser.add_argument("--repo", default="AshlarAI/Bricks")
    parser.add_argument("--extra-notes", default="")
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args(argv)

    vt_summary = args.vt_summary_file.read_text(encoding="utf-8")
    rendered = render_notes(
        release_kind=args.release_kind,
        title=args.title,
        tag=args.tag,
        date_utc=args.date_utc,
        version=args.version,
        commit_sha=args.commit_sha,
        tests_status=args.tests_status,
        vt_summary=vt_summary,
        repo=args.repo,
        extra_notes=args.extra_notes,
    )
    if "\u2014" in rendered:
        print("Error: em dash found in rendered release notes", file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
