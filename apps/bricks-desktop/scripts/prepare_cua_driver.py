#!/usr/bin/env python3
"""Download, verify, and stage Cua Driver binaries for Tauri bundling."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass

CUA_DRIVER_VERSION = "0.62.1"
CUA_DRIVER_TAG = f"cua-driver-rs-v{CUA_DRIVER_VERSION}"
RELEASE_BASE_URL = f"https://github.com/trycua/cua/releases/download/{CUA_DRIVER_TAG}"
WINDOWS_BINARIES = (
    "cua-driver.exe",
    "cua-cursor-theme.exe",
    "cua-driver-uia.exe",
)


@dataclass(frozen=True)
class DriverAsset:
    platform: str
    filename: str
    sha256: str
    archive_type: str


ASSETS: dict[str, DriverAsset] = {
    "macos-arm64": DriverAsset(
        platform="macos-arm64",
        filename=f"cua-driver-rs-{CUA_DRIVER_VERSION}-darwin-arm64.tar.gz",
        sha256="68623a1e12519f3e2acd58e30722167dd65320c450abe2b299e840b9b08de8e5",
        archive_type="tar.gz",
    ),
    "windows-x64": DriverAsset(
        platform="windows-x64",
        filename=f"cua-driver-rs-{CUA_DRIVER_VERSION}-windows-x86_64-binary.zip",
        sha256="6fce4254c42dfbf1cbd2d03340da259c5e3cd0d31254907322629c2d89675d9d",
        archive_type="zip",
    ),
}


def detect_platform() -> str:
    sys_name = sys.platform
    machine = platform.machine().lower()
    if sys_name == "darwin" and machine in ("arm64", "aarch64"):
        return "macos-arm64"
    if sys_name == "win32" and machine in ("amd64", "x86_64"):
        return "windows-x64"
    raise RuntimeError(f"Unsupported host platform for Cua Driver bundling: {sys_name}/{machine}")


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_sha256(path: pathlib.Path, expected_sha256: str) -> None:
    actual = sha256_file(path)
    if actual.lower() != expected_sha256.lower():
        raise ValueError(
            f"SHA-256 mismatch for {path.name}: expected {expected_sha256}, got {actual}"
        )


def _download_file(url: str, dest: pathlib.Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "bricks-desktop-build"})
    with urllib.request.urlopen(req, timeout=120) as resp, dest.open("wb") as out:
        shutil.copyfileobj(resp, out)


def _validate_rel_parts(parts: tuple[str, ...], raw_name: str) -> pathlib.Path:
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"Unsafe archive member path: {raw_name}")
    return pathlib.Path(*parts)


def extract_macos_bundle(archive_path: pathlib.Path, out_dir: pathlib.Path) -> pathlib.Path:
    bundle_dir = out_dir / "CuaDriver.app"
    staging_dir = out_dir / ".staging-CuaDriver.app"
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)

    found = False
    with tarfile.open(archive_path, "r:gz") as tar:
        for member in tar.getmembers():
            raw = member.name.lstrip("./")
            parts = [p for p in raw.split("/") if p]
            if "CuaDriver.app" not in parts:
                continue
            idx = parts.index("CuaDriver.app")
            rel_parts = tuple(parts[idx + 1 :])
            if not rel_parts:
                found = True
                continue
            if member.issym() or member.islnk():
                raise ValueError(f"Unexpected link in CuaDriver.app archive: {member.name}")
            rel_path = _validate_rel_parts(rel_parts, member.name)
            dest = staging_dir / rel_path
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
                found = True
            elif member.isfile():
                dest.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(member)
                if src is None:
                    raise ValueError(f"Could not read archive member: {member.name}")
                with src, dest.open("wb") as out:
                    shutil.copyfileobj(src, out)
                os.chmod(dest, member.mode & 0o777)
                found = True

    exe = staging_dir / "Contents" / "MacOS" / "cua-driver"
    if not found or not exe.is_file():
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise FileNotFoundError(f"CuaDriver.app executable missing after extracting {archive_path}")

    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    staging_dir.rename(bundle_dir)
    return bundle_dir


def extract_windows_binaries(archive_path: pathlib.Path, out_dir: pathlib.Path) -> list[pathlib.Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(WINDOWS_BINARIES)
    extracted: dict[str, pathlib.Path] = {}

    with zipfile.ZipFile(archive_path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            normalized = info.filename.replace("\\", "/")
            name = pathlib.PurePosixPath(normalized).name
            if name not in wanted:
                continue
            parts = tuple(p for p in normalized.split("/") if p)
            _validate_rel_parts(parts, info.filename)
            dest = out_dir / name
            with zf.open(info, "r") as src, dest.open("wb") as out:
                shutil.copyfileobj(src, out)
            extracted[name] = dest

    missing = [name for name in WINDOWS_BINARIES if name not in extracted]
    if missing:
        raise FileNotFoundError(
            f"Missing expected Windows Cua Driver binaries in {archive_path.name}: {', '.join(missing)}"
        )
    return [extracted[name] for name in WINDOWS_BINARIES]


def verify_macos_codesign(bundle_dir: pathlib.Path) -> None:
    if sys.platform != "darwin":
        return
    subprocess.run(
        ["codesign", "--verify", "--strict", str(bundle_dir)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _is_cached(asset: DriverAsset, out_dir: pathlib.Path) -> bool:
    stamp_path = out_dir / ".cua-driver-stamp.json"
    if not stamp_path.is_file():
        return False
    try:
        stamp = json.loads(stamp_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if (
        stamp.get("version") != CUA_DRIVER_VERSION
        or stamp.get("platform") != asset.platform
        or stamp.get("sha256") != asset.sha256
    ):
        return False

    if asset.platform == "macos-arm64":
        bundle_dir = out_dir / "CuaDriver.app"
        exe = bundle_dir / "Contents" / "MacOS" / "cua-driver"
        if not exe.is_file():
            return False
        try:
            verify_macos_codesign(bundle_dir)
        except subprocess.CalledProcessError:
            return False
        return True

    return all((out_dir / name).is_file() for name in WINDOWS_BINARIES)


def build_tauri_config(
    *,
    platform_name: str,
    out_dir: pathlib.Path,
    app_version: str | None = None,
    create_updater_artifacts: bool | None = None,
) -> dict:
    resolved_out = out_dir.resolve()
    if platform_name == "macos-arm64":
        resources = {str(resolved_out / "CuaDriver.app"): "CuaDriver.app"}
    elif platform_name == "windows-x64":
        resources = {str(resolved_out / name): name for name in WINDOWS_BINARIES}
    else:
        raise ValueError(f"Unsupported platform: {platform_name}")

    bundle: dict[str, object] = {"resources": resources}
    if create_updater_artifacts is not None:
        bundle["createUpdaterArtifacts"] = create_updater_artifacts

    config: dict[str, object] = {"bundle": bundle}
    if app_version:
        config["version"] = app_version
    return config


def prepare_driver(
    *,
    platform_name: str,
    out_dir: pathlib.Path,
    download_fn=_download_file,
    verify_signature: bool = True,
) -> pathlib.Path:
    if platform_name not in ASSETS:
        raise ValueError(f"Unsupported platform: {platform_name}")
    asset = ASSETS[platform_name]
    out_dir.mkdir(parents=True, exist_ok=True)

    if _is_cached(asset, out_dir):
        return out_dir

    url = f"{RELEASE_BASE_URL}/{asset.filename}"
    with tempfile.TemporaryDirectory() as tmp:
        archive_path = pathlib.Path(tmp) / asset.filename
        download_fn(url, archive_path)
        verify_sha256(archive_path, asset.sha256)
        if asset.platform == "macos-arm64":
            bundle_dir = extract_macos_bundle(archive_path, out_dir)
            if verify_signature:
                verify_macos_codesign(bundle_dir)
        else:
            extract_windows_binaries(archive_path, out_dir)

    stamp_path = out_dir / ".cua-driver-stamp.json"
    stamp_path.write_text(
        json.dumps(
            {
                "version": CUA_DRIVER_VERSION,
                "tag": CUA_DRIVER_TAG,
                "platform": asset.platform,
                "sha256": asset.sha256,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return out_dir


def _parse_bool(raw: str | None) -> bool | None:
    if raw is None:
        return None
    lowered = raw.strip().lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    raise argparse.ArgumentTypeError(f"Expected true or false, got: {raw}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--platform",
        choices=tuple(ASSETS.keys()),
        default=None,
        help="Target platform (defaults to current host).",
    )
    parser.add_argument(
        "--out-dir",
        type=pathlib.Path,
        default=None,
        help="Directory where Cua Driver binaries are staged.",
    )
    parser.add_argument(
        "--tauri-config-out",
        type=pathlib.Path,
        default=None,
        help="Optional path to write a Tauri --config JSON overlay.",
    )
    parser.add_argument(
        "--app-version",
        default=None,
        help="Optional Bricks Desktop version override for the Tauri config.",
    )
    parser.add_argument(
        "--create-updater-artifacts",
        type=_parse_bool,
        default=None,
        help="Optional boolean override for bundle.createUpdaterArtifacts.",
    )
    args = parser.parse_args(argv)

    platform_name = args.platform or detect_platform()
    default_out = pathlib.Path(__file__).resolve().parent.parent / ".cua-driver" / platform_name
    out_dir = args.out_dir or default_out

    prepare_driver(platform_name=platform_name, out_dir=out_dir)

    if args.tauri_config_out:
        config = build_tauri_config(
            platform_name=platform_name,
            out_dir=out_dir,
            app_version=args.app_version,
            create_updater_artifacts=args.create_updater_artifacts,
        )
        args.tauri_config_out.parent.mkdir(parents=True, exist_ok=True)
        args.tauri_config_out.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
