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
    existing_update = _read_existing_manifest_update(ua_dir / "knowledge-graph.json")

    for shard_path in sorted(shards_dir.glob("*.json")):
        graph, warning = _read_graph(shard_path)
        if warning is not None:
            warnings.append(warning)
        if graph is None:
            continue

        nodes = graph.get("nodes")
        edges = graph.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            warnings.append(f"Skipped {shard_path.name}: missing nodes/edges arrays")
            continue

        shard_meta = graph.get("shard") if isinstance(graph.get("shard"), dict) else {}
        shard_id = shard_meta.get("id") if isinstance(shard_meta.get("id"), str) else shard_path.stem
        scopes = shard_meta.get("scopes") if isinstance(shard_meta.get("scopes"), list) else []
        project = graph.get("project") if isinstance(graph.get("project"), dict) else {}
        updated_at = _first_present_value(shard_meta.get("updatedAt"), project.get("analyzedAt"))
        git_commit_hash = _first_present_value(
            shard_meta.get("gitCommitHash"), project.get("gitCommitHash")
        )

        node_count = len(nodes)
        edge_count = len(edges)
        total_nodes += node_count
        total_edges += edge_count
        shards.append(
            {
                "id": shard_id,
                "path": f"shards/{shard_path.name}",
                "scopes": scopes,
                "updatedAt": _normalize_timestamp(updated_at),
                "gitCommitHash": git_commit_hash,
                "nodeCount": node_count,
                "edgeCount": edge_count,
            }
        )

        if project:
            project_for_manifest = dict(project)
            if updated_at is not None:
                project_for_manifest["analyzedAt"] = _normalize_timestamp(updated_at)
            if git_commit_hash is not None:
                project_for_manifest["gitCommitHash"] = git_commit_hash
            projects.append(project_for_manifest)

    manifest = {
        "kind": "codebase-sharded",
        "version": "1.0.0",
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
    if existing_update is not None:
        manifest["update"] = existing_update

    ua_dir.mkdir(parents=True, exist_ok=True)
    (ua_dir / "knowledge-graph.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return manifest


def _read_graph(shard_path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        data = json.loads(shard_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"Skipped {shard_path.name}: {exc}"

    if not isinstance(data, dict):
        return None, f"Skipped {shard_path.name}: shard manifest must be an object"
    return data, None


def _read_existing_manifest_update(manifest_path: Path) -> dict[str, Any] | None:
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


def _first_present_value(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _normalize_timestamp(value: Any) -> Any:
    if isinstance(value, str) and value.endswith("Z") and "." not in value:
        return value[:-1] + ".000Z"
    return value


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
