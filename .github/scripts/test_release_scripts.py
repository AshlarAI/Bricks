#!/usr/bin/env python3
"""Unit tests for release workflow helper scripts."""

from __future__ import annotations

import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import build_updater_manifest
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
            version="26.11.14",
            commit_sha="04699ce1234567890abcdef1234567890abcdef1",
            tests_status="passed",
            vt_summary="  - `Bricks_26.11.14_macos-arm64.dmg`: `0/70` ([Report](https://www.virustotal.com/gui/file/abc))\n",
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
            version="26.11.14",
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
                "Bricks_26.11.14_macos-arm64.app.tar.gz",
                "Bricks_26.11.14_windows-x64-setup.exe",
                "Bricks_26.11.14_windows-x64.msi",
            ]
            for idx, name in enumerate(names):
                (assets / name).write_bytes(b"binary")
                (assets / f"{name}.sig").write_text(f"sig-{idx}\n", encoding="utf-8")

            manifest = build_updater_manifest.build_manifest(
                assets_dir=assets,
                version="v26.11.14",
                tag="v26.11.14",
                repo="AshlarAI/Bricks",
                pub_date="2026-11-14T20:00:00Z",
                notes="First CalVer release",
            )
            self.assertEqual(manifest["version"], "26.11.14")
            self.assertEqual(manifest["pub_date"], "2026-11-14T20:00:00Z")
            self.assertEqual(manifest["notes"], "First CalVer release")
            platforms = manifest["platforms"]
            self.assertEqual(
                platforms["darwin-aarch64"],
                {
                    "signature": "sig-0",
                    "url": "https://github.com/AshlarAI/Bricks/releases/download/v26.11.14/Bricks_26.11.14_macos-arm64.app.tar.gz",
                },
            )
            self.assertEqual(platforms["windows-x86_64-nsis"]["signature"], "sig-1")
            self.assertEqual(platforms["windows-x86_64"]["signature"], "sig-1")
            self.assertEqual(platforms["windows-x86_64-msi"]["signature"], "sig-2")

    def test_missing_signature_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            assets = pathlib.Path(tmp)
            (assets / "Bricks_26.11.14_macos-arm64.app.tar.gz").write_bytes(b"binary")
            with self.assertRaises(FileNotFoundError):
                build_updater_manifest.build_manifest(
                    assets_dir=assets,
                    version="26.11.14",
                    tag="v26.11.14",
                    repo="AshlarAI/Bricks",
                    pub_date="2026-11-14T20:00:00Z",
                )


if __name__ == "__main__":
    unittest.main()
