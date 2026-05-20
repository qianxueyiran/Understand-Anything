# Domain Product Shards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sharded `/understand-domain` and `/understand-product` flows that derive one domain/product shard from one existing code shard and keep root domain/product outputs as lightweight manifests.

**Architecture:** Keep full-project behavior unchanged for non-sharded projects. For sharded projects, detect `kind: "codebase-sharded"` from raw JSON before calling existing graph/product loaders, operate only on `.understand-anything/shards/<id>.json`, and refresh root manifests by file names only. Put reusable manifest and shard-path logic in small helpers so skill prompts, CLI code, and tests share the same field names and path rules.

**Tech Stack:** TypeScript strict mode, Vitest, Python 3 unittest scripts for skill-side manifest refreshers, existing `@understand-anything/core` graph/product schemas and persistence helpers.

---

## File Structure

- Create: `understand-anything-plugin/packages/core/src/sharded-manifest.ts`
  - Owns `DomainShardedManifest`, `ProductShardedManifest`, shard id validation, raw JSON `kind` detection, and manifest builders that do not count shard contents.
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
  - Re-export sharded manifest helpers for Node skill/CLI consumers.
- Test: `understand-anything-plugin/packages/core/src/__tests__/sharded-manifest.test.ts`
  - Covers manifest building, no count fields, optional `sourceDomainShard`, and shard id validation.
- Create: `understand-anything-plugin/skills/understand-domain/refresh-domain-sharded-manifest.py`
  - Skill-side manifest refresher for `domain-graph.json`, scanning `domain-shards/*.json` file names only.
- Test: `understand-anything-plugin/skills/understand-domain/test_refresh_domain_sharded_manifest.py`
  - Python unittest for domain manifest output and malformed file-name behavior.
- Modify: `understand-anything-plugin/skills/understand-domain/SKILL.md`
  - Document and enforce `--shard <id>` / `--refresh-shards`, raw manifest detection, isolated intermediate output, and no dashboard launch in shard mode.
- Modify: `understand-anything-plugin/src/product-index-cli.ts`
  - Add `--shard <id>` and `--refresh-shards`, use shard-specific input/output/intermediate paths, and refresh `product-index.json` manifest.
- Test: `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`
  - Add product shard CLI coverage without disturbing existing full-project tests.
- Modify: `understand-anything-plugin/skills/understand-product/SKILL.md`
  - Document product shard strict pipeline, per-shard intermediate paths, and product manifest refresh behavior.
- Modify: `understand-anything-plugin/skills/understand-chat/SKILL.md`
  - Update consumption instructions for sharded manifests: use root manifest to find shard files and use `rg` across `shards/`, `domain-shards/`, and `product-shards/`.

## Task 1: Core Sharded Manifest Helpers

**Files:**
- Create: `understand-anything-plugin/packages/core/src/sharded-manifest.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/sharded-manifest.test.ts`

- [ ] **Step 1: Write failing tests**

