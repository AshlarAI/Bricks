#!/usr/bin/env python3
"""Generate Tauri v2 updater latest.json from signed release assets."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys


def _read_sig(assets_dir: pathlib.Path, filename: str) -> str:
    artifact = assets_dir / filename
    sig_file = assets_dir / f"{filename}.sig"
    if not artifact.is_file():
        raise FileNotFoundError(f"Missing updater artifact: {artifact}")
    if not sig_file.is_file():
        raise FileNotFoundError(f"Missing updater signature: {sig_file}")
    sig = sig_file.read_text(encoding="utf-8").strip()
    if not sig:
        raise ValueError(f"Empty updater signature: {sig_file}")
    return sig


def build_manifest(
    *,
    assets_dir: pathlib.Path,
    version: str,
    tag: str,
    repo: str,
    pub_date: str,
    notes: str = "",
) -> dict:
    clean_version = version.lstrip("v")
    base_url = f"https://github.com/{repo}/releases/download/{tag}"

    mac_name = f"Bricks_{clean_version}_macos-arm64.app.tar.gz"
    win_nsis_name = f"Bricks_{clean_version}_windows-x64-setup.exe"

    mac_sig = _read_sig(assets_dir, mac_name)
    win_nsis_sig = _read_sig(assets_dir, win_nsis_name)

    win_nsis_entry = {
        "signature": win_nsis_sig,
        "url": f"{base_url}/{win_nsis_name}",
    }

    return {
        "version": clean_version,
        "notes": notes.strip() or f"Bricks {tag}",
        "pub_date": pub_date,
        "platforms": {
            "darwin-aarch64": {
                "signature": mac_sig,
                "url": f"{base_url}/{mac_name}",
            },
            "windows-x86_64-nsis": win_nsis_entry,
            "windows-x86_64": dict(win_nsis_entry),
        },
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-dir", required=True, type=pathlib.Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repo", default="AshlarAI/Bricks")
    parser.add_argument(
        "--pub-date",
        default=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    parser.add_argument("--notes", default="")
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args(argv)

    manifest = build_manifest(
        assets_dir=args.assets_dir,
        version=args.version,
        tag=args.tag,
        repo=args.repo,
        pub_date=args.pub_date,
        notes=args.notes,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
