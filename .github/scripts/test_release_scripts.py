#!/usr/bin/env python3
"""Unit tests for release workflow helper scripts."""

from __future__ import annotations

import io
import json
import pathlib
import sys
import tarfile
import tempfile
import unittest
import zipfile

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO_ROOT / "apps" / "bricks-desktop" / "scripts"))

import build_updater_manifest
import prepare_cua_driver
import render_release_notes
import virustotal_scan


class VirusTotalPolicyTests(unittest.TestCase):
    def _report(self, malicious: int, bitdefender: str = "undetected", kaspersky: str = "undetected") -> dict:
        return {
            "data": {
                "attributes": {
                    "last_analysis_stats": {
                        "malicious": malicious,
                        "suspicious": 0,
                        "undetected": 70 - malicious,
                        "harmless": 0,
                    },
                    "last_analysis_results": {
                        "Bitdefender": {"category": bitdefender},
                        "Kaspersky": {"category": kaspersky},
                    },
                }
            }
        }

    def test_allows_under_five_when_priority_engines_clean(self) -> None:
        verdict = virustotal_scan.evaluate_file_report(self._report(4))
        self.assertTrue(verdict["passed"])
        self.assertEqual(verdict["malicious"], 4)
        self.assertEqual(verdict["total"], 70)

    def test_blocks_at_five_or_more(self) -> None:
        verdict = virustotal_scan.evaluate_file_report(self._report(5))
        self.assertFalse(verdict["passed"])
        self.assertIn("malicious=5 >= 5", verdict["reasons"])

    def test_blocks_if_bitdefender_or_kaspersky_flags(self) -> None:
        bd = virustotal_scan.evaluate_file_report(self._report(1, bitdefender="malicious"))
        self.assertFalse(bd["passed"])
        kp = virustotal_scan.evaluate_file_report(self._report(1, kaspersky="suspicious"))
        self.assertFalse(kp["passed"])

    def test_blocks_empty_analysis_stats(self) -> None:
        empty = {"data": {"attributes": {"last_analysis_stats": {}, "last_analysis_results": {}}}}
        verdict = virustotal_scan.evaluate_file_report(empty)
        self.assertFalse(verdict["passed"])
        self.assertIn("empty VirusTotal analysis stats", verdict["reasons"])


class ReleaseNotesTests(unittest.TestCase):
    def test_nightly_notes_match_user_constraints(self) -> None:
        body = render_release_notes.render_notes(
            release_kind="nightly",
            title="Bricks Nightly 2026.11.14-0200",
            tag="nightly-2026.11.14-0200",
            date_utc="2026-11-14 02:00 UTC",
            version="2026.11.14",
            commit_sha="04699ce1234567890abcdef1234567890abcdef1",
            tests_status="passed",
            vt_summary="  - `Bricks_2026.11.14_macos-arm64.dmg`: `0/70` ([Report](https://www.virustotal.com/gui/file/abc))\n",
        )
        self.assertNotIn("\u2014", body)
        self.assertIn("I do not pay", body)
        self.assertNotIn("we do not pay", body.lower())
        self.assertNotIn("opt-level", body)
        self.assertNotIn("Verify Your Download", body)
        self.assertNotIn("Changes Since", body)
        self.assertIn("### Automatic release methodology & checks", body)
        self.assertIn("### Download Guide", body)
        self.assertIn("Easy full uninstall:", body)

    def test_odr_skip_tests_note(self) -> None:
        body = render_release_notes.render_notes(
            release_kind="on-demand",
            title="Bricks On-Demand 2026.11.14-1735",
            tag="odr-2026.11.14-1735",
            date_utc="2026-11-14 17:35 UTC",
            version="2026.11.14",
            commit_sha="04699ce1234567890abcdef1234567890abcdef1",
            tests_status="skipped",
            vt_summary="  - `a.zip`: `0/70` ([Report](https://www.virustotal.com/gui/file/def))\n",
            repo="owner/my-repo",
        )
        self.assertIn("skip_tests=true", body)
        self.assertIn("git clone https://github.com/owner/my-repo.git", body)
        self.assertIn("cd my-repo", body)