Create `understand-anything-plugin/packages/core/src/__tests__/sharded-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildDomainShardedManifest,
  buildProductShardedManifest,
  getTopLevelKind,
  isValidShardId,
  validateShardId,
} from "../sharded-manifest.js";

describe("sharded manifest helpers", () => {
  it("validates shard ids with the same rule as /understand --shard", () => {
    expect(isValidShardId("home")).toBe(true);
    expect(isValidShardId("a_home-api2")).toBe(true);
    expect(isValidShardId("../home")).toBe(false);
    expect(isValidShardId("home/api")).toBe(false);
    expect(() => validateShardId("../home")).toThrow(/Invalid shard id/);
  });

  it("builds a domain manifest without count or lifecycle fields", () => {
    const manifest = buildDomainShardedManifest(["home.json", "player.json"]);
    expect(manifest.kind).toBe("domain-sharded");
    expect(manifest.source.codeManifest).toBe("knowledge-graph.json");
    expect(manifest.shards).toEqual([
      {
        id: "home",
        path: "domain-shards/home.json",
        sourceCodeShard: "shards/home.json",
      },
      {
        id: "player",
        path: "domain-shards/player.json",
        sourceCodeShard: "shards/player.json",
      },
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/nodeCount|edgeCount|analyzedAt|gitCommitHash|updatedAt/);
  });

  it("builds a product manifest and omits missing domain shard references", () => {
    const manifest = buildProductShardedManifest({
      productShardFiles: ["home.json", "player.json"],
      domainShardFiles: ["home.json"],
      traceFiles: ["home.json"],
    });
    expect(manifest.kind).toBe("product-sharded");
    expect(manifest.shards[0]).toEqual({
      id: "home",
      path: "product-shards/home.json",
      tracePath: "product-traces/home.json",
      sourceCodeShard: "shards/home.json",
      sourceDomainShard: "domain-shards/home.json",
    });
    expect(manifest.shards[1]).toEqual({
      id: "player",
      path: "product-shards/player.json",
      sourceCodeShard: "shards/player.json",
    });
    expect(manifest.warnings).toContain("product-shards/player.json has no matching product-traces/player.json");
    expect(JSON.stringify(manifest)).not.toMatch(/topicCount|factCount|evidenceCount|signalsCount|contextPacksCount/);
  });

  it("reads only top-level kind from raw JSON-like values", () => {
    expect(getTopLevelKind({ kind: "codebase-sharded", nodes: [] })).toBe("codebase-sharded");
    expect(getTopLevelKind({ kind: 12 })).toBeUndefined();
    expect(getTopLevelKind(null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-manifest.test.ts
```

Expected: FAIL because `../sharded-manifest.js` does not exist.

- [ ] **Step 3: Add helper implementation**

Create `understand-anything-plugin/packages/core/src/sharded-manifest.ts`:

```ts
export interface DomainShardedManifest {
  version: string;
  kind: "domain-sharded";
  source: { codeManifest: string };
  shards: Array<{
    id: string;
    path: string;
    sourceCodeShard: string;
  }>;
  warnings: string[];
}

export interface ProductShardedManifest {
  version: string;
  kind: "product-sharded";
  source: { codeManifest: string; domainManifest?: string };
  shards: Array<{
    id: string;
    path: string;
    tracePath?: string;
    sourceCodeShard: string;
    sourceDomainShard?: string;
  }>;
  warnings: string[];
}

export const SHARD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidShardId(value: string): boolean {
  return SHARD_ID_PATTERN.test(value);
}

export function validateShardId(value: string): string {
  if (!isValidShardId(value)) {
    throw new Error(
      `Invalid shard id: ${value}. Use only letters, numbers, underscores, and hyphens.`,
    );
  }
  return value;
}

export function getTopLevelKind(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

export function buildDomainShardedManifest(
  domainShardFiles: string[],
): DomainShardedManifest {
  const shards = domainShardFiles
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter(isValidShardId)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      path: `domain-shards/${id}.json`,
      sourceCodeShard: `shards/${id}.json`,
    }));

  return {
    version: "1.0.0",
    kind: "domain-sharded",
    source: { codeManifest: "knowledge-graph.json" },
    shards,
    warnings: [],
  };
}

export function buildProductShardedManifest(input: {
  productShardFiles: string[];
  domainShardFiles?: string[];
  traceFiles?: string[];
}): ProductShardedManifest {
  const domainIds = new Set(fileNamesToShardIds(input.domainShardFiles ?? []));
  const traceIds = new Set(fileNamesToShardIds(input.traceFiles ?? []));
  const warnings: string[] = [];
  const shards = fileNamesToShardIds(input.productShardFiles)
    .map((id) => {
      const shard: ProductShardedManifest["shards"][number] = {
        id,
        path: `product-shards/${id}.json`,
        sourceCodeShard: `shards/${id}.json`,
      };
      if (traceIds.has(id)) {
        shard.tracePath = `product-traces/${id}.json`;
      } else {
        warnings.push(`product-shards/${id}.json has no matching product-traces/${id}.json`);
      }
      if (domainIds.has(id)) {
        shard.sourceDomainShard = `domain-shards/${id}.json`;
      }
      return shard;
    });

  return {
    version: "1.0.0",
    kind: "product-sharded",
    source: { codeManifest: "knowledge-graph.json", domainManifest: "domain-graph.json" },
    shards,
    warnings,
  };
}

function fileNamesToShardIds(files: string[]): string[] {
  return files
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter(isValidShardId)
    .sort((a, b) => a.localeCompare(b));
}
```

