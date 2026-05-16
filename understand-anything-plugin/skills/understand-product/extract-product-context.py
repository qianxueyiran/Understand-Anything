#!/usr/bin/env python3
"""
extract-product-context.py - Collect high-signal product context candidates.

Usage:
    python extract-product-context.py <project-root>

Output:
    <project-root>/.understand-anything/intermediate/product-context.json
"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Tuple


MAX_FILES = 160
MAX_SCANNED_FILES = 5000
MAX_READ_CANDIDATES = 640
MAX_STRINGS = 30
MAX_FIELDS = 30
MAX_PREVIEW_CHARS = 1200
MAX_FILE_BYTES = 256 * 1024

SKIP_DIRS = {
    ".git",
    ".understand-anything",
    ".cache",
    ".next",
    ".turbo",
    "node_modules",
    "coverage",
    "dist",
    "build",
    "vendor",
    "target",
    "out",
    ".cxx",
    ".gradle",
    "Pods",
}

SUPPORTED_SUFFIXES = {".kt", ".java", ".xml", ".json", ".graphql", ".proto"}

PRODUCT_FILE_RE = re.compile(
    r"(product|feature|screen|page|ui|view|layout|fragment|activity|dialog|"
    r"widget|component|resource|strings|copy|message|label|banner|card|"
    r"pay|payment|order|cart|checkout|subscribe|vip|member|profile|account|"
    r"login|auth|search|recommend|feed|home|detail|player|playback|"
    r"quality|coupon|promotion|discount|tracking|analytics|event)",
    re.IGNORECASE,
)

FIELD_RE = re.compile(
    r"(?:val|var|String|Int|Long|Boolean|Double|Float)\s+([A-Za-z_][A-Za-z0-9_]*)\b|"
    r"['\"]([A-Za-z_][A-Za-z0-9_.-]{1,80})['\"]\s*:|"
    r"\b(?:optional|required|repeated)?\s*[A-Za-z][A-Za-z0-9_.<>]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*=",
    re.MULTILINE,
)

GRAPHQL_FIELD_RE = re.compile(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:\s*[\[\]!A-Za-z_][\[\]\!A-Za-z0-9_]*",
    re.MULTILINE,
)

GRAPHQL_SELECTION_RE = re.compile(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*(?:\{|$)",
    re.MULTILINE,
)

RESOURCE_RE = re.compile(
    r"<string\b[^>]*\bname=[\"']([^\"']+)[\"'][^>]*>(.*?)</string>",
    re.DOTALL,
)

DISPLAY_RULE_RE = re.compile(
    r"\b(if|when|switch|case)\b|"
    r"\b(isVisible|visibility|setVisibility|show|hide|gone|visible|enabled|disabled)\b|"
    r"\b(setText|text\s*=|title\s*=|subtitle\s*=|label\s*=|message\s*=)\b",
    re.IGNORECASE,
)


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python extract-product-context.py <project-root>", file=sys.stderr)
        return 2

    project_root = Path(sys.argv[1]).resolve()
    if not project_root.is_dir():
        print("Error: project root is not a directory: %s" % project_root, file=sys.stderr)
        return 1

    candidates, stats = collect_candidates(project_root)
    output = {
        "projectName": project_root.name,
        "metadata": {
            "truncated": stats["truncated"],
            "stats": stats,
        },
        "candidateFiles": candidates,
    }

    output_path = project_root / ".understand-anything" / "intermediate" / "product-context.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "Wrote %s candidate files to %s (scanned=%s, read=%s, truncated=%s)"
        % (
            len(candidates),
            output_path,
            stats["scannedFiles"],
            stats["readCandidates"],
            str(stats["truncated"]).lower(),
        )
    )
    return 0


def collect_candidates(project_root: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    scored: List[Dict[str, Any]] = []
    walk_state = {
        "scannedFiles": 0,
        "truncated": False,
    }
    read_candidates = 0
    truncated = False

    for path in walk_supported_files(project_root, walk_state):
        rel_path = path.relative_to(project_root).as_posix()
        if not is_product_candidate(path, rel_path):
            continue

        if read_candidates >= MAX_READ_CANDIDATES:
            truncated = True
            break

        content = read_text_sample(path)
        if content is None:
            continue

        read_candidates += 1
        candidate = build_candidate(rel_path, path, content)
        score = score_candidate(candidate, rel_path)
        scored.append({"score": score, "candidate": candidate})

    scored.sort(key=lambda item: (-item["score"], item["candidate"]["path"]))
    candidates = [item["candidate"] for item in scored[:MAX_FILES]]
    stats = {
        "truncated": truncated or walk_state["truncated"] or len(scored) > MAX_FILES,
        "scannedFiles": walk_state["scannedFiles"],
        "readCandidates": read_candidates,
        "returnedCandidates": len(candidates),
        "maxScannedFiles": MAX_SCANNED_FILES,
        "maxReadCandidates": MAX_READ_CANDIDATES,
        "maxReturnedCandidates": MAX_FILES,
    }
    return candidates, stats


def walk_supported_files(project_root: Path, state: Dict[str, Any]) -> Generator[Path, None, None]:
    def visit(directory: Path) -> Generator[Path, None, None]:
        if state["truncated"]:
            return

        try:
            entries = sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        except OSError:
            return

        for entry in entries:
            if entry.is_symlink():
                continue
            if entry.is_dir():
                if entry.name in SKIP_DIRS:
                    continue
                yield from visit(entry)
                continue
            if entry.is_file():
                if state["scannedFiles"] >= MAX_SCANNED_FILES:
                    state["truncated"] = True
                    return
                state["scannedFiles"] += 1
                if entry.suffix in SUPPORTED_SUFFIXES:
                    yield entry

    yield from visit(project_root)


def is_product_candidate(path: Path, rel_path: str) -> bool:
    if path.name == "strings.xml":
        return True
    return bool(PRODUCT_FILE_RE.search(rel_path))


def read_text_sample(path: Path) -> Optional[str]:
    try:
        data = path.read_bytes()[:MAX_FILE_BYTES]
    except OSError:
        return None
    return data.decode("utf-8", errors="replace")


def build_candidate(rel_path: str, path: Path, content: str) -> Dict[str, Any]:
    return {
        "path": rel_path,
        "kind": classify_kind(path),
        "strings": extract_strings(content) if path.name == "strings.xml" else [],
        "fields": extract_fields(content, path.suffix),
        "hasDisplayLogic": bool(DISPLAY_RULE_RE.search(content)),
        "preview": content[:MAX_PREVIEW_CHARS],
    }


def classify_kind(path: Path) -> str:
    if path.name == "strings.xml":
        return "strings-resource"
    if path.suffix == ".xml":
        return "xml-resource"
    if path.suffix == ".json":
        return "json-data"
    if path.suffix == ".graphql":
        return "graphql-schema"
    if path.suffix == ".proto":
        return "proto-schema"
    if path.suffix in {".kt", ".java"}:
        return "source"
    return "unknown"


def extract_strings(content: str) -> List[Dict[str, str]]:
    strings: List[Dict[str, str]] = []
    for match in RESOURCE_RE.finditer(content):
        value = clean_xml_text(match.group(2))
        if not value:
            continue
        strings.append({
            "name": match.group(1),
            "value": value,
        })
        if len(strings) >= MAX_STRINGS:
            break
    return strings


def clean_xml_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_fields(content: str, suffix: str = "") -> List[str]:
    fields: List[str] = []
    seen = set()

    if suffix == ".graphql":
        for name in extract_graphql_fields(content):
            if name in seen:
                continue
            seen.add(name)
            fields.append(name)
            if len(fields) >= MAX_FIELDS:
                return fields

    for match in FIELD_RE.finditer(content):
        name = next((group for group in match.groups() if group), None)
        if not name or name in seen:
            continue
        seen.add(name)
        fields.append(name)
        if len(fields) >= MAX_FIELDS:
            break
    return fields


def extract_graphql_fields(content: str) -> List[str]:
    fields: List[str] = []
    seen = set()

    def add(name: str) -> None:
        if name.startswith("__") or name in seen:
            return
        seen.add(name)
        fields.append(name)

    for regex in (GRAPHQL_FIELD_RE, GRAPHQL_SELECTION_RE):
        for match in regex.finditer(content):
            add(match.group(1))
            if len(fields) >= MAX_FIELDS:
                return fields
    return fields


def score_candidate(candidate: Dict[str, Any], rel_path: str) -> int:
    score = 0
    lower = rel_path.lower()
    if candidate["strings"]:
        score += 30
    if candidate["hasDisplayLogic"]:
        score += 20
    if candidate["fields"]:
        score += min(len(candidate["fields"]), 10)
    if "/res/" in lower or "resource" in lower:
        score += 10
    if any(token in lower for token in ("screen", "page", "activity", "fragment", "viewmodel")):
        score += 8
    if any(token in lower for token in ("api", "model", "dto", "proto", "graphql")):
        score += 6
    return score


if __name__ == "__main__":
    raise SystemExit(main())