class UpdaterManifestTests(unittest.TestCase):
    def test_builds_manifest_for_release_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            assets = pathlib.Path(tmp)
            names = [
                "Bricks_2026.11.14_macos-arm64.app.tar.gz",
                "Bricks_2026.11.14_windows-x64-setup.exe",
            ]
            for idx, name in enumerate(names):
                (assets / name).write_bytes(b"binary")
                (assets / f"{name}.sig").write_text(f"sig-{idx}\n", encoding="utf-8")

            manifest = build_updater_manifest.build_manifest(
                assets_dir=assets,
                version="v2026.11.14",
                tag="v2026.11.14",
                repo="AshlarAI/Bricks",
                pub_date="2026-11-14T20:00:00Z",
                notes="First CalVer release",
            )
            self.assertEqual(manifest["version"], "2026.11.14")
            self.assertEqual(manifest["pub_date"], "2026-11-14T20:00:00Z")
            self.assertEqual(manifest["notes"], "First CalVer release")
            platforms = manifest["platforms"]
            self.assertEqual(
                platforms["darwin-aarch64"],
                {
                    "signature": "sig-0",
                    "url": "https://github.com/AshlarAI/Bricks/releases/download/v2026.11.14/Bricks_2026.11.14_macos-arm64.app.tar.gz",
                },
            )
            self.assertEqual(platforms["windows-x86_64-nsis"]["signature"], "sig-1")
            self.assertEqual(platforms["windows-x86_64"]["signature"], "sig-1")
            self.assertNotIn("windows-x86_64-msi", platforms)

    def test_missing_signature_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            assets = pathlib.Path(tmp)
            (assets / "Bricks_2026.11.14_macos-arm64.app.tar.gz").write_bytes(b"binary")
            with self.assertRaises(FileNotFoundError):
                build_updater_manifest.build_manifest(
                    assets_dir=assets,
                    version="2026.11.14",
                    tag="v2026.11.14",
                    repo="AshlarAI/Bricks",
                    pub_date="2026-11-14T20:00:00Z",
                )


