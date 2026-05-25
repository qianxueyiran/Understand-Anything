#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


SHARD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def refresh_manifest(project_root):
    root = Path(project_root)
    understand_dir = root / ".understand-anything"
    shard_dir = understand_dir / "domain-shards"
    manifest_path = understand_dir / "domain-graph.json"
    existing_update = read_existing_update(manifest_path)
    shards = []
    warnings = []

    for shard_path in sorted(shard_dir.glob("*.json")) if shard_dir.is_dir() else []:
        shard_id = shard_path.stem
        if not SHARD_ID_PATTERN.fullmatch(shard_id):
            warnings.append(f"Skipped invalid domain shard filename: {shard_path.name}")
            continue
        shards.append(
            {
                "id": shard_id,
                "path": f"domain-shards/{shard_path.name}",
                "sourceCodeShard": f"shards/{shard_id}.json",
            }
        )

    manifest = {
        "version": "1.0.0",
        "kind": "domain-sharded",
        "source": {"codeManifest": "knowledge-graph.json"},
        "shards": shards,
        "warnings": warnings,
    }
    if existing_update is not None:
        manifest["update"] = existing_update

    understand_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def read_existing_update(manifest_path):
    if not manifest_path.exists():
        return None
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    update = data.get("update")
    return update if isinstance(update, dict) else None


def main(argv):
    if len(argv) != 2:
        print("Usage: refresh-domain-sharded-manifest.py <project-root>", file=sys.stderr)
        return 2

    manifest = refresh_manifest(argv[1])
    print(
        f"Refreshed domain sharded manifest: {len(manifest['shards'])} shards, "
        f"{len(manifest['warnings'])} warnings",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