Modify `understand-anything-plugin/packages/core/src/index.ts`:

```ts
export * from "./sharded-manifest.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-manifest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/sharded-manifest.ts understand-anything-plugin/packages/core/src/index.ts understand-anything-plugin/packages/core/src/__tests__/sharded-manifest.test.ts
git commit -m "feat(core): add sharded manifest helpers"
```

## Task 2: Domain Manifest Refresh Script and Skill Prompt

**Files:**
- Create: `understand-anything-plugin/skills/understand-domain/refresh-domain-sharded-manifest.py`
- Create: `understand-anything-plugin/skills/understand-domain/test_refresh_domain_sharded_manifest.py`
- Modify: `understand-anything-plugin/skills/understand-domain/SKILL.md`

- [ ] **Step 1: Write failing Python tests**

Create `understand-anything-plugin/skills/understand-domain/test_refresh_domain_sharded_manifest.py`:

```py
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("refresh-domain-sharded-manifest.py")


def load_refresh_manifest():
    spec = importlib.util.spec_from_file_location("refresh_domain_sharded_manifest", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.refresh_manifest


class RefreshDomainShardedManifestTests(unittest.TestCase):
    def test_builds_manifest_from_file_names_only(self):
        refresh_manifest = load_refresh_manifest()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            domain_shards_dir = root / ".understand-anything" / "domain-shards"
            domain_shards_dir.mkdir(parents=True)
            (domain_shards_dir / "home.json").write_text("{not json", encoding="utf-8")
            (domain_shards_dir / "player.json").write_text("[]", encoding="utf-8")

            manifest = refresh_manifest(root)

            self.assertEqual(manifest["kind"], "domain-sharded")
            self.assertEqual(manifest["source"], {"codeManifest": "knowledge-graph.json"})
            self.assertEqual(
                manifest["shards"],
                [
                    {
                        "id": "home",
                        "path": "domain-shards/home.json",
                        "sourceCodeShard": "shards/home.json",
                    },
                    {
                        "id": "player",
                        "path": "domain-shards/player.json",
                        "sourceCodeShard": "shards/player.json",
                    },
                ],
            )
            self.assertNotIn("nodeCount", json.dumps(manifest))
            self.assertEqual(
                json.loads((root / ".understand-anything" / "domain-graph.json").read_text())["kind"],
                "domain-sharded",
            )

    def test_skips_unsafe_file_names(self):
        refresh_manifest = load_refresh_manifest()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            domain_shards_dir = root / ".understand-anything" / "domain-shards"
            domain_shards_dir.mkdir(parents=True)
            (domain_shards_dir / "valid.json").write_text("{}", encoding="utf-8")
            (domain_shards_dir / "bad.name.json").write_text("{}", encoding="utf-8")

            manifest = refresh_manifest(root)

            self.assertEqual([shard["id"] for shard in manifest["shards"]], ["valid"])
            self.assertTrue(any("bad.name.json" in warning for warning in manifest["warnings"]))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python3 understand-anything-plugin/skills/understand-domain/test_refresh_domain_sharded_manifest.py -v
```

Expected: FAIL because `refresh-domain-sharded-manifest.py` does not exist.

- [ ] **Step 3: Add refresh script**

Create `understand-anything-plugin/skills/understand-domain/refresh-domain-sharded-manifest.py`:

