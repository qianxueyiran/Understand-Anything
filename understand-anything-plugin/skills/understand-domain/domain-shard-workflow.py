#!/usr/bin/env python3
import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path


SHARD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def prepare_domain_shard(project_root, shard_id):
    root = Path(project_root)
    _validate_shard_id(shard_id)
    ua_dir = root / ".understand-anything"
    root_graph_path = ua_dir / "knowledge-graph.json"
    root_graph = _read_json(root_graph_path, "knowledge-graph.json not found. 请先运行 /understand。")

    if not isinstance(root_graph, dict) or root_graph.get("kind") != "codebase-sharded":
        raise ValueError("当前项目不是 sharded code graph。")

    code_shard_path = ua_dir / "shards" / f"{shard_id}.json"
    if not code_shard_path.exists():
        raise FileNotFoundError(
            f"{code_shard_path} not found. 请先运行 /understand --scope ... --shard {shard_id}。"
        )

    return _paths(root, shard_id)


def finalize_domain_shard(project_root, shard_id):
    paths = prepare_domain_shard(project_root, shard_id)
    intermediate_path = Path(paths["intermediatePath"])
    domain_graph = _read_json(
        intermediate_path,
        f"{intermediate_path} not found. domain-analyzer did not write shard output.",
    )
    if not isinstance(domain_graph, dict):
        raise ValueError(f"{intermediate_path} must contain a JSON object.")

    domain_shard_path = Path(paths["domainShardPath"])
    domain_shard_path.parent.mkdir(parents=True, exist_ok=True)
    domain_shard_path.write_text(
        json.dumps(domain_graph, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    refresh_manifest = _load_refresh_manifest()
    refresh_manifest(Path(project_root))
    return paths


def _paths(root, shard_id):
    ua_dir = Path(root) / ".understand-anything"
    return {
        "codeShardPath": str(ua_dir / "shards" / f"{shard_id}.json"),
        "intermediatePath": str(
            ua_dir / "intermediate" / "domain-shards" / shard_id / "domain-analysis.json"
        ),
        "domainShardPath": str(ua_dir / "domain-shards" / f"{shard_id}.json"),
        "manifestPath": str(ua_dir / "domain-graph.json"),
    }


def _validate_shard_id(shard_id):
    if not SHARD_ID_PATTERN.fullmatch(shard_id):
        raise ValueError("Invalid shard id. 只允许字母、数字、下划线和短横线。")


def _read_json(path, missing_message):
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"{path}: {missing_message}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc


def _load_refresh_manifest():
    script_path = Path(__file__).with_name("refresh-domain-sharded-manifest.py")
    spec = importlib.util.spec_from_file_location("refresh_domain_sharded_manifest", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.refresh_manifest


def main(argv):
    parser = argparse.ArgumentParser(description="Prepare or finalize an understand-domain shard.")
    parser.add_argument("project_root")
    parser.add_argument("--shard", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--finalize", action="store_true")
    args = parser.parse_args(argv[1:])

    try:
        result = (
            prepare_domain_shard(args.project_root, args.shard)
            if args.prepare
            else finalize_domain_shard(args.project_root, args.shard)
        )
    except (FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