class PrepareCuaDriverTests(unittest.TestCase):
    def _make_mac_tar(self, path: pathlib.Path, *, include_traversal: bool = False) -> None:
        with tarfile.open(path, "w:gz") as tar:
            if include_traversal:
                bad = tarfile.TarInfo("CuaDriver.app/../../evil")
                bad.size = 3
                tar.addfile(bad, io.BytesIO(b"bad"))
            for rel, mode, data in (
                ("cua-driver-rs-0.62.1-darwin-arm64/CuaDriver.app/Contents/Info.plist", 0o644, b"<plist/>"),
                ("cua-driver-rs-0.62.1-darwin-arm64/CuaDriver.app/Contents/MacOS/cua-driver", 0o755, b"bin"),
            ):
                info = tarfile.TarInfo(rel)
                info.size = len(data)
                info.mode = mode
                tar.addfile(info, io.BytesIO(data))

    def _make_win_zip(self, path: pathlib.Path, *, missing_uia: bool = False) -> None:
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("cua-driver.exe", b"driver")
            zf.writestr("cua-cursor-theme.exe", b"theme")
            if not missing_uia:
                zf.writestr("cua-driver-uia.exe", b"uia")
            zf.writestr("cua_driver_sdk.dll", b"ignored")

    def test_extracts_macos_bundle_and_writes_tauri_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            tgz = root / "mac.tar.gz"
            self._make_mac_tar(tgz)
            out_dir = root / "out"
            bundle = prepare_cua_driver.extract_macos_bundle(tgz, out_dir)
            self.assertTrue((bundle / "Contents" / "MacOS" / "cua-driver").is_file())
            self.assertTrue((bundle / "Contents" / "Info.plist").is_file())

            cfg = prepare_cua_driver.build_tauri_config(
                platform_name="macos-arm64",
                out_dir=out_dir,
                app_version="2026.11.26",
                create_updater_artifacts=True,
            )
            self.assertEqual(cfg["version"], "2026.11.26")
            self.assertTrue(cfg["bundle"]["createUpdaterArtifacts"])
            self.assertEqual(
                cfg["bundle"]["resources"],
                {str((out_dir / "CuaDriver.app").resolve()): "CuaDriver.app"},
            )

    def test_rejects_path_traversal_in_macos_archive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            tgz = root / "evil.tar.gz"
            self._make_mac_tar(tgz, include_traversal=True)
            with self.assertRaises(ValueError):
                prepare_cua_driver.extract_macos_bundle(tgz, root / "out")

    def test_extracts_windows_binaries_and_checks_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            good_zip = root / "win.zip"
            self._make_win_zip(good_zip)
            out_dir = root / "win-out"
            extracted = prepare_cua_driver.extract_windows_binaries(good_zip, out_dir)
            self.assertEqual([p.name for p in extracted], list(prepare_cua_driver.WINDOWS_BINARIES))
            self.assertFalse((out_dir / "cua_driver_sdk.dll").exists())

            cfg = prepare_cua_driver.build_tauri_config(
                platform_name="windows-x64",
                out_dir=out_dir,
                app_version="2026.11.26",
                create_updater_artifacts=False,
            )
            self.assertFalse(cfg["bundle"]["createUpdaterArtifacts"])
            self.assertEqual(
                cfg["bundle"]["resources"],
                {str((out_dir / name).resolve()): name for name in prepare_cua_driver.WINDOWS_BINARIES},
            )

            bad_zip = root / "bad-win.zip"
            self._make_win_zip(bad_zip, missing_uia=True)
            with self.assertRaises(FileNotFoundError):
                prepare_cua_driver.extract_windows_binaries(bad_zip, root / "win-bad")

    def test_prepare_driver_verifies_sha256_and_uses_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            src_zip = root / "src.zip"
            self._make_win_zip(src_zip)
            good_sha = prepare_cua_driver.sha256_file(src_zip)
            original = prepare_cua_driver.ASSETS["windows-x64"]
            prepare_cua_driver.ASSETS["windows-x64"] = prepare_cua_driver.DriverAsset(
                platform="windows-x64",
                filename="test.zip",
                sha256=good_sha,
                archive_type="zip",
            )
            try:
                calls = 0

                def fake_download(_url: str, dest: pathlib.Path) -> None:
                    nonlocal calls
                    calls += 1
                    dest.write_bytes(src_zip.read_bytes())

                out_dir = root / "cached"
                prepare_cua_driver.prepare_driver(
                    platform_name="windows-x64",
                    out_dir=out_dir,
                    download_fn=fake_download,
                    verify_signature=False,
                )
                self.assertEqual(calls, 1)
                prepare_cua_driver.prepare_driver(
                    platform_name="windows-x64",
                    out_dir=out_dir,
                    download_fn=fake_download,
                    verify_signature=False,
                )
                self.assertEqual(calls, 1)

                prepare_cua_driver.ASSETS["windows-x64"] = prepare_cua_driver.DriverAsset(
                    platform="windows-x64",
                    filename="test.zip",
                    sha256="0" * 64,
                    archive_type="zip",
                )
                with self.assertRaises(ValueError):
                    prepare_cua_driver.prepare_driver(
                        platform_name="windows-x64",
                        out_dir=root / "bad-cache",
                        download_fn=fake_download,
                        verify_signature=False,
                    )
            finally:
                prepare_cua_driver.ASSETS["windows-x64"] = original


if __name__ == "__main__":
    unittest.main()
