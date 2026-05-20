# Understand Scope Shards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `/understand` 增加 `--scope ... --shard ...` 单分片生成能力，同时保持无 `--scope` 的完整图流程兼容。

**Architecture:** 完整模式继续写 `.understand-anything/knowledge-graph.json`。分片模式只分析 scope 内文件，写入 `.understand-anything/shards/<id>.json`，再刷新根 `knowledge-graph.json` 为轻量 sharded manifest。跨分片引用直接保留现有 edge 的 source/target node id，不新增 `graph-locator.json`。

**Tech Stack:** Python 3 `unittest` 用于 skill helper 脚本测试；Markdown skill 指令驱动 `/understand` agent 流程；现有 `KnowledgeGraph` JSON schema 作为 shard 文件结构。

---

## File Structure

- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py`
  - 增加 `allow_external_edges` 参数。
  - CLI 支持 `--allow-external-edges`。
  - shard mode 下保留 target/source 不在本 shard nodes 中的边，并在 report 中统计 external edge 数量。
- Modify: `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`
  - 增加 merge tests，证明完整模式仍删除 dangling edge，shard mode 保留 external edge。
- Create: `understand-anything-plugin/skills/understand/refresh-sharded-manifest.py`
  - 扫描 `.understand-anything/shards/*.json`。
  - 生成轻量 `.understand-anything/knowledge-graph.json`。
  - 保留每个 shard 的 `id`、`path`、`scopes`、统计和更新时间。
- Create: `understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py`
  - 测试 manifest 汇总、覆盖已有 shard 后统计更新、非法 shard 文件跳过。
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`
  - 参数说明新增 `--scope`、`--shard`。
  - Phase 0 增加参数校验。
  - Phase 1 扫描阶段说明 scope roots。
  - Phase 2 merge 命令在 shard mode 使用 `--allow-external-edges`。
  - Phase 7 保存阶段区分完整模式和 shard 模式。

---

### Task 1: Preserve External Edges In Shard Mode

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py`
- Modify: `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`

- [ ] **Step 1: Write the failing test for full mode dangling edge behavior**

Append this test method inside `MergeIntegrationTests` in `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`:

```python
    def test_full_mode_drops_dangling_edges(self) -> None:
        batch = {
            "nodes": [
                _file_node("a_home/HomeViewModel.kt"),
            ],
            "edges": [
                {
                    "source": "file:a_home/HomeViewModel.kt",
                    "target": "file:a_player/PlayerService.kt",
                    "type": "imports",
                    "direction": "forward",
                    "weight": 0.7,
                },
            ],
        }

        assembled, report = mbg.merge_and_normalize([batch])

        self.assertEqual(assembled["edges"], [])
        self.assertTrue(
            any("dropped, missing target" in line for line in report),
            report,
        )
```

- [ ] **Step 2: Run the full mode test and verify existing behavior**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py MergeIntegrationTests.test_full_mode_drops_dangling_edges
```

Expected: PASS. This locks existing full mode compatibility before adding shard mode.

- [ ] **Step 3: Write the failing test for shard mode external edges**

Append this test method inside `MergeIntegrationTests`:

```python
    def test_shard_mode_preserves_external_target_edges(self) -> None:
        batch = {
            "nodes": [
                _file_node("a_home/HomeViewModel.kt"),
            ],
            "edges": [
                {
                    "source": "file:a_home/HomeViewModel.kt",
                    "target": "file:a_player/PlayerService.kt",
                    "type": "imports",
                    "direction": "forward",
                    "weight": 0.7,
                },
            ],
        }

        assembled, report = mbg.merge_and_normalize(
            [batch],
            allow_external_edges=True,
        )

        self.assertEqual(len(assembled["edges"]), 1)
        self.assertEqual(
            assembled["edges"][0]["target"],
            "file:a_player/PlayerService.kt",
        )
        self.assertTrue(
            any("external edges preserved" in line for line in report),
            report,
        )
```

- [ ] **Step 4: Run the shard mode test and verify it fails**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py MergeIntegrationTests.test_shard_mode_preserves_external_target_edges
```

Expected: FAIL with `TypeError: merge_and_normalize() got an unexpected keyword argument 'allow_external_edges'`.

- [ ] **Step 5: Add the minimal merge implementation**

Change the function signature in `merge-batch-graphs.py`:

```python
def merge_and_normalize(
    batches: list[dict[str, Any]],
    allow_external_edges: bool = False,
) -> tuple[dict[str, Any], list[str]]:
```

Replace the dangling edge handling block in Step 6 with:

```python
        missing_source = src not in node_ids
        missing_target = tgt not in node_ids
        if missing_source or missing_target:
            missing = []
            if missing_source:
                missing.append(f"source '{src}'")
            if missing_target:
                missing.append(f"target '{tgt}'")
            if not allow_external_edges:
                unfixable.append(f"Edge {src} → {tgt} ({etype}): dropped, missing {', '.join(missing)}")
                continue
            external_edge_count += 1
            edge["external"] = True
            edge["externalReason"] = f"missing {', '.join(missing)} in current shard"
```

Declare `external_edge_count` before the edge loop:

```python
    external_edge_count = 0
```

Add this report section after `fixed_lines` are built:

```python
    if external_edge_count:
        fixed_lines.append(f"  {external_edge_count:>4} × external edges preserved for shard mode")
```

- [ ] **Step 6: Run the focused merge tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py MergeIntegrationTests -v
```

Expected: all `MergeIntegrationTests` pass.

- [ ] **Step 7: Add CLI flag test by exercising main path**

Append this test method inside `MergeIntegrationTests`:

```python
    def test_cli_accepts_allow_external_edges_flag(self) -> None:
        self.assertTrue(hasattr(mbg, "parse_args"))
        args = mbg.parse_args(["/tmp/project", "--allow-external-edges"])
        self.assertEqual(args.project_root, "/tmp/project")
        self.assertTrue(args.allow_external_edges)
```

- [ ] **Step 8: Run the CLI flag test and verify it fails**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py MergeIntegrationTests.test_cli_accepts_allow_external_edges_flag
```

Expected: FAIL because `parse_args` is not defined.

- [ ] **Step 9: Implement CLI parsing**

Add imports near the top of `merge-batch-graphs.py`:

```python
import argparse
```

Add this helper before `main()`:

```python
def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="merge-batch-graphs.py",
        description="Merge and normalize batch analysis results.",
    )
    parser.add_argument("project_root")
    parser.add_argument(
        "--allow-external-edges",
        action="store_true",
        help="Preserve edges whose endpoints are outside the current shard.",
    )
    return parser.parse_args(argv)
```

Update `main()`:

```python
def main() -> None:
    args = parse_args(sys.argv[1:])
    project_root = Path(args.project_root).resolve()
    intermediate_dir = project_root / ".understand-anything" / "intermediate"
```

Update the merge call:

```python
    assembled, report = merge_and_normalize(
        batches,
        allow_external_edges=args.allow_external_edges,
    )
```

- [ ] **Step 10: Run all merge tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py -v
```

Expected: all tests pass.

- [ ] **Step 11: Commit Task 1**

Run:

```bash
git add understand-anything-plugin/skills/understand/merge-batch-graphs.py understand-anything-plugin/skills/understand/test_merge_batch_graphs.py
git commit -m "feat(understand): preserve shard external edges"
```

---

### Task 2: Generate Sharded Root Manifest

**Files:**
- Create: `understand-anything-plugin/skills/understand/refresh-sharded-manifest.py`
- Create: `understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py`

- [ ] **Step 1: Write tests for manifest generation**

Create `understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py`:

```python
#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


_HERE = Path(__file__).resolve().parent
_MODULE_PATH = _HERE / "refresh-sharded-manifest.py"


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("refresh_sharded_manifest", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["refresh_sharded_manifest"] = module
    spec.loader.exec_module(module)
    return module


def _graph(name: str, scopes: list[str], node_count: int, edge_count: int) -> dict[str, Any]:
    return {
        "version": "1.0.0",
        "kind": "codebase",
        "project": {
            "name": "KiwifruitApp",
            "languages": ["kotlin"],
            "frameworks": ["Android"],
            "description": f"{name} shard",
            "analyzedAt": "2026-05-20T00:00:00.000Z",
            "gitCommitHash": "abc123",
        },
        "shard": {"id": name, "scopes": scopes},
        "nodes": [
            {
                "id": f"file:{name}/File{i}.kt",
                "type": "file",
                "name": f"File{i}.kt",
                "filePath": f"{name}/File{i}.kt",
                "summary": "",
                "tags": [],
                "complexity": "simple",
            }
            for i in range(node_count)
        ],
        "edges": [
            {
                "source": f"file:{name}/File0.kt",
                "target": f"file:{name}/File0.kt",
                "type": "related",
                "direction": "forward",
                "weight": 0.5,
            }
            for _ in range(edge_count)
        ],
        "layers": [],
        "tour": [],
    }


class RefreshShardedManifestTests(unittest.TestCase):
    def test_builds_manifest_from_shards(self) -> None:
        rsm = _load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shards = root / ".understand-anything" / "shards"
            shards.mkdir(parents=True)
            (shards / "home.json").write_text(
                json.dumps(_graph("home", ["a_home", "a_home_api"], 2, 1)),
                encoding="utf-8",
            )
            (shards / "player.json").write_text(
                json.dumps(_graph("player", ["a_player"], 1, 0)),
                encoding="utf-8",
            )

            manifest = rsm.refresh_manifest(root)

            self.assertEqual(manifest["kind"], "codebase-sharded")
            self.assertEqual(manifest["overview"]["shardCount"], 2)
            self.assertEqual(manifest["overview"]["nodeCount"], 3)
            self.assertEqual(manifest["overview"]["edgeCount"], 1)
            self.assertEqual([s["id"] for s in manifest["shards"]], ["home", "player"])
            self.assertEqual(manifest["shards"][0]["scopes"], ["a_home", "a_home_api"])
            self.assertTrue((root / ".understand-anything" / "knowledge-graph.json").is_file())

    def test_skips_malformed_shard_files(self) -> None:
        rsm = _load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shards = root / ".understand-anything" / "shards"
            shards.mkdir(parents=True)
            (shards / "home.json").write_text(
                json.dumps(_graph("home", ["a_home"], 1, 0)),
                encoding="utf-8",
            )
            (shards / "broken.json").write_text("{not json", encoding="utf-8")

            manifest = rsm.refresh_manifest(root)

            self.assertEqual(manifest["overview"]["shardCount"], 1)
            self.assertEqual(manifest["shards"][0]["id"], "home")
            self.assertIn("broken.json", manifest["warnings"][0])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the manifest tests and verify they fail**

Run:

```bash
python understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py -v
```

Expected: FAIL with file-not-found for `refresh-sharded-manifest.py`.

- [ ] **Step 3: Implement the manifest script**

Create `understand-anything-plugin/skills/understand/refresh-sharded-manifest.py`:

```python
#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _read_graph(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return None, f"{path.name}: skipped malformed shard ({exc})"
    if not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        return None, f"{path.name}: skipped shard missing nodes or edges arrays"
    return data, None


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def refresh_manifest(project_root: str | Path) -> dict[str, Any]:
    root = Path(project_root).resolve()
    ua_dir = root / ".understand-anything"
    shards_dir = ua_dir / "shards"
    shards_dir.mkdir(parents=True, exist_ok=True)

    shard_entries: list[dict[str, Any]] = []
    warnings: list[str] = []
    languages: list[str] = []
    frameworks: list[str] = []
    project_name = root.name
    descriptions: list[str] = []
    latest_analyzed_at = ""
    latest_hash = ""
    total_nodes = 0
    total_edges = 0

    for path in sorted(shards_dir.glob("*.json")):
        graph, warning = _read_graph(path)
        if warning:
            warnings.append(warning)
        if graph is None:
            continue

        project = graph.get("project", {})
        shard_meta = graph.get("shard", {})
        shard_id = str(shard_meta.get("id") or path.stem)
        scopes = shard_meta.get("scopes")
        if not isinstance(scopes, list):
            scopes = []

        node_count = len(graph.get("nodes", []))
        edge_count = len(graph.get("edges", []))
        total_nodes += node_count
        total_edges += edge_count

        project_name = str(project.get("name") or project_name)
        languages.extend([x for x in project.get("languages", []) if isinstance(x, str)])
        frameworks.extend([x for x in project.get("frameworks", []) if isinstance(x, str)])
        desc = project.get("description")
        if isinstance(desc, str) and desc:
            descriptions.append(desc)
        analyzed_at = str(project.get("analyzedAt") or "")
        if analyzed_at > latest_analyzed_at:
            latest_analyzed_at = analyzed_at
            latest_hash = str(project.get("gitCommitHash") or latest_hash)

        shard_entries.append({
            "id": shard_id,
            "path": f"shards/{path.name}",
            "scopes": scopes,
            "nodeCount": node_count,
            "edgeCount": edge_count,
            "updatedAt": analyzed_at,
            "gitCommitHash": str(project.get("gitCommitHash") or ""),
        })

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    analyzed_at = latest_analyzed_at or now
    manifest = {
        "version": "1.0.0",
        "kind": "codebase-sharded",
        "project": {
            "name": project_name,
            "languages": _unique(languages),
            "frameworks": _unique(frameworks),
            "description": " | ".join(_unique(descriptions)) if descriptions else "Sharded knowledge graph",
            "analyzedAt": analyzed_at,
            "gitCommitHash": latest_hash,
        },
        "shards": shard_entries,
        "overview": {
            "summary": "Project split into user-managed analysis shards.",
            "nodeCount": total_nodes,
            "edgeCount": total_edges,
            "shardCount": len(shard_entries),
        },
        "warnings": warnings,
    }

    ua_dir.mkdir(parents=True, exist_ok=True)
    (ua_dir / "knowledge-graph.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python refresh-sharded-manifest.py <project-root>", file=sys.stderr)
        sys.exit(1)
    manifest = refresh_manifest(sys.argv[1])
    print(
        f"Refreshed sharded manifest: {manifest['overview']['shardCount']} shards, "
        f"{manifest['overview']['nodeCount']} nodes, {manifest['overview']['edgeCount']} edges",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run manifest tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py -v
```

Expected: both tests pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add understand-anything-plugin/skills/understand/refresh-sharded-manifest.py understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py
git commit -m "feat(understand): refresh sharded manifest"
```

---

### Task 3: Document `/understand --scope --shard` Flow

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Add argument hint and options**

Change the frontmatter `argument-hint` to:

```yaml
argument-hint: ["[path] [--full|--auto-update|--no-auto-update|--review|--language <lang>|--scope <paths>|--shard <id>]"]
```

Add these option bullets under `## Options`:

```markdown
  - `--scope <paths>` — Analyze only the comma-separated project-relative paths and produce a shard when paired with `--shard`.
  - `--shard <id>` — Save the scoped analysis to `.understand-anything/shards/<id>.json`. Requires `--scope`. The id may contain letters, numbers, `_`, and `-`.
```

- [ ] **Step 2: Add Phase 0 parsing rules**

After the project root resolution section, insert:

```markdown
1.1. **Scoped shard configuration:**
   - Parse `$ARGUMENTS` for `--scope <paths>` and `--shard <id>`.
   - If one is present without the other, report an error and **STOP**.
   - Split `--scope` by comma, trim whitespace, and reject empty entries.
   - Resolve each scope against `$PROJECT_ROOT`.
   - Reject scopes that do not exist.
   - Reject scopes whose resolved path is outside `$PROJECT_ROOT`.
   - Validate `--shard` with `^[A-Za-z0-9_-]+$`; reject any other value.
   - Store:
     - `SCOPED_SHARD_MODE=true`
     - `SHARD_ID=<id>`
     - `SCOPE_PATHS=<project-relative scope list>`
     - `SCOPE_ROOTS=<absolute scope root list>`
   - If no `--scope` is provided, set `SCOPED_SHARD_MODE=false` and continue with the existing full-project behavior.
```

- [ ] **Step 3: Update scan phase instructions**

In Phase 1, replace the scanner dispatch sentence with:

```markdown
Pass these parameters in the dispatch prompt:

> Scan this project directory to discover project files (including non-code files like configs, docs, infrastructure), detect languages and frameworks.
> Project root: `$PROJECT_ROOT`
> Scope mode: `$SCOPED_SHARD_MODE`
> Scope roots: `$SCOPE_ROOTS` (if scope mode is true, only include files under these roots; all returned paths must still be relative to `$PROJECT_ROOT`)
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`
```

- [ ] **Step 4: Update merge command**

In Phase 2, replace the merge command block with:

```markdown
If `SCOPED_SHARD_MODE=false`, run:

```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

If `SCOPED_SHARD_MODE=true`, run:

```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT --allow-external-edges
```
```

- [ ] **Step 5: Update assembled graph shape before review**

In Phase 6, after assembling the graph JSON object, add:

```markdown
If `SCOPED_SHARD_MODE=true`, also add shard metadata to the assembled graph before validation and save:

```json
"shard": {
  "id": "<SHARD_ID>",
  "scopes": ["<SCOPE_PATHS>"]
}
```

Shard metadata is not part of the core `KnowledgeGraph` type but is allowed as top-level metadata in shard files. Consumers that do not understand it should ignore it.
```

- [ ] **Step 6: Update save phase**

Replace Phase 7 step 1 with:

```markdown
1. Save output:
   - If `SCOPED_SHARD_MODE=false`, write the final knowledge graph to `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` as before.
   - If `SCOPED_SHARD_MODE=true`:
     1. Create `$PROJECT_ROOT/.understand-anything/shards`.
     2. Write the final shard graph to `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json`.
     3. Run:
        ```bash
        python <SKILL_DIR>/refresh-sharded-manifest.py $PROJECT_ROOT
        ```
     4. Report the shard path and root manifest path.
```

- [ ] **Step 7: Check the markdown for malformed fences**

Run:

```bash
python - <<'PY'
from pathlib import Path
p = Path("understand-anything-plugin/skills/understand/SKILL.md")
text = p.read_text()
assert text.count("```") % 2 == 0, "Unbalanced markdown code fences"
print("markdown fences balanced")
PY
```

Expected: `markdown fences balanced`.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "docs(understand): add scoped shard workflow"
```

---

### Task 4: Verification

**Files:**
- Verify only; no planned file edits.

- [ ] **Step 1: Run merge tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py -v
```

Expected: all tests pass.

- [ ] **Step 2: Run manifest tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py -v
```

Expected: all tests pass.

- [ ] **Step 3: Run TypeScript package tests if dependencies are available**

Run:

```bash
corepack pnpm --filter @understand-anything/core test
```

Expected: Vitest passes. If `node_modules` is missing in this worktree, run `corepack pnpm install` first or report that TypeScript tests were skipped because dependencies are absent.

- [ ] **Step 4: Final status check**

Run:

```bash
git status --short --branch
```

Expected: clean worktree on `codex/understand-scope-shards-design`.

---

## Self-Review

- Spec coverage: the plan covers no-scope compatibility, scoped shard output, external edge preservation, root sharded manifest, tests, and skill documentation.
- Placeholder scan: this plan contains no unfinished marker text or open-ended deferred implementation instructions.
- Type consistency: shard root manifest consistently uses `kind: "codebase-sharded"` and shard files remain `KnowledgeGraph` plus top-level `shard` metadata.
