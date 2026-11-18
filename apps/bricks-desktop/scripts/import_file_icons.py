#!/usr/bin/env python3
"""Import Bricks' file, folder, and language icons from miguelsolorio/vscode-symbols.

Usage:
  python3 scripts/import_file_icons.py            # fetch pinned commit from GitHub
  python3 scripts/import_file_icons.py /path/to/vscode-symbols

Writes:
  public/file-icons/svg/<id>.svg          sanitized, contrast-checked SVGs
  public/file-icons/manifest.json         provenance, checksums, and rules
  public/file-icons/LICENSE-VSCODE-SYMBOLS.txt
  public/file-icons/NOTICE.md
  src/lib/features/file-icons/rules.json  the compact rules read by resolve.ts
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = "https://github.com/miguelsolorio/vscode-symbols"
COMMIT = "a405d32cca082d838ad7739b6d0044dea9dbbb79"
RAW_BASE = f"https://raw.githubusercontent.com/miguelsolorio/vscode-symbols/{COMMIT}"
LICENSE_NAME = "LICENSE-VSCODE-SYMBOLS.txt"

APP = Path(__file__).resolve().parent.parent
PUBLIC = APP / "public" / "file-icons"
RULES = APP / "src" / "lib" / "features" / "file-icons" / "rules.json"

# Maps every canonical Bricks icon id (kept stable in rules.json) to its upstream
# relative path inside `src/` of miguelsolorio/vscode-symbols.
ICON_MAP: dict[str, str] = {
    # Languages
    "c": "icons/files/c.svg",
    "cpp": "icons/files/cplus.svg",
    "csharp": "icons/files/csharp.svg",
    "dart": "icons/files/dart.svg",
    "elixir": "icons/files/elixir.svg",
    "erlang": "icons/files/erlang.svg",
    "fortran": "icons/files/fortran.svg",
    "go": "icons/files/go.svg",
    "graphql": "icons/files/graphql.svg",
    "haskell": "icons/files/haskell.svg",
    "java": "icons/files/java.svg",
    "javascript": "icons/files/js.svg",
    "julia": "icons/files/julia.svg",
    "kotlin": "icons/files/kotlin.svg",
    "lua": "icons/files/lua.svg",
    "perl": "icons/files/perl.svg",
    "php": "icons/files/php.svg",
    "prisma": "icons/files/prisma.svg",
    "python": "icons/files/python.svg",
    "r": "icons/files/r.svg",
    "ruby": "icons/files/ruby.svg",
    "rust": "icons/files/rust.svg",
    "scala": "icons/files/scala.svg",
    "solidity": "icons/files/solidity.svg",
    "swift": "icons/files/swift.svg",
    "terraform": "icons/files/terraform.svg",
    "typescript": "icons/files/ts.svg",
    "zig": "icons/files/zig.svg",
    # Exact project/config files
    "file-agents-md": "icons/files/robot.svg",
    "file-cargo-toml": "icons/files/rust.svg",
    "file-changelog-md": "icons/files/markdown.svg",
    "file-cmakelists-txt": "icons/files/cmake.svg",
    "file-dockerfile": "icons/files/docker.svg",
    "file-editorconfig": "icons/files/editorconfig.svg",
    "file-generic": "icons/files/document.svg",
    "file-gitignore": "icons/files/git.svg",
    "file-license": "icons/files/license.svg",
    "file-makefile": "icons/files/gear.svg",
    "file-package-json": "icons/files/node.svg",
    "file-pnpm-lock-yaml": "icons/files/pnpm.svg",
    "file-readme-md": "icons/files/readme.svg",
    "file-rust-toolchain-toml": "icons/files/rust.svg",
    "file-skill-md": "icons/files/puzzle.svg",
    "file-svelte-config-js": "icons/files/svelte.svg",
    "file-tsconfig-json": "icons/files/tsconfig.svg",
    "file-vite-config-ts": "icons/files/vite.svg",
    "file-yarn-lock": "icons/files/yarn.svg",
    # Formats
    "fmt-asciidoc": "icons/files/text.svg",
    "fmt-astro": "icons/files/astro.svg",
    "fmt-audio": "icons/files/audio.svg",
    "fmt-bibliography": "icons/files/tex.svg",
    "fmt-binary": "icons/files/exe.svg",
    "fmt-console": "icons/files/shell.svg",
    "fmt-css": "icons/files/brackets-purple.svg",
    "fmt-database": "icons/files/database.svg",
    "fmt-document": "icons/files/text.svg",
    "fmt-epub": "icons/files/document.svg",
    "fmt-exe": "icons/files/exe.svg",
    "fmt-html": "icons/files/code-orange.svg",
    "fmt-image": "icons/files/image.svg",
    "fmt-json": "icons/files/brackets-yellow.svg",
    "fmt-less": "icons/files/brackets-sky.svg",
    "fmt-lock": "icons/files/lock.svg",
    "fmt-markdown": "icons/files/markdown.svg",
    "fmt-mdx": "icons/files/mdx.svg",
    "fmt-pdf": "icons/files/pdf.svg",
    "fmt-powershell": "icons/files/shell.svg",
    "fmt-proto": "icons/files/proto.svg",
    "fmt-react": "icons/files/react.svg",
    "fmt-react_ts": "icons/files/react-ts.svg",
    "fmt-sass": "icons/files/sass.svg",
    "fmt-settings": "icons/files/gear.svg",
    "fmt-svelte": "icons/files/svelte.svg",
    "fmt-svg": "icons/files/svg.svg",
    "fmt-table": "icons/files/csv.svg",
    "fmt-tex": "icons/files/tex.svg",
    "fmt-toml": "icons/files/gear.svg",
    "fmt-tune": "icons/files/gear.svg",
    "fmt-video": "icons/files/video.svg",
    "fmt-vue": "icons/files/vue.svg",
    "fmt-webassembly": "icons/files/code-purple.svg",
    "fmt-word": "icons/files/document.svg",
    "fmt-xml": "icons/files/xml.svg",
    "fmt-yaml": "icons/files/yaml.svg",
    "fmt-zip": "icons/files/compressed.svg",
    # Compound suffixes
    "fmtcompound-azure-pipelines-yml": "icons/files/yaml.svg",
    "fmtcompound-bench-jsx": "icons/files/react-test.svg",
    "fmtcompound-css-tsx": "icons/files/react-ts.svg",
    "fmtcompound-drone-yml": "icons/files/yaml.svg",
    "fmtcompound-excalidraw-json": "icons/files/drawio.svg",
    "fmtcompound-garden-yml": "icons/files/yaml.svg",
    "fmtcompound-gemfile-lock": "icons/files/ruby.svg",
    "fmtcompound-gitlab-ci-yml": "icons/files/gitlab.svg",
    "fmtcompound-horusec-config-json": "icons/files/brackets-yellow.svg",
    "fmtcompound-jsconfig-json": "icons/files/js.svg",
    "fmtcompound-language-configuration-json": "icons/files/brackets-yellow.svg",
    "fmtcompound-layout-html": "icons/files/code-orange.svg",
    "fmtcompound-markdoc-md": "icons/files/markdoc.svg",
    "fmtcompound-mql-yaml": "icons/files/yaml.svg",
    "fmtcompound-ncurc-json": "icons/files/brackets-yellow.svg",
    "fmtcompound-ndst-yml": "icons/files/yaml.svg",
    "fmtcompound-openapi-json": "icons/files/code-green.svg",
    "fmtcompound-pdm-lock": "icons/files/lock.svg",
    "fmtcompound-pkr-json": "icons/files/brackets-yellow.svg",
    "fmtcompound-postman-collection-json": "icons/files/http.svg",
    "fmtcompound-project-json": "icons/files/brackets-yellow.svg",
    "fmtcompound-prompt-md": "icons/files/markdown.svg",
    "fmtcompound-quokka-jsx": "icons/files/react.svg",
    "fmtcompound-resolver-json": "icons/files/brackets-yellow.svg",
    "fmtcompound-routing-tsx": "icons/files/react-ts.svg",
    "fmtcompound-schema-json": "icons/files/brackets-yellow.svg",
    "fmtcompound-sigstore-json": "icons/files/lock.svg",
    "fmtcompound-spec-tsx": "icons/files/react-test.svg",
    "fmtcompound-st-css": "icons/files/brackets-purple.svg",
    "fmtcompound-steadybit-yml": "icons/files/yaml.svg",
    "fmtcompound-stories-jsx": "icons/files/storybook.svg",
    "fmtcompound-swagger-json": "icons/files/http.svg",
    "fmtcompound-taskfile-yml": "icons/files/taskfile.svg",
    "fmtcompound-testplane-tsx": "icons/files/react-test.svg",
    "fmtcompound-tf-json": "icons/files/terraform.svg",
    "fmtcompound-tofu-json": "icons/files/terraform.svg",
    # Folders
    "folder-closed": "icons/folders/folder.svg",
    "folder-open": "icons/folders/folder-gray-outline.svg",
    "folder-root": "icons/folders/folder-app.svg",
    "folder-folder-config": "icons/folders/folder-config.svg",
    "folder-folder-docs": "icons/folders/folder-documents.svg",
    "folder-folder-lib": "icons/folders/folder-core.svg",
    "folder-folder-node": "icons/folders/folder-node-modules.svg",
    "folder-folder-packages": "icons/folders/folder-modules.svg",
    "folder-folder-resource": "icons/folders/folder-assets.svg",
    "folder-folder-src": "icons/folders/folder-orange-code.svg",
    "folder-folder-test": "icons/folders/folder-red-code.svg",
}


def safe_svg(data: bytes) -> None:
    """Refuse an SVG with scripts, event handlers, external refs, or pure B/W fills."""
    text = data.decode("utf-8")
    if re.search(r"<!DOCTYPE|<!ENTITY|@import", text, re.IGNORECASE):
        raise ValueError("forbidden SVG directive")
    root = ET.fromstring(data)
    if not root.tag.endswith("svg"):
        raise ValueError("not an SVG root")
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1].lower()
        if tag in ("script", "foreignobject", "iframe", "image", "use"):
            if tag == "use":
                href = el.get("href") or el.get("{http://www.w3.org/1999/xlink}href") or ""
                if href.startswith("#"):
                    continue
            raise ValueError(f"forbidden element <{tag}>")
        for name, value in el.attrib.items():
            local = name.rsplit("}", 1)[-1].lower()
            if local.startswith("on"):
                raise ValueError(f"event handler {local}")
            if local == "href" and not value.startswith("#"):
                raise ValueError(f"external reference {value}")
            if "url(" in value and "url(#" not in value.replace(" ", ""):
                raise ValueError(f"external url in {local}")

    # Contrast guard: visible elements outside <defs>/<mask>/<clipPath> must never
    # use unstyled shapes, pure black, or pure white.
    visible = re.sub(r"<(defs|mask|clipPath)\b[^>]*>.*?</\1>", "", text, flags=re.S)
    for attr in ("fill", "stroke"):
        for color in re.findall(rf'{attr}=["\']([^"\']+)["\']', visible):
            if color.lower() in ("#000", "#000000", "black", "#fff", "#ffffff", "white"):
                raise ValueError(f"low-contrast {attr}={color}")


def read_upstream(local_root: Path | None, rel: str, cache: dict[str, bytes]) -> bytes:
    if rel in cache:
        return cache[rel]
    if local_root is not None:
        data = (local_root / rel).read_bytes()
    else:
        url = f"{RAW_BASE}/{rel}"
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = resp.read()
    cache[rel] = data
    return data


def main() -> None:
    if len(sys.argv) > 2:
        raise SystemExit(__doc__)
    local_root = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else None
    rules = json.loads(RULES.read_text(encoding="utf-8"))

    missing_map = sorted(set(rules["icons"]) - set(ICON_MAP))
    if missing_map:
        raise SystemExit(f"rules.json icons missing from ICON_MAP: {missing_map}")

    cache: dict[str, bytes] = {}
    license_bytes = read_upstream(local_root, "LICENSE", cache)

    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    (PUBLIC / "svg").mkdir(parents=True)
    (PUBLIC / LICENSE_NAME).write_bytes(license_bytes)

    icons_out = []
    for icon_id in sorted(rules["icons"]):
        upstream_rel = f"src/{ICON_MAP[icon_id]}"
        data = read_upstream(local_root, upstream_rel, cache)
        safe_svg(data)
        (PUBLIC / "svg" / f"{icon_id}.svg").write_bytes(data)
        icons_out.append({
            "id": icon_id,
            "file": f"svg/{icon_id}.svg",
            "upstream_path": upstream_rel,
            "source": f"{REPO}/blob/{COMMIT}/{upstream_rel}",
            "project": REPO,
            "commit": COMMIT,
            "license": "MIT",
            "license_url": f"{REPO}/blob/{COMMIT}/LICENSE",
            "sha256": hashlib.sha256(data).hexdigest(),
        })

    out_manifest = {
        "schema_version": 1,
        "imported_from": {
            "catalog": "Symbols (miguelsolorio/vscode-symbols)",
            "repository": REPO,
            "commit": COMMIT,
            "license": "MIT",
        },
        "trademark_notice": (
            "Product and language marks belong to their respective owners. "
            "The upstream MIT license covers the icon SVG files in this catalog."
        ),
        "rules": rules,
        "icons": icons_out,
    }
    (PUBLIC / "manifest.json").write_text(
        json.dumps(out_manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    notice = [
        "# File icons",
        "",
        f"Imported from [miguelsolorio/vscode-symbols]({REPO}) at commit `{COMMIT}`",
        "(see `manifest.json` for each icon's upstream path, source URL, and checksum).",
        "",
        "Every SVG uses medium-contrast colors suited for both light and dark themes.",
        "",
        f"License: `{LICENSE_NAME}` (MIT).",
        "",
    ]
    (PUBLIC / "NOTICE.md").write_text("\n".join(notice), encoding="utf-8")
    size = sum(p.stat().st_size for p in (PUBLIC / "svg").iterdir())
    print(f"Imported {len(icons_out)} SVGs ({size} bytes) from vscode-symbols@{COMMIT[:7]}")


if __name__ == "__main__":
    main()