```py
#!/usr/bin/env python3
"""Refresh the lightweight manifest for sharded domain graphs."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


SHARD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def refresh_manifest(project_root: str | Path) -> dict[str, Any]:
    root = Path(project_root)
    ua_dir = root / ".understand-anything"
    domain_shards_dir = ua_dir / "domain-shards"
    warnings: list[str] = []
    shards: list[dict[str, str]] = []

    for shard_path in sorted(domain_shards_dir.glob("*.json")):
        shard_id = shard_path.stem
        if not SHARD_ID_PATTERN.fullmatch(shard_id):
            warnings.append(f"Skipped {shard_path.name}: invalid shard id")
            continue
        shards.append(
            {
                "id": shard_id,
                "path": f"domain-shards/{shard_path.name}",
                "sourceCodeShard": f"shards/{shard_path.name}",
            }
        )

    manifest = {
        "version": "1.0.0",
        "kind": "domain-sharded",
        "source": {"codeManifest": "knowledge-graph.json"},
        "shards": shards,
        "warnings": warnings,
    }

    ua_dir.mkdir(parents=True, exist_ok=True)
    (ua_dir / "domain-graph.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return manifest


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: refresh-domain-sharded-manifest.py <project-root>", file=sys.stderr)
        return 2
    manifest = refresh_manifest(argv[1])
    print(
        f"Refreshed domain sharded manifest: {len(manifest['shards'])} shards, {len(manifest['warnings'])} warnings",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
```

- [ ] **Step 4: Update `/understand-domain` prompt**

Modify `understand-anything-plugin/skills/understand-domain/SKILL.md` to add argument support near the front matter:

```md
argument-hint: [--full] [--shard <id>] [--refresh-shards]
```

Add a new section after Phase 0:

````md
### Phase 0.5: Parse Shard Mode

Recognize:

- `--shard <id>`: derive exactly one domain shard from `.understand-anything/shards/<id>.json`.
- `--refresh-shards`: rebuild `.understand-anything/domain-graph.json` from `.understand-anything/domain-shards/*.json` file names only.

Validate shard id with `^[A-Za-z0-9_-]+$`. If validation fails, stop with: `Error: invalid shard id. Use only letters, numbers, underscores, and hyphens.`

For `--refresh-shards`, run:

```bash
python "$PLUGIN_ROOT/skills/understand-domain/refresh-domain-sharded-manifest.py" "$PROJECT_ROOT"
```

Then stop. Do not run LLM analysis and do not read domain shard contents.
````

Update Phase 1 and Phase 3 text so shard mode first reads raw JSON from `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`, checks `kind`, and only reads `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json` when `kind` is `codebase-sharded`. Add the exact shard outputs:

```md
In shard mode:

- Read only `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json` as the graph context.
- The domain analyzer writes to `$PROJECT_ROOT/.understand-anything/intermediate/domain-shards/$SHARD_ID/domain-analysis.json`.
- Save the final graph to `$PROJECT_ROOT/.understand-anything/domain-shards/$SHARD_ID.json`.
- Refresh the root manifest with `refresh-domain-sharded-manifest.py`.
- Do not auto-launch `/understand-dashboard`.
```

- [ ] **Step 5: Run tests and prompt docs check**

Run:

```bash
python3 understand-anything-plugin/skills/understand-domain/test_refresh_domain_sharded_manifest.py -v
rg -n -- "--shard|--refresh-shards|domain-shards|refresh-domain-sharded-manifest" understand-anything-plugin/skills/understand-domain/SKILL.md
```

Expected: Python tests PASS and `rg` shows the new shard instructions.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/refresh-domain-sharded-manifest.py understand-anything-plugin/skills/understand-domain/test_refresh_domain_sharded_manifest.py understand-anything-plugin/skills/understand-domain/SKILL.md
git commit -m "feat(domain): document sharded domain outputs"
```

## Task 3: Product CLI Shard Paths and Product Manifest

**Files:**
- Modify: `understand-anything-plugin/src/product-index-cli.ts`
- Modify: `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`

- [ ] **Step 1: Write failing tests**

Add these tests to `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`:

```ts
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

