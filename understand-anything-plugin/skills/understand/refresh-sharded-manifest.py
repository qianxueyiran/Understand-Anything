#!/usr/bin/env python3
"""Refresh the lightweight manifest for a sharded Understand Anything graph."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def refresh_manifest(project_root: str | Path) -> dict[str, Any]:
    root = Path(project_root)
    ua_dir = root / ".understand-anything"
    shards_dir = ua_dir / "shards"
    warnings: list[str] = []
    shards: list[dict[str, Any]] = []
    projects: list[dict[str, Any]] = []
    total_nodes = 0
    total_edges = 0

    for shard_path in sorted(shards_dir.glob("*.json")):
        try:
            graph = json.loads(shard_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            warnings.append(f"Skipped {shard_path.name}: {exc}")
            continue

        nodes = graph.get("nodes")
        edges = graph.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            warnings.append(f"Skipped {shard_path.name}: missing nodes/edges arrays")
            continue

        shard_meta = graph.get("shard") if isinstance(graph.get("shard"), dict) else {}
        shard_id = shard_meta.get("id") if isinstance(shard_meta.get("id"), str) else shard_path.stem
        scopes = shard_meta.get("scopes") if isinstance(shard_meta.get("scopes"), list) else []

        node_count = len(nodes)
        edge_count = len(edges)
        total_nodes += node_count
        total_edges += edge_count
        shards.append(
            {
                "id": shard_id,
                "file": f"shards/{shard_path.name}",
                "scopes": scopes,
                "nodeCount": node_count,
                "edgeCount": edge_count,
            }
        )

        project = graph.get("project")
        if isinstance(project, dict):
            projects.append(project)

    manifest = {
        "kind": "codebase-sharded",
        "project": _merge_projects(projects),
        "overview": {
            "summary": _build_summary(len(shards), total_nodes, total_edges),
            "nodeCount": total_nodes,
            "edgeCount": total_edges,
            "shardCount": len(shards),
        },
        "shards": shards,
        "warnings": warnings,
    }

    ua_dir.mkdir(parents=True, exist_ok=True)
    (ua_dir / "knowledge-graph.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return manifest


def _merge_projects(projects: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for key in ("name", "description", "analyzedAt", "gitCommitHash"):
        value = _first_present(projects, key)
        if value is not None:
            merged[key] = value

    for key in ("languages", "frameworks"):
        values: list[Any] = []
        seen: set[str] = set()
        for project in projects:
            items = project.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                marker = json.dumps(item, sort_keys=True) if not isinstance(item, str) else item
                if marker in seen:
                    continue
                seen.add(marker)
                values.append(item)
        if values:
            merged[key] = values
    return merged


def _first_present(projects: list[dict[str, Any]], key: str) -> Any:
    for project in projects:
        value = project.get(key)
        if value is not None:
            return value
    return None


def _build_summary(shard_count: int, node_count: int, edge_count: int) -> str:
    return f"Sharded codebase manifest with {shard_count} shards, {node_count} nodes, and {edge_count} edges."


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: refresh-sharded-manifest.py <project-root>", file=sys.stderr)
        return 2

    manifest = refresh_manifest(argv[1])
    overview = manifest["overview"]
    warning_count = len(manifest["warnings"])
    print(
        "Refreshed sharded manifest: "
        f"{overview['shardCount']} shards, "
        f"{overview['nodeCount']} nodes, "
        f"{overview['edgeCount']} edges, "
        f"{warning_count} warnings",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
