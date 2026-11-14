#!/usr/bin/env python3
"""Scan release artifacts with VirusTotal API v3 and enforce policy checks."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
import uuid

VT_API_BASE = "https://www.virustotal.com/api/v3"
DIRECT_UPLOAD_LIMIT = 32 * 1024 * 1024
MAX_ANALYSIS_WAIT_SECS = 20 * 60
DEFAULT_REQUEST_GAP_SECS = 16.0
PRIORITY_ENGINES = ("Bitdefender", "Kaspersky")


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class RateLimiter:
    """Space API calls to respect VirusTotal free-tier limits."""

    def __init__(self, min_interval_secs: float = DEFAULT_REQUEST_GAP_SECS) -> None:
        self.min_interval_secs = min_interval_secs
        self._last_call = 0.0

    def wait(self) -> None:
        if self.min_interval_secs <= 0:
            return
        elapsed = time.monotonic() - self._last_call
        if self._last_call > 0 and elapsed < self.min_interval_secs:
            time.sleep(self.min_interval_secs - elapsed)
        self._last_call = time.monotonic()


def vt_request(
    method: str,
    url: str,
    api_key: str,
    limiter: RateLimiter,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> tuple[int, dict]:
    """Perform an HTTP request with retry handling for 429 and transient 5xx."""
    req_headers = {"x-apikey": api_key, "Accept": "application/json"}
    if headers:
        req_headers.update(headers)

    for attempt in range(6):
        limiter.wait()
        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return resp.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8", errors="replace")
            if err.code == 404:
                return 404, {}
            if err.code in (429, 500, 502, 503, 504) and attempt < 5:
                wait_secs = 65 if err.code == 429 else 10 * (attempt + 1)
                print(
                    f"[vt] HTTP {err.code} on {url}; retrying in {wait_secs}s",
                    file=sys.stderr,
                )
                time.sleep(wait_secs)
                continue
            raise RuntimeError(f"VirusTotal HTTP {err.code} on {url}: {raw}") from err
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError) as err:
            if attempt < 5:
                wait_secs = 10 * (attempt + 1)
                print(
                    f"[vt] Network error ({err}); retrying in {wait_secs}s",
                    file=sys.stderr,
                )
                time.sleep(wait_secs)
                continue
            raise RuntimeError(f"VirusTotal request failed on {url}: {err}") from err
    raise RuntimeError(f"VirusTotal request exhausted retries on {url}")


def upload_multipart(
    upload_url: str,
    file_path: pathlib.Path,
    api_key: str,
    limiter: RateLimiter,
) -> str:
    """Upload a file as multipart/form-data and return the analysis id."""
    boundary = f"----BricksVTBoundary{uuid.uuid4().hex}"
    filename = file_path.name.replace('"', "")
    prefix = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    suffix = f"\r\n--{boundary}--\r\n".encode("utf-8")
    total_size = len(prefix) + file_path.stat().st_size + len(suffix)

    parsed = urllib.request.urlparse(upload_url)
    if parsed.scheme != "https":
        raise ValueError(f"Refusing non-HTTPS upload URL: {upload_url}")

    for attempt in range(4):
        limiter.wait()
        conn = http.client.HTTPSConnection(parsed.netloc, timeout=600)
        try:
            target = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            conn.putrequest("POST", target)
            conn.putheader("x-apikey", api_key)
            conn.putheader("Accept", "application/json")
            conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            conn.putheader("Content-Length", str(total_size))
            conn.endheaders()
            conn.send(prefix)
            with file_path.open("rb") as handle:
                while True:
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    conn.send(chunk)
            conn.send(suffix)
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8", errors="replace")
            if resp.status == 429 and attempt < 3:
                print("[vt] HTTP 429 during upload; waiting 65s", file=sys.stderr)
                time.sleep(65)
                continue
            if resp.status >= 400:
                raise RuntimeError(f"Upload failed ({resp.status}): {raw}")
            payload = json.loads(raw)
            return payload["data"]["id"]
        finally:
            conn.close()
    raise RuntimeError(f"Upload exhausted retries for {file_path.name}")


def upload_and_wait(
    file_path: pathlib.Path,
    api_key: str,
    limiter: RateLimiter,
) -> None:
    size = file_path.stat().st_size
    if size <= DIRECT_UPLOAD_LIMIT:
        upload_url = f"{VT_API_BASE}/files"
    else:
        _, url_payload = vt_request(
            "GET", f"{VT_API_BASE}/files/upload_url", api_key, limiter
        )
        upload_url = url_payload["data"]

    analysis_id = upload_multipart(upload_url, file_path, api_key, limiter)
    deadline = time.monotonic() + MAX_ANALYSIS_WAIT_SECS
    while time.monotonic() < deadline:
        _, payload = vt_request(
            "GET", f"{VT_API_BASE}/analyses/{analysis_id}", api_key, limiter
        )
        status = payload.get("data", {}).get("attributes", {}).get("status")
        if status == "completed":
            return
        time.sleep(20)
    raise TimeoutError(f"Timed out waiting for VirusTotal analysis of {file_path.name}")


def evaluate_file_report(payload: dict, max_malicious: int = 5) -> dict:
    """Evaluate VirusTotal file report against release security policy."""
    attrs = payload.get("data", {}).get("attributes", {})
    stats = attrs.get("last_analysis_stats", {})
    results = attrs.get("last_analysis_results", {})

    malicious = int(stats.get("malicious", 0))
    total = sum(
        int(stats.get(k, 0))
        for k in ("malicious", "suspicious", "undetected", "harmless")
    )

    flagged_priority: list[str] = []
    for engine in PRIORITY_ENGINES:
        category = results.get(engine, {}).get("category", "undetected")
        if category in ("malicious", "suspicious"):
            flagged_priority.append(f"{engine}:{category}")

    reasons: list[str] = []
    if total == 0:
        reasons.append("empty VirusTotal analysis stats")
    if malicious >= max_malicious:
        reasons.append(f"malicious={malicious} >= {max_malicious}")
    if flagged_priority:
        reasons.append("priority engine detection (" + ", ".join(flagged_priority) + ")")

    return {
        "malicious": malicious,
        "total": total,
        "flagged_priority": flagged_priority,
        "passed": len(reasons) == 0,
        "reasons": reasons,
    }


def _has_stats(report: dict) -> bool:
    stats = report.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
    return sum(int(stats.get(k, 0)) for k in ("malicious", "suspicious", "undetected", "harmless")) > 0


def scan_artifact(
    file_path: pathlib.Path,
    api_key: str,
    limiter: RateLimiter,
    max_malicious: int,
) -> dict:
    file_hash = sha256_file(file_path)
    status, report = vt_request(
        "GET", f"{VT_API_BASE}/files/{file_hash}", api_key, limiter
    )
    if status == 404 or not _has_stats(report):
        print(f"[vt] Uploading {file_path.name} ({file_path.stat().st_size} bytes)...")
        upload_and_wait(file_path, api_key, limiter)
        for _ in range(4):
            status, report = vt_request(
                "GET", f"{VT_API_BASE}/files/{file_hash}", api_key, limiter
            )
            if status != 404 and _has_stats(report):
                break
            time.sleep(15)
        if status == 404:
            raise RuntimeError(f"File report unavailable after scan for {file_path.name}")

    verdict = evaluate_file_report(report, max_malicious=max_malicious)
    verdict["name"] = file_path.name
    verdict["sha256"] = file_hash
    verdict["url"] = f"https://www.virustotal.com/gui/file/{file_hash}"
    return verdict


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dir", type=pathlib.Path, help="Directory of release artifacts")
    parser.add_argument(
        "--summary-out",
        type=pathlib.Path,
        required=True,
        help="Path to write Markdown summary lines",
    )
    parser.add_argument("--max-malicious", type=int, default=5)
    args = parser.parse_args(argv)

    api_key = os.environ.get("VT_API_KEY", "").strip()
    if not api_key:
        print("Error: VT_API_KEY environment variable is empty or missing.", file=sys.stderr)
        return 2

    files = sorted(
        p for p in args.dir.iterdir()
        if p.is_file() and p.name != "SHA256SUMS.txt" and not p.name.endswith(".sig")
    )
    if not files:
        print(f"Error: no artifacts found in {args.dir}", file=sys.stderr)
        return 2

    limiter = RateLimiter()
    verdicts: list[dict] = []
    failed = False
    for artifact in files:
        verdict = scan_artifact(artifact, api_key, limiter, args.max_malicious)
        verdicts.append(verdict)
        line = (
            f"  - `{verdict['name']}`: `{verdict['malicious']}/{verdict['total']}` "
            f"([Report]({verdict['url']}))"
        )
        print(f"[vt] {verdict['name']}: passed={verdict['passed']} ({verdict['malicious']}/{verdict['total']})")
        if not verdict["passed"]:
            failed = True
            print(
                f"[vt] BLOCKED {verdict['name']}: {'; '.join(verdict['reasons'])}",
                file=sys.stderr,
            )

    summary_lines = [
        f"  - `{v['name']}`: `{v['malicious']}/{v['total']}` ([Report]({v['url']}))"
        for v in verdicts
    ]
    args.summary_out.parent.mkdir(parents=True, exist_ok=True)
    args.summary_out.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