it("prepares product candidates from a single code shard", async () => {
  writeJson(join(testRoot, ".understand-anything", "knowledge-graph.json"), {
    version: "1.0.0",
    kind: "codebase-sharded",
    source: {},
    shards: [{ id: "home", path: "shards/home.json", sourceCodeShard: "shards/home.json" }],
    warnings: [],
  });
  mkdirSync(join(testRoot, ".understand-anything", "shards"), { recursive: true });
  writeJson(join(testRoot, ".understand-anything", "shards", "home.json"), graph);

  const result = await runProductIndexCli([
    testRoot,
    "--platform",
    "android",
    "--prepare-candidates",
    "--shard",
    "home",
  ]);

  expect(result.productIndexPath.endsWith("product-shards/home.json")).toBe(true);
  expect(
    existsSync(
      join(
        testRoot,
        ".understand-anything",
        "intermediate",
        "product-shards",
        "home",
        "product-boundary-candidates.json",
      ),
    ),
  ).toBe(true);
  expect(existsSync(join(testRoot, ".understand-anything", "product-index.json"))).toBe(false);
});

it("rejects invalid product shard ids", async () => {
  await expect(
    runProductIndexCli([testRoot, "--prepare-candidates", "--shard", "../home"]),
  ).rejects.toThrow(/Invalid shard id/);
});

