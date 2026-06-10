#!/usr/bin/env python3
"""Plan and verify Understand Anything cold-start shard workflows."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any


SHARD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
TERMINAL_STATUSES = {"success", "skipped"}
MAX_ATTEMPTS = 2


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


def init_run_state(project_root: str | Path, config_path: str | Path, run_path: str | Path) -> dict[str, Any]:
    plan = load_config(project_root, config_path)
    run_file = Path(run_path)
    expected_hash = _config_hash(plan)
    if run_file.exists():
        state = read_run_state(run_file)
        if state.get("configHash") == expected_hash:
            return state
    state = _new_run_state(plan)
    _write_json(run_file, state)
    return state


def read_run_state(run_path: str | Path) -> dict[str, Any]:
    return _read_json(Path(run_path), "run state")


def next_action(
    project_root: str | Path,
    config_path: str | Path,
    run_path: str | Path,
    *,
    resume: bool,
    continue_on_error: bool,
) -> dict[str, Any]:
    root = Path(project_root)
    run_file = Path(run_path)
    plan = load_config(root, config_path)
    expected_hash = _config_hash(plan)
    if not run_file.exists():
        state = init_run_state(root, config_path, run_file)
    else:
        state = read_run_state(run_file)
        if state.get("configHash") != expected_hash:
            state = init_run_state(root, config_path, run_file)

    if resume:
        changed = _apply_resume_artifacts(root, state, continue_on_error)
        if changed:
            _write_json(run_file, state)

    action = _next_stage_action(state, continue_on_error)
    _write_json(run_file, state)
    return action


def mark_stage_start(
    project_root: str | Path,
    config_path: str | Path,
    run_path: str | Path,
    stage: str,
    shard_id: str,
    phase: str,
) -> dict[str, Any]:
    state = _load_current_state(project_root, config_path, run_path)
    entry = _find_state_shard(state, shard_id)
    slot = _stage_slot(entry, stage)
    slot["status"] = "running"
    slot["phase"] = phase
    slot["attempts"] = int(slot.get("attempts", 0)) + 1
    slot["startedAt"] = _now_iso()
    slot.pop("finishedAt", None)
    slot.pop("error", None)
    _write_json(Path(run_path), state)
    return state


def mark_stage_success(
    project_root: str | Path,
    config_path: str | Path,
    run_path: str | Path,
    stage: str,
    shard_id: str,
) -> dict[str, Any]:
    state = _load_current_state(project_root, config_path, run_path)
    entry = _find_state_shard(state, shard_id)
    slot = _stage_slot(entry, stage)
    slot["status"] = "success"
    slot["phase"] = "complete"
    slot["finishedAt"] = _now_iso()
    slot.pop("error", None)
    _write_json(Path(run_path), state)
    return state


def mark_stage_failed(
    project_root: str | Path,
    config_path: str | Path,
    run_path: str | Path,
    stage: str,
    shard_id: str,
    phase: str,
    error: str,
) -> dict[str, Any]:
    state = _load_current_state(project_root, config_path, run_path)
    entry = _find_state_shard(state, shard_id)
    slot = _stage_slot(entry, stage)
    slot["status"] = "failed"
    slot["phase"] = phase
    slot["error"] = error
    slot["finishedAt"] = _now_iso()
    _write_json(Path(run_path), state)
    return state


def can_resume_code_shard(project_root: str | Path, shard: dict[str, Any]) -> bool:
    path = Path(project_root) / ".understand-anything" / "shards" / f"{shard['id']}.json"
    graph = _read_json_if_valid(path)
    if not isinstance(graph, dict):
        return False
    shard_meta = graph.get("shard")
    if not isinstance(shard_meta, dict):
        return False
    if shard_meta.get("id") != shard["id"] or shard_meta.get("scopes") != shard["scopes"]:
        return False
    if not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        return False
    if "layers" in graph or "tour" in graph:
        return False
    return True


def can_resume_product_shard(project_root: str | Path, shard: dict[str, Any]) -> bool:
    ua_dir = Path(project_root) / ".understand-anything"
    shard_id = shard["id"]
    product_shard = _read_json_if_valid(ua_dir / "product-shards" / f"{shard_id}.json")
    product_trace = _read_json_if_valid(ua_dir / "product-traces" / f"{shard_id}.json")
    product_manifest = _read_json_if_valid(ua_dir / "product-index.json")
    if not isinstance(product_shard, dict) or not isinstance(product_trace, dict):
        return False
    if not isinstance(product_manifest, dict) or product_manifest.get("kind") != "product-sharded":
        return False
    entries = product_manifest.get("shards")
    if not isinstance(entries, list):
        return False
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("id") != shard_id:
            continue
        return (
            entry.get("path") == f"product-shards/{shard_id}.json"
            and entry.get("tracePath") == f"product-traces/{shard_id}.json"
            and entry.get("sourceCodeShard") == f"shards/{shard_id}.json"
        )
    return False


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _config_hash(plan: dict[str, Any]) -> str:
    payload = {
        "version": plan["version"],
        "platform": plan["platform"],
        "shards": [
            {"id": shard["id"], "scopes": shard["scopes"]}
            for shard in plan.get("shards", [])
        ],
    }
    return "sha256:" + sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _new_run_state(plan: dict[str, Any]) -> dict[str, Any]:
    now = _now_iso()
    return {
        "version": 1,
        "configHash": _config_hash(plan),
        "configPath": plan["configPath"],
        "platform": plan["platform"],
        "createdAt": now,
        "updatedAt": now,
        "shards": [
            {
                "id": shard["id"],
                "scopes": shard["scopes"],
                "scopeArg": shard["scopeArg"],
                "code": _empty_stage_state(),
                "product": _empty_stage_state(),
            }
            for shard in plan.get("shards", [])
        ],
    }


def _empty_stage_state() -> dict[str, Any]:
    return {"status": "pending", "phase": None, "attempts": 0}


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _read_json_if_valid(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _load_current_state(project_root: str | Path, config_path: str | Path, run_path: str | Path) -> dict[str, Any]:
    run_file = Path(run_path)
    if not run_file.exists():
        return init_run_state(project_root, config_path, run_file)
    state = read_run_state(run_file)
    plan = load_config(project_root, config_path)
    if state.get("configHash") != _config_hash(plan):
        return init_run_state(project_root, config_path, run_file)
    return state


def _find_state_shard(state: dict[str, Any], shard_id: str) -> dict[str, Any]:
    for shard in state.get("shards", []):
        if shard.get("id") == shard_id:
            return shard
    raise ValueError(f"Shard is not present in run state: {shard_id}")


def _stage_slot(entry: dict[str, Any], stage: str) -> dict[str, Any]:
    if stage not in ("code", "product"):
        raise ValueError(f"Invalid cold-start stage: {stage}")
    slot = entry.get(stage)
    if not isinstance(slot, dict):
        entry[stage] = _empty_stage_state()
    return entry[stage]


def _apply_resume_artifacts(root: Path, state: dict[str, Any], continue_on_error: bool) -> bool:
    changed = False
    for shard in state.get("shards", []):
        code = _stage_slot(shard, "code")
        if code.get("status") not in TERMINAL_STATUSES and can_resume_code_shard(root, shard):
            code["status"] = "skipped"
            code["phase"] = "resume-verified"
            code["finishedAt"] = _now_iso()
            changed = True
    if not _all_code_done(state, continue_on_error):
        return changed
    for shard in state.get("shards", []):
        product = _stage_slot(shard, "product")
        if product.get("status") not in TERMINAL_STATUSES and can_resume_product_shard(root, shard):
            product["status"] = "skipped"
            product["phase"] = "resume-verified"
            product["finishedAt"] = _now_iso()
            changed = True
    return changed


def _all_code_done(state: dict[str, Any], continue_on_error: bool) -> bool:
    for shard in state.get("shards", []):
        status = _stage_slot(shard, "code").get("status")
        if status in TERMINAL_STATUSES:
            continue
        if continue_on_error and status == "failed":
            continue
        return False
    return True


def _next_stage_action(state: dict[str, Any], continue_on_error: bool) -> dict[str, Any]:
    for stage in ("code", "product"):
        if stage == "product" and not _all_code_done(state, continue_on_error):
            break
        for shard in state.get("shards", []):
            if stage == "product" and _stage_slot(shard, "code").get("status") not in TERMINAL_STATUSES:
                continue
            slot = _stage_slot(shard, stage)
            status = slot.get("status")
            attempts = int(slot.get("attempts", 0))
            if status in TERMINAL_STATUSES:
                continue
            if status == "failed":
                if attempts < MAX_ATTEMPTS:
                    return _action_for(stage, shard, retry=True)
                if continue_on_error:
                    continue
                return {
                    "action": "blocked",
                    "stage": stage,
                    "shardId": shard["id"],
                    "phase": slot.get("phase"),
                    "error": slot.get("error"),
                    "attempts": attempts,
                }
            return _action_for(stage, shard, retry=False)
    return {"action": "complete"}


def _action_for(stage: str, shard: dict[str, Any], *, retry: bool) -> dict[str, Any]:
    action = "run-code-shard" if stage == "code" else "run-product-shard"
    return {
        "action": action,
        "stage": stage,
        "shardId": shard["id"],
        "scopes": shard["scopes"],
        "scopeArg": shard["scopeArg"],
        "retry": retry,
    }


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
    if len(argv) < 2:
        _print_usage()
        return 2

    command = argv[1]
    if command in ("plan", "verify"):
        if len(argv) not in (4, 5):
            _print_usage()
            return 2
        try:
            plan = load_config(argv[2], argv[3])
            output = plan if command == "plan" else verify_outputs(argv[2], plan)
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1

        if len(argv) == 5:
            _write_json(Path(argv[4]), output)
        else:
            print(json.dumps(output, indent=2))
        return 0 if output.get("ok", True) else 1

    try:
        output = _run_state_command(argv)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if output is None:
        _print_usage()
        return 2
    return 0


def _print_usage() -> None:
    print(
        "Usage: cold-start-workflow.py plan|verify <project-root> <config-path> [report-path]\n"
        "       cold-start-workflow.py init <project-root> <config-path> <run-path>\n"
        "       cold-start-workflow.py next <project-root> <config-path> <run-path> <output-path> [--resume] [--continue-on-error]\n"
        "       cold-start-workflow.py mark-start <project-root> <config-path> <run-path> <code|product> <shard-id> <phase>\n"
        "       cold-start-workflow.py mark-success <project-root> <config-path> <run-path> <code|product> <shard-id>\n"
        "       cold-start-workflow.py mark-failed <project-root> <config-path> <run-path> <code|product> <shard-id> <phase> <error>\n"
        "       cold-start-workflow.py status <project-root> <config-path> <run-path> <output-path>",
        file=sys.stderr,
    )


def _run_state_command(argv: list[str]) -> dict[str, Any] | None:
    command = argv[1]
    if command == "init" and len(argv) == 5:
        return init_run_state(argv[2], argv[3], argv[4])
    if command == "next" and len(argv) >= 6:
        flags = set(argv[6:])
        action = next_action(
            argv[2],
            argv[3],
            argv[4],
            resume="--resume" in flags,
            continue_on_error="--continue-on-error" in flags,
        )
        _write_json(Path(argv[5]), action)
        return action
    if command == "mark-start" and len(argv) == 8:
        return mark_stage_start(argv[2], argv[3], argv[4], argv[5], argv[6], argv[7])
    if command == "mark-success" and len(argv) == 7:
        return mark_stage_success(argv[2], argv[3], argv[4], argv[5], argv[6])
    if command == "mark-failed" and len(argv) >= 9:
        error = " ".join(argv[8:])
        return mark_stage_failed(argv[2], argv[3], argv[4], argv[5], argv[6], argv[7], error)
    if command == "status" and len(argv) == 6:
        state = _load_current_state(argv[2], argv[3], argv[4])
        _write_json(Path(argv[5]), state)
        return state
    return None


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
