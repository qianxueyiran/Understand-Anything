#!/usr/bin/env python3
"""Plan and verify Understand Anything cold-start shard workflows."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


SHARD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def load_config(project_root: str | Path, config_path: str | Path) -> dict[str, Any]:
    root = Path(project_root).resolve()
    config = _read_json(Path(config_path), "config")
    if not isinstance(config, dict):
        raise ValueError("Config must be a JSON object")
    if config.get("version") != 1:
        raise ValueError("Config version must be 1")

    platform = config.get("platform", "android")
    if not isinstance(platform, str) or not platform.strip():
        raise ValueError("Config platform must be a non-empty string")
    platform = platform.strip()

    raw_shards = config.get("shards")
    if not isinstance(raw_shards, list) or not raw_shards:
        raise ValueError("Config shards must be a non-empty array")

    seen_ids: set[str] = set()
    shards: list[dict[str, Any]] = []
    for index, raw_shard in enumerate(raw_shards):
        if not isinstance(raw_shard, dict):
            raise ValueError(f"Shard at index {index} must be an object")

        shard_id = raw_shard.get("id")
        if not isinstance(shard_id, str) or not SHARD_ID_PATTERN.fullmatch(shard_id):
            raise ValueError(f"Invalid shard id at index {index}: {shard_id}")
        if shard_id in seen_ids:
            raise ValueError(f"Duplicate shard id: {shard_id}")
        seen_ids.add(shard_id)

        scopes = _validate_scopes(root, shard_id, raw_shard.get("scopes"))
        scope_arg = ",".join(scopes)
        shards.append(
            {
                "id": shard_id,
                "scopes": scopes,
                "scopeArg": scope_arg,
                "understandCommand": f"/understand --scope {scope_arg} --shard {shard_id}",
                "productCommand": f"/understand-product --shard {shard_id} --platform {platform}",
            }
        )

    return {
        "version": 1,
        "platform": platform,
        "configPath": str(Path(config_path)),
        "shards": shards,
    }


def verify_outputs(project_root: str | Path, plan: dict[str, Any]) -> dict[str, Any]:
    root = Path(project_root)
    errors: list[str] = []
    warnings: list[str] = []
    checked_shard_ids = [shard["id"] for shard in plan.get("shards", [])]

    ua_dir = root / ".understand-anything"
    code_manifest = _read_json_if_exists(
        ua_dir / "knowledge-graph.json",
        ".understand-anything/knowledge-graph.json",
        errors,
    )
    product_manifest = _read_json_if_exists(
        ua_dir / "product-index.json",
        ".understand-anything/product-index.json",
        errors,
    )

    if code_manifest is not None:
        _expect_kind(code_manifest, "codebase-sharded", ".understand-anything/knowledge-graph.json", errors)
        _expect_manifest_shards(
            code_manifest,
            checked_shard_ids,
            "shards",
            ".understand-anything/knowledge-graph.json",
            errors,
        )

    if product_manifest is not None:
        _expect_kind(product_manifest, "product-sharded", ".understand-anything/product-index.json", errors)
        _expect_manifest_shards(
            product_manifest,
            checked_shard_ids,
            "product-shards",
            ".understand-anything/product-index.json",
            errors,
        )

    for shard in plan.get("shards", []):
        shard_id = shard["id"]
        scopes = shard["scopes"]
        code_shard_path = ua_dir / "shards" / f"{shard_id}.json"
        product_shard_path = ua_dir / "product-shards" / f"{shard_id}.json"
        product_trace_path = ua_dir / "product-traces" / f"{shard_id}.json"

        code_shard = _read_json_if_exists(
            code_shard_path,
            f".understand-anything/shards/{shard_id}.json",
            errors,
        )
        if code_shard is not None:
            shard_meta = code_shard.get("shard") if isinstance(code_shard, dict) else None
            if not isinstance(shard_meta, dict):
                errors.append(f".understand-anything/shards/{shard_id}.json missing shard metadata")
            else:
                if shard_meta.get("id") != shard_id:
                    errors.append(f".understand-anything/shards/{shard_id}.json shard.id mismatch")
                if shard_meta.get("scopes") != scopes:
                    errors.append(f".understand-anything/shards/{shard_id}.json shard.scopes mismatch")

        _read_json_if_exists(
            product_shard_path,
            f".understand-anything/product-shards/{shard_id}.json",
            errors,
        )
        _read_json_if_exists(
            product_trace_path,
            f".understand-anything/product-traces/{shard_id}.json",
            errors,
        )

    return {
        "ok": not errors,
        "checkedShardIds": checked_shard_ids,
        "errors": errors,
        "warnings": warnings,
    }


def _validate_scopes(root: Path, shard_id: str, raw_scopes: Any) -> list[str]:
    if not isinstance(raw_scopes, list) or not raw_scopes:
        raise ValueError(f"Shard {shard_id} scopes must be a non-empty array")

    scopes: list[str] = []
    for scope in raw_scopes:
        if not isinstance(scope, str) or not scope.strip():
            raise ValueError(f"Shard {shard_id} contains an empty scope")
        normalized = scope.strip()
        if "," in normalized:
            raise ValueError(f"Shard {shard_id} scope contains comma: {normalized}")
        scope_path = (root / normalized).resolve()
        if not _is_relative_to(scope_path, root):
            raise ValueError(f"Scope path is outside project root: {normalized}")
        if not scope_path.exists():
            raise ValueError(f"Scope path does not exist: {normalized}")
        if not scope_path.is_dir():
            raise ValueError(f"Scope path is not a directory: {normalized}")
        scopes.append(normalized)
    return scopes


def _expect_kind(value: Any, expected: str, label: str, errors: list[str]) -> None:
    if not isinstance(value, dict) or value.get("kind") != expected:
        actual = value.get("kind") if isinstance(value, dict) else type(value).__name__
        errors.append(f"{label} kind mismatch: expected {expected}, got {actual}")


def _expect_manifest_shards(
    manifest: Any,
    expected_ids: list[str],
    expected_path_prefix: str,
    label: str,
    errors: list[str],
) -> None:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("shards"), list):
        errors.append(f"{label} missing shards array")
        return

    entries = {entry.get("id"): entry for entry in manifest["shards"] if isinstance(entry, dict)}
    for shard_id in expected_ids:
        entry = entries.get(shard_id)
        expected_path = f"{expected_path_prefix}/{shard_id}.json"
        if entry is None:
            errors.append(f"{label} missing shard entry: {shard_id}")
        elif entry.get("path") != expected_path:
            errors.append(f"{label} shard {shard_id} path mismatch: expected {expected_path}")


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"{label} not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} is not valid JSON: {path}: {exc}") from exc


def _read_json_if_exists(path: Path, label: str, errors: list[str]) -> Any | None:
    if not path.exists():
        errors.append(f"Missing {label}")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"{label} is not valid JSON: {exc}")
        return None


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def main(argv: list[str]) -> int:
    if len(argv) not in (4, 5) or argv[1] not in ("plan", "verify"):
        print(
            "Usage: cold-start-workflow.py plan|verify <project-root> <config-path> [report-path]",
            file=sys.stderr,
        )
        return 2

    try:
        plan = load_config(argv[2], argv[3])
        output = plan if argv[1] == "plan" else verify_outputs(argv[2], plan)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if len(argv) == 5:
        Path(argv[4]).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    else:
        print(json.dumps(output, indent=2))
    return 0 if output.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