it("refreshes product manifest from file names without reading shard contents", async () => {
  mkdirSync(join(testRoot, ".understand-anything", "product-shards"), { recursive: true });
  mkdirSync(join(testRoot, ".understand-anything", "product-traces"), { recursive: true });
  mkdirSync(join(testRoot, ".understand-anything", "domain-shards"), { recursive: true });
  writeFileSync(join(testRoot, ".understand-anything", "product-shards", "home.json"), "{not json", "utf-8");
  writeFileSync(join(testRoot, ".understand-anything", "product-traces", "home.json"), "[]", "utf-8");
  writeFileSync(join(testRoot, ".understand-anything", "domain-shards", "home.json"), "{}", "utf-8");

  await runProductIndexCli([testRoot, "--refresh-shards"]);

  const manifest = JSON.parse(
    readFileSync(join(testRoot, ".understand-anything", "product-index.json"), "utf-8"),
  );
  expect(manifest.kind).toBe("product-sharded");
  expect(manifest.shards).toEqual([
    {
      id: "home",
      path: "product-shards/home.json",
      tracePath: "product-traces/home.json",
      sourceCodeShard: "shards/home.json",
      sourceDomainShard: "domain-shards/home.json",
    },
  ]);
  expect(JSON.stringify(manifest)).not.toMatch(/topicCount|factCount|evidenceCount/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts
```

Expected: FAIL because `--shard` and `--refresh-shards` are unknown.

- [ ] **Step 3: Extend parsed args**

Modify `ParsedArgs`, `VALUE_FLAGS`, `BOOLEAN_FLAGS`, and `parseArgs()` in `understand-anything-plugin/src/product-index-cli.ts`:

```ts
interface ParsedArgs {
  projectRoot: string;
  platform: string;
  stage?: "prepare-candidates" | "build-context-packs" | "finalize";
  shardId?: string;
  refreshShards: boolean;
  entryPatterns?: string[];
  maxDepth: number;
  maxNodesPerTopic: number;
  maxFrontierPerDepth: number;
  maxEvidencePerTopic: number;
  hubDegreeThreshold: number;
}

const VALUE_FLAGS = new Set([
  "--platform",
  "--entry-patterns",
  "--max-depth",
  "--max-nodes-per-topic",
  "--max-frontier-per-depth",
  "--max-evidence-per-topic",
  "--hub-degree-threshold",
  "--shard",
]);

const BOOLEAN_FLAGS = new Set([
  "--prepare",
  "--prepare-candidates",
  "--build-context-packs",
  "--finalize",
  "--refresh-shards",
]);
```

After `const stage = parseStage(booleans);`, add:

```ts
const refreshShards = booleans.has("--refresh-shards");
const shardId = values.get("--shard");
if (shardId && !/^[A-Za-z0-9_-]+$/.test(shardId)) {
  throw new Error(`Invalid shard id: ${shardId}. Use only letters, numbers, underscores, and hyphens.`);
}
if (refreshShards && stage) {
  throw new Error("Choose either --refresh-shards or one product-index stage.");
}
if (!refreshShards && !stage) {
  throw new Error(
    "Please run through /understand-product or specify one stage: --prepare-candidates | --build-context-packs | --finalize",
  );
}
```

Return `stage`, `shardId`, and `refreshShards`.

- [ ] **Step 4: Add shard path helpers and raw graph loading**

Add helper code below `getProductIndexPath()`:

```ts
function getProductIndexPath(projectRoot: string, shardId?: string): string {
  return shardId
    ? join(projectRoot, ".understand-anything", "product-shards", `${shardId}.json`)
    : join(projectRoot, ".understand-anything", "product-index.json");
}

function getProductTracePath(projectRoot: string, shardId?: string): string {
  return shardId
    ? join(projectRoot, ".understand-anything", "product-traces", `${shardId}.json`)
    : join(projectRoot, ".understand-anything", "product-index-trace.json");
}

function getIntermediateDir(projectRoot: string, shardId?: string): string {
  return shardId
    ? join(projectRoot, ".understand-anything", "intermediate", "product-shards", shardId)
    : join(projectRoot, ".understand-anything", "intermediate");
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function isShardedRoot(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "codebase-sharded");
}
```

Replace initial root graph loading with logic equivalent to:

```ts
const rootGraphData = loadJson(graphPath);
if (options.shardId) {
  if (!isShardedRoot(rootGraphData)) {
    throw new Error("当前项目不是 sharded code graph。");
  }
  const shardGraphPath = join(options.projectRoot, ".understand-anything", "shards", `${options.shardId}.json`);
  if (!existsSync(shardGraphPath)) {
    throw new Error(`${shardGraphPath}: shard not found. 请先运行 /understand --scope ... --shard ${options.shardId}`);
  }
  const loadedGraph = loadJson(shardGraphPath) as KnowledgeGraph;
  const domainPath = join(options.projectRoot, ".understand-anything", "domain-shards", `${options.shardId}.json`);
  const loadedDomainGraph = existsSync(domainPath) ? (loadJson(domainPath) as KnowledgeGraph) : undefined;
}
```

Keep the non-shard branch using existing `loadGraph()` and `loadDomainGraph()`.

- [ ] **Step 5: Route product outputs through shard paths**

Change these existing path assignments to use helpers:

```ts
const signalsPath = options.shardId
  ? join(options.projectRoot, ".understand-anything", "product-shards", `${options.shardId}.signals.jsonl`)
  : join(options.projectRoot, ".understand-anything", "product-signals.jsonl");
const intermediateDir = getIntermediateDir(options.projectRoot, options.shardId);
```

Update every returned `productIndexPath` to:

```ts
productIndexPath: getProductIndexPath(options.projectRoot, options.shardId),
```

In finalize, replace `saveProductIndex(options.projectRoot, index)` with shard-aware write:

```ts
if (options.shardId) {
  mkdirSync(join(options.projectRoot, ".understand-anything", "product-shards"), { recursive: true });
  writeJson(getProductIndexPath(options.projectRoot, options.shardId), index);
} else {
  saveProductIndex(options.projectRoot, index);
}
```

Update `writeProductIndexTrace()` to accept `shardId?: string` and call `getProductTracePath(projectRoot, shardId)`.

- [ ] **Step 6: Implement `--refresh-shards`**

At the top of `runProductIndexCli()` after checking `.understand-anything/knowledge-graph.json`, add:

```ts
if (options.refreshShards) {
  const manifest = buildProductManifestFromFiles(options.projectRoot);
  mkdirSync(join(options.projectRoot, ".understand-anything"), { recursive: true });
  writeJson(join(options.projectRoot, ".understand-anything", "product-index.json"), manifest);
  return {
    projectRoot: options.projectRoot,
    productIndexPath: getProductIndexPath(options.projectRoot),
    topics: 0,
    facts: 0,
    evidence: 0,
    signals: 0,
    contextPacks: 0,
  };
}
```

Add helper:

```ts
function buildProductManifestFromFiles(projectRoot: string): {
  version: string;
  kind: "product-sharded";
  source: { codeManifest: string; domainManifest: string };
  shards: Array<{
    id: string;
    path: string;
    tracePath?: string;
    sourceCodeShard: string;
    sourceDomainShard?: string;
  }>;
  warnings: string[];
} {
  const uaDir = join(projectRoot, ".understand-anything");
  const productFiles = listJsonFileNames(join(uaDir, "product-shards"));
  const traceIds = new Set(listJsonFileNames(join(uaDir, "product-traces")).map(stripJsonExt));
  const domainIds = new Set(listJsonFileNames(join(uaDir, "domain-shards")).map(stripJsonExt));
  const warnings: string[] = [];
  const shards = productFiles.map(stripJsonExt).filter(isValidShardId).map((id) => {
    const shard = {
      id,
      path: `product-shards/${id}.json`,
      sourceCodeShard: `shards/${id}.json`,
    } as {
      id: string;
      path: string;
      tracePath?: string;
      sourceCodeShard: string;
      sourceDomainShard?: string;
    };
    if (traceIds.has(id)) {
      shard.tracePath = `product-traces/${id}.json`;
    } else {
      warnings.push(`product-shards/${id}.json has no matching product-traces/${id}.json`);
    }
    if (domainIds.has(id)) {
      shard.sourceDomainShard = `domain-shards/${id}.json`;
    }
    return shard;
  });
  return {
    version: "1.0.0",
    kind: "product-sharded",
    source: { codeManifest: "knowledge-graph.json", domainManifest: "domain-graph.json" },
    shards,
    warnings,
  };
}

function listJsonFileNames(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b));
}

function stripJsonExt(fileName: string): string {
  return fileName.slice(0, -".json".length);
}

function isValidShardId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
```

- [ ] **Step 7: Run product CLI tests**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add understand-anything-plugin/src/product-index-cli.ts understand-anything-plugin/src/__tests__/product-index-cli.test.ts
git commit -m "feat(product): support sharded product pipeline paths"
```

## Task 4: Product Skill Prompt Shard Flow

**Files:**
- Modify: `understand-anything-plugin/skills/understand-product/SKILL.md`
- Modify: `understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts`

- [ ] **Step 1: Write failing docs test**

Add assertions to `understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts`:

```ts
expect(skill).toContain("--shard <id>");
expect(skill).toContain("--refresh-shards");
expect(skill).toContain("product-shards/<id>.json");
expect(skill).toContain("intermediate/product-shards/<id>");
expect(skill).toContain("product-traces/<id>.json");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-strict-docs.test.ts
```

Expected: FAIL because the skill prompt does not document shard mode.

- [ ] **Step 3: Update product skill prompt**

Modify front matter:

```md
argument-hint: [--platform android] [--entry-patterns <patterns>] [--shard <id>] [--refresh-shards]
```

Add after Phase 0:

````md
## Phase 0.5: 分片模式

支持：

- `--shard <id>`：只基于 `.understand-anything/shards/<id>.json` 生成一个 product shard。
- `--refresh-shards`：只刷新 `.understand-anything/product-index.json` manifest，不运行 LLM。

Shard id 必须匹配 `^[A-Za-z0-9_-]+$`。分片项目无参数时，不默认加载所有 shards，应提示用户使用 `--shard <id>` 或 `--refresh-shards`。

`--refresh-shards` 直接运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --refresh-shards
```

然后停止。
````

Update each CLI command example to keep `$ARGUMENTS`, which now includes `--shard <id>`:

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --prepare-candidates $ARGUMENTS
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --build-context-packs $ARGUMENTS
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --finalize $ARGUMENTS
```

Add shard-mode path notes:

````md
在 `--shard <id>` 模式下，阶段文件位于：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-index-extractions-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/product-shards/<id>.json
$PROJECT_ROOT/.understand-anything/product-traces/<id>.json
```

完成 `--finalize --shard <id>` 后，再运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --refresh-shards
```
````

- [ ] **Step 4: Run docs test**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-strict-docs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-product/SKILL.md understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts
git commit -m "docs(product): add sharded product workflow"
```

## Task 5: Chat Consumption Instructions for Sharded Artifacts

**Files:**
- Modify: `understand-anything-plugin/skills/understand-chat/SKILL.md`

- [ ] **Step 1: Add sharded consumption instructions**

Modify `understand-anything-plugin/skills/understand-chat/SKILL.md` instruction `0` and graph reading steps to include:

```md
0. 如果 `.understand-anything/product-index.json` 的顶层 `kind` 是 `product-sharded`，不要按完整 product index 读取。先读取 manifest 的 `shards[].path`，再用 `rg` 在 `.understand-anything/product-shards/` 中搜索用户问题关键词。命中后只读取相关 shard。

0a. 如果 `.understand-anything/domain-graph.json` 的顶层 `kind` 是 `domain-sharded`，不要按完整 domain graph 读取。用 `rg` 在 `.understand-anything/domain-shards/` 中搜索 domain/topic/flow 关键词。

0b. 如果 `.understand-anything/knowledge-graph.json` 的顶层 `kind` 是 `codebase-sharded`，不要读取整个 root manifest 当成 graph。用 `rg` 在 `.understand-anything/shards/` 中按 `nodeId`、`filePath`、类名、方法名搜索。边的 `source` / `target` 保持原始地址，跨 shard 反查也通过 `rg` 完成。
```

- [ ] **Step 2: Verify prompt text**

Run:

```bash
rg -n "product-sharded|domain-sharded|codebase-sharded|product-shards|domain-shards|\\.understand-anything/shards" understand-anything-plugin/skills/understand-chat/SKILL.md
```

Expected: output includes all three sharded manifest kinds and all three shard directories.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-chat/SKILL.md
git commit -m "docs(chat): describe sharded artifact lookup"
```

## Task 6: Full Verification

**Files:**
- No source files; verification only.

- [ ] **Step 1: Run Python skill tests**

```bash
python3 understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py -v
python3 understand-anything-plugin/skills/understand-domain/test_refresh_domain_sharded_manifest.py -v
python3 -m py_compile understand-anything-plugin/skills/understand/refresh-sharded-manifest.py understand-anything-plugin/skills/understand-domain/refresh-domain-sharded-manifest.py
```

Expected: all tests pass and py_compile exits 0.

- [ ] **Step 2: Run focused TypeScript tests**

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-manifest.test.ts
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts src/__tests__/product-index-strict-docs.test.ts
```

Expected: focused tests pass.

- [ ] **Step 3: Run broader package tests**

```bash
corepack pnpm --filter @understand-anything/core test
corepack pnpm --filter @understand-anything/skill test
```

Expected: existing and new tests pass.

- [ ] **Step 4: Check markdown and whitespace**

```bash
python3 -c 'from pathlib import Path; paths=[Path("docs/superpowers/specs/2026-05-21-domain-product-shards-design.md"), Path("docs/superpowers/plans/2026-05-21-domain-product-shards.md")]; [print(path, path.read_text().count("```")) for path in paths]; assert all(path.read_text().count("```") % 2 == 0 for path in paths)'
git diff --check
```

Expected: code fence counts are even and `git diff --check` exits 0.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required any source or doc fix:

```bash
git add <changed-files>
git commit -m "fix: stabilize domain product shard workflow"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: tasks cover domain root manifest, product root manifest, no count fields, shard id validation, raw JSON sharded detection, isolated domain/product intermediate directories, optional product domain shard references, non-sharded compatibility, and chat/search consumption changes.
- 占位词扫描：没有未明确的实现槽位会阻塞执行者开始工作。
- Type consistency: manifest names are consistently `domain-sharded` and `product-sharded`; code shard root remains `codebase-sharded`; shard id validation uses `^[A-Za-z0-9_-]+$` throughout.
