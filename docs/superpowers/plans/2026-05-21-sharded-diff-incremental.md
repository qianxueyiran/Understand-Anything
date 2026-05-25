# Sharded Diff Incremental Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `/understand --update-diff` 增加普通图与 sharded 图统一入口：普通图复用现有 incremental，sharded 图一次性计算 diff 并对所有 affected shards 做文件级 incremental patch，domain/product 可通过 `--with-domain` / `--with-product` 跟随重建。

**Architecture:** Core 新增 sharded update helper，负责 manifest update metadata、artifact hash、affected shard 识别、旧 shard prune。`/understand` skill 调用这些 helper 并复用现有 `file-analyzer`、`merge-batch-graphs.py --allow-external-edges`、architecture/tour/review/save 阶段。Root manifest 自带 `update` 字段，fingerprints 仍独立放在 `.understand-anything/fingerprints/shards/<id>.json`。

**Tech Stack:** TypeScript strict mode, Vitest, Python unittest, existing `/understand` skill prompt flow, ESM modules, existing core fingerprint and graph types.

---

## File Structure

- Create: `understand-anything-plugin/packages/core/src/sharded-update.ts`
  - Owns `CodebaseShardedManifest`, manifest `update` metadata types, artifact hashing, affected shard detection, and old-shard prune helper.
- Modify: `understand-anything-plugin/packages/core/src/sharded-manifest.ts`
  - Add optional `update` metadata to domain/product manifest types and builders.
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
  - Re-export sharded update helpers.
- Test: `understand-anything-plugin/packages/core/src/__tests__/sharded-update.test.ts`
  - Covers affected shard detection, artifact hashes, baseline update metadata, and prune behavior.
- Modify: `understand-anything-plugin/packages/core/src/persistence/index.ts`
  - Add `saveShardFingerprints()` and `loadShardFingerprints()`.
- Test: `understand-anything-plugin/packages/core/src/persistence/persistence.test.ts`
  - Add shard fingerprint persistence tests.
- Modify: `understand-anything-plugin/skills/understand/refresh-sharded-manifest.py`
  - Preserve existing `knowledge-graph.json.update` when regenerating manifest.
- Modify: `understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py`
  - Add test proving `update` survives refresh.
- Modify: `understand-anything-plugin/packages/core/src/product-index-builder.ts`
  - Let product index source paths use shard-specific graph/domain paths.
- Modify: `understand-anything-plugin/src/product-index-cli.ts`
  - Pass shard-specific source paths into product index builder.
- Test: `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`
  - Add assertion that sharded product index sources point at `.understand-anything/shards/<id>.json`.
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`
  - Add `--update-diff`, sharded decision branch, per-shard fingerprint paths, and downstream flags.
- Modify: `understand-anything-plugin/hooks/auto-update-prompt.md`
  - Add `codebase-sharded` branch that is equivalent to `/understand --update-diff` for code shards only.
- Modify: `docs/superpowers/specs/2026-05-21-sharded-diff-incremental-design.md`
  - Keep aligned if implementation details change.

---

### Task 1: Core Manifest Update Metadata

**Files:**
- Create: `understand-anything-plugin/packages/core/src/sharded-update.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/sharded-update.test.ts`

- [ ] **Step 1: Write failing tests for manifest update metadata and hashing**

Create `understand-anything-plugin/packages/core/src/__tests__/sharded-update.test.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import {
  buildCodeManifestUpdate,
  hashArtifactFile,
  type CodebaseShardedManifest,
} from "../sharded-update.js";

const root = join(tmpdir(), "ua-sharded-update-test");

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sharded update manifest metadata", () => {
  it("computes deterministic artifact hashes with sha256 prefix", () => {
    mkdirSync(join(root, ".understand-anything", "shards"), { recursive: true });
    const path = join(root, ".understand-anything", "shards", "home.json");
    writeFileSync(path, JSON.stringify({ nodes: [], edges: [] }), "utf-8");

    const hash = hashArtifactFile(path);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashArtifactFile(path)).toBe(hash);
  });

  it("builds code manifest update metadata from existing shards", () => {
    mkdirSync(join(root, ".understand-anything", "shards"), { recursive: true });
    writeFileSync(
      join(root, ".understand-anything", "shards", "home.json"),
      JSON.stringify({ nodes: [{ id: "file:a_home/Home.kt" }], edges: [] }),
      "utf-8",
    );

    const manifest: CodebaseShardedManifest = {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 1, edgeCount: 0, shardCount: 1 },
      shards: [
        {
          id: "home",
          path: "shards/home.json",
          scopes: ["a_home"],
          nodeCount: 1,
          edgeCount: 0,
        },
      ],
      warnings: [],
    };

    const update = buildCodeManifestUpdate(root, manifest, "abc123");

    expect(update.gitCommitHash).toBe("abc123");
    expect(update.shards.home.fingerprintPath).toBe("fingerprints/shards/home.json");
    expect(update.shards.home.artifactHash).toMatch(/^sha256:/);
    expect(update.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-update.test.ts
```

Expected: FAIL because `../sharded-update.js` does not exist.

- [ ] **Step 3: Implement sharded update metadata helpers**

Create `understand-anything-plugin/packages/core/src/sharded-update.ts`:

```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CodebaseShardedManifestShard {
  id: string;
  path: string;
  scopes?: string[];
  updatedAt?: string;
  gitCommitHash?: string;
  nodeCount?: number;
  edgeCount?: number;
}

export interface ShardUpdateMetadata {
  artifactHash: string;
  fingerprintPath?: string;
  lastPatchedAt?: string;
  lastRebuiltAt?: string;
  traceArtifactHash?: string;
  sourceCodeArtifactHash?: string;
  sourceDomainArtifactHash?: string;
}

export interface ManifestUpdateMetadata {
  gitCommitHash?: string;
  updatedAt: string;
  shards: Record<string, ShardUpdateMetadata>;
  warnings: string[];
}

export interface CodebaseShardedManifest {
  version: string;
  kind: "codebase-sharded";
  project?: Record<string, unknown>;
  overview?: Record<string, unknown>;
  shards: CodebaseShardedManifestShard[];
  warnings?: string[];
  update?: ManifestUpdateMetadata;
}

export function hashArtifactFile(path: string): string {
  const content = readFileSync(path);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function buildCodeManifestUpdate(
  projectRoot: string,
  manifest: CodebaseShardedManifest,
  gitCommitHash: string,
  now = new Date().toISOString(),
): ManifestUpdateMetadata {
  const warnings: string[] = [];
  const shards: Record<string, ShardUpdateMetadata> = {};

  for (const shard of manifest.shards) {
    const shardPath = join(projectRoot, ".understand-anything", shard.path);
    if (!existsSync(shardPath)) {
      warnings.push(`${shard.path} is missing; update metadata skipped`);
      continue;
    }
    shards[shard.id] = {
      artifactHash: hashArtifactFile(shardPath),
      fingerprintPath: `fingerprints/shards/${shard.id}.json`,
      lastPatchedAt: now,
    };
  }

  return {
    gitCommitHash,
    updatedAt: now,
    shards,
    warnings,
  };
}

export function withCodeManifestUpdate(
  manifest: CodebaseShardedManifest,
  update: ManifestUpdateMetadata,
): CodebaseShardedManifest {
  return {
    ...manifest,
    update,
  };
}
```

Modify `understand-anything-plugin/packages/core/src/index.ts`:

```ts
export * from "./sharded-update.js";
```

- [ ] **Step 4: Run focused test**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-update.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add understand-anything-plugin/packages/core/src/sharded-update.ts understand-anything-plugin/packages/core/src/index.ts understand-anything-plugin/packages/core/src/__tests__/sharded-update.test.ts
git commit -m "feat(core): add sharded update metadata helpers"
```

---

### Task 2: Affected Shard Detection And Graph Prune

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/sharded-update.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/sharded-update.test.ts`

- [ ] **Step 1: Add failing tests for shard detection and prune behavior**

Append to `understand-anything-plugin/packages/core/src/__tests__/sharded-update.test.ts`:

```ts
import type { KnowledgeGraph } from "../types.js";
import {
  buildAffectedShardPlan,
  pruneGraphForChangedFiles,
} from "../sharded-update.js";

describe("affected shard detection", () => {
  const manifest: CodebaseShardedManifest = {
    version: "1.0.0",
    kind: "codebase-sharded",
    project: { name: "Demo" },
    overview: { summary: "Demo", nodeCount: 0, edgeCount: 0, shardCount: 2 },
    shards: [
      { id: "home", path: "shards/home.json", scopes: ["a_home"] },
      { id: "player", path: "shards/player.json", scopes: ["a_player"] },
    ],
    warnings: [],
  };

  it("maps changed files to shards by scope", () => {
    const plan = buildAffectedShardPlan({
      manifest,
      changedFiles: ["a_home/src/Home.kt", "README.md"],
      knownShardGraphs: {},
      sourceFileExtensions: [".kt"],
    });

    expect(plan.affectedCodeShards).toEqual([
      {
        id: "home",
        path: "shards/home.json",
        scopes: ["a_home"],
        changedFiles: ["a_home/src/Home.kt"],
        structuralFiles: [],
        cosmeticFiles: [],
        deletedFiles: [],
        reason: "changed file matched shard scope",
      },
    ]);
    expect(plan.warnings).toContain("README.md did not match any shard");
  });

  it("falls back to old shard node filePath for deleted files", () => {
    const oldHomeGraph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "Demo",
        languages: ["kotlin"],
        frameworks: ["android"],
        description: "Demo",
        analyzedAt: "2026-05-21T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      nodes: [
        {
          id: "file:legacy/Home.kt",
          type: "file",
          name: "Home.kt",
          filePath: "legacy/Home.kt",
          summary: "Old home file",
          tags: ["home"],
          complexity: "moderate",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    const plan = buildAffectedShardPlan({
      manifest: { ...manifest, shards: [{ id: "home", path: "shards/home.json", scopes: [] }] },
      changedFiles: ["legacy/Home.kt"],
      knownShardGraphs: { home: oldHomeGraph },
      sourceFileExtensions: [".kt"],
    });

    expect(plan.affectedCodeShards[0].id).toBe("home");
    expect(plan.affectedCodeShards[0].reason).toBe("changed file matched existing shard node");
  });
});

describe("shard graph prune", () => {
  it("removes old file/function/class nodes for changed files using existing incremental semantics", () => {
    const graph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "Demo",
        languages: ["ts"],
        frameworks: [],
        description: "Demo",
        analyzedAt: "2026-05-21T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "A", tags: ["a"], complexity: "simple" },
        { id: "function:src/a.ts:run", type: "function", name: "run", filePath: "src/a.ts", summary: "run", tags: ["fn"], complexity: "simple" },
        { id: "file:src/b.ts", type: "file", name: "b.ts", filePath: "src/b.ts", summary: "B", tags: ["b"], complexity: "simple" },
      ],
      edges: [
        { source: "file:src/a.ts", target: "function:src/a.ts:run", type: "contains", direction: "forward", weight: 1 },
        { source: "file:src/b.ts", target: "function:src/a.ts:run", type: "calls", direction: "forward", weight: 0.8 },
      ],
      layers: [],
      tour: [],
    };

    const pruned = pruneGraphForChangedFiles(graph, ["src/a.ts"], []);

    expect(pruned.nodes.map((node) => node.id)).toEqual(["file:src/b.ts"]);
    expect(pruned.edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-update.test.ts
```

Expected: FAIL because `buildAffectedShardPlan()` and `pruneGraphForChangedFiles()` do not exist.

- [ ] **Step 3: Implement detection and prune helpers**

Append to `understand-anything-plugin/packages/core/src/sharded-update.ts`:

```ts
import type { KnowledgeGraph } from "./types.js";

export interface AffectedShardPlanInput {
  manifest: CodebaseShardedManifest;
  changedFiles: string[];
  knownShardGraphs: Record<string, KnowledgeGraph>;
  sourceFileExtensions: string[];
}

export interface AffectedCodeShard {
  id: string;
  path: string;
  scopes: string[];
  changedFiles: string[];
  structuralFiles: string[];
  cosmeticFiles: string[];
  deletedFiles: string[];
  reason: string;
}

export interface ShardedUpdatePlan {
  changedFiles: string[];
  affectedCodeShards: AffectedCodeShard[];
  unmappedChangedFiles: string[];
  warnings: string[];
}

export function buildAffectedShardPlan(input: AffectedShardPlanInput): ShardedUpdatePlan {
  const affected = new Map<string, AffectedCodeShard>();
  const unmappedChangedFiles: string[] = [];
  const warnings: string[] = [];

  for (const filePath of input.changedFiles) {
    const matches = input.manifest.shards.filter((shard) =>
      (shard.scopes ?? []).some((scope) => filePath === scope || filePath.startsWith(`${scope}/`)),
    );

    const fallbackMatches =
      matches.length > 0
        ? []
        : input.manifest.shards.filter((shard) =>
            (input.knownShardGraphs[shard.id]?.nodes ?? []).some((node) => node.filePath === filePath),
          );

    const selected = matches.length > 0 ? matches : fallbackMatches;
    if (selected.length === 0) {
      if (input.sourceFileExtensions.some((ext) => filePath.endsWith(ext))) {
        unmappedChangedFiles.push(filePath);
      }
      warnings.push(`${filePath} did not match any shard`);
      continue;
    }

    for (const shard of selected) {
      const existing = affected.get(shard.id);
      const reason =
        matches.length > 0
          ? "changed file matched shard scope"
          : "changed file matched existing shard node";
      if (existing) {
        existing.changedFiles.push(filePath);
        continue;
      }
      affected.set(shard.id, {
        id: shard.id,
        path: shard.path,
        scopes: shard.scopes ?? [],
        changedFiles: [filePath],
        structuralFiles: [],
        cosmeticFiles: [],
        deletedFiles: [],
        reason,
      });
    }
  }

  return {
    changedFiles: input.changedFiles,
    affectedCodeShards: [...affected.values()],
    unmappedChangedFiles,
    warnings,
  };
}

export function pruneGraphForChangedFiles(
  graph: KnowledgeGraph,
  structuralFiles: string[],
  deletedFiles: string[],
): KnowledgeGraph {
  const changed = new Set([...structuralFiles, ...deletedFiles]);
  const removedNodeIds = new Set(
    graph.nodes
      .filter((node) => typeof node.filePath === "string" && changed.has(node.filePath))
      .map((node) => node.id),
  );

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !removedNodeIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
    ),
  };
}
```

- [ ] **Step 4: Run test**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-update.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add understand-anything-plugin/packages/core/src/sharded-update.ts understand-anything-plugin/packages/core/src/__tests__/sharded-update.test.ts
git commit -m "feat(core): plan sharded diff updates"
```

---

### Task 3: Shard Fingerprint Persistence

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/persistence/index.ts`
- Test: `understand-anything-plugin/packages/core/src/persistence/persistence.test.ts`

- [ ] **Step 1: Add failing persistence test**

Modify the existing import in `understand-anything-plugin/packages/core/src/persistence/persistence.test.ts` so it includes the shard fingerprint helpers:

```ts
import {
  saveGraph,
  loadGraph,
  saveMeta,
  loadMeta,
  saveFingerprints,
  loadFingerprints,
  saveShardFingerprints,
  loadShardFingerprints,
  saveConfig,
  loadConfig,
} from "./index.js";
```

Append this test inside the existing `describe("persistence", () => { ... })` block:

```ts
it("round-trips shard fingerprints by shard id", () => {
  const store = {
    version: "1.0.0" as const,
    gitCommitHash: "abc123",
    generatedAt: "2026-05-21T00:00:00.000Z",
    files: {
      "a_home/Home.kt": {
        filePath: "a_home/Home.kt",
        contentHash: "hash",
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        totalLines: 10,
        hasStructuralAnalysis: true,
      },
    },
  };

  saveShardFingerprints(tempDir, "home", store);

  expect(loadShardFingerprints(tempDir, "home")).toEqual(store);
  expect(loadShardFingerprints(tempDir, "../bad")).toBeNull();
});
```

- [ ] **Step 2: Run persistence test and verify it fails**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/persistence/persistence.test.ts
```

Expected: FAIL because `saveShardFingerprints` and `loadShardFingerprints` do not exist.

- [ ] **Step 3: Implement shard fingerprint persistence**

Modify `understand-anything-plugin/packages/core/src/persistence/index.ts`:

```ts
import { dirname } from "node:path";
```

Add near the fingerprint helpers:

```ts
const SHARD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function shardFingerprintFile(projectRoot: string, shardId: string): string | null {
  if (!SHARD_ID_PATTERN.test(shardId)) {
    return null;
  }
  return join(projectRoot, UA_DIR, "fingerprints", "shards", `${shardId}.json`);
}

export function saveShardFingerprints(
  projectRoot: string,
  shardId: string,
  store: FingerprintStore,
): void {
  const filePath = shardFingerprintFile(projectRoot, shardId);
  if (!filePath) {
    throw new Error(`Invalid shard id: ${shardId}`);
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

export function loadShardFingerprints(
  projectRoot: string,
  shardId: string,
): FingerprintStore | null {
  const filePath = shardFingerprintFile(projectRoot, shardId);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as FingerprintStore;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run persistence test**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/persistence/persistence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add understand-anything-plugin/packages/core/src/persistence/index.ts understand-anything-plugin/packages/core/src/persistence/persistence.test.ts
git commit -m "feat(core): persist shard fingerprints"
```

---

### Task 4: Preserve Manifest Update Metadata During Refresh

**Files:**
- Modify: `understand-anything-plugin/skills/understand/refresh-sharded-manifest.py`
- Test: `understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py`

- [ ] **Step 1: Add failing Python test**

Append inside `RefreshShardedManifestTests` in `understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py`:

```python
    def test_preserves_existing_update_metadata(self):
        refresh_manifest = load_refresh_manifest()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            understand_dir = root / ".understand-anything"
            shards_dir = understand_dir / "shards"
            shards_dir.mkdir(parents=True)

            self.write_json(
                understand_dir / "knowledge-graph.json",
                {
                    "kind": "codebase-sharded",
                    "version": "1.0.0",
                    "update": {
                        "gitCommitHash": "abc123",
                        "updatedAt": "2026-05-21T00:00:00.000Z",
                        "shards": {
                            "home": {
                                "artifactHash": "sha256:old",
                                "fingerprintPath": "fingerprints/shards/home.json",
                            }
                        },
                        "warnings": ["kept"],
                    },
                },
            )
            self.write_json(
                shards_dir / "home.json",
                {
                    "shard": {"id": "home", "scopes": ["a_home"]},
                    "project": {"name": "Demo"},
                    "nodes": [{"id": "file:a_home/Home.kt"}],
                    "edges": [],
                },
            )

            manifest = refresh_manifest(root)

            self.assertEqual(manifest["update"]["gitCommitHash"], "abc123")
            self.assertEqual(
                manifest["update"]["shards"]["home"]["fingerprintPath"],
                "fingerprints/shards/home.json",
            )
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
python understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py RefreshShardedManifestTests.test_preserves_existing_update_metadata -v
```

Expected: FAIL because `refresh_manifest()` drops `update`.

- [ ] **Step 3: Preserve update metadata**

Modify `understand-anything-plugin/skills/understand/refresh-sharded-manifest.py`.

Add before `manifest = { ... }`:

```python
    existing_manifest = _read_existing_manifest_update(ua_dir / "knowledge-graph.json")
```

Add `"update"` after `"warnings"` in the manifest:

```python
        "warnings": warnings,
        **({"update": existing_manifest} if existing_manifest is not None else {}),
```

Add helper:

```python
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
```

- [ ] **Step 4: Run refresh tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add understand-anything-plugin/skills/understand/refresh-sharded-manifest.py understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py
git commit -m "fix(understand): preserve sharded update metadata"
```

---

### Task 5: Product Shard Source Paths

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/product-index-builder.ts`
- Modify: `understand-anything-plugin/src/product-index-cli.ts`
- Test: `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`

- [ ] **Step 1: Add failing CLI assertion**

In `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`, update the existing test named `"finalizes a product shard and refreshes the root product manifest"`.

Before the first `await runProductIndexCli([... "--prepare-candidates" ...])`, create a matching domain shard:

```ts
writeJson(
  join(testRoot, ".understand-anything", "domain-shards", "home.json"),
  graph,
);
```

After the final `runProductIndexCli([... "--finalize" ...])`, read the generated product shard:

```ts
const productIndex = JSON.parse(
  readFileSync(
    join(testRoot, ".understand-anything", "product-shards", "home.json"),
    "utf-8",
  ),
) as {
  sources: {
    knowledgeGraph: { path: string };
    domainGraph?: { path: string };
  };
};
```

Then add these assertions:

```ts
expect(productIndex.sources.knowledgeGraph.path).toBe(
  ".understand-anything/shards/home.json",
);
expect(productIndex.sources.domainGraph?.path).toBe(
  ".understand-anything/domain-shards/home.json",
);
```

- [ ] **Step 2: Run the focused product CLI test**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts
```

Expected: FAIL because product source paths still point at `.understand-anything/knowledge-graph.json` / `.understand-anything/domain-graph.json`.

- [ ] **Step 3: Extend ProductProfileOptions with source paths**

Modify `understand-anything-plugin/packages/core/src/product-index-builder.ts`:

```ts
export interface ProductProfileOptions {
  platform: "android" | string;
  entryPatterns?: string[];
  analyzedAt?: string;
  maxDepth?: number;
  maxNodesPerTopic?: number;
  maxFrontierPerDepth?: number;
  maxEvidencePerTopic?: number;
  hubDegreeThreshold?: number;
  sourcePaths?: {
    knowledgeGraph: string;
    domainGraph?: string;
  };
}
```

In both `finalizeGroundedProductIndex()` and `buildDeterministicProductIndex()`, replace hardcoded source paths with:

```ts
const knowledgeGraphPath =
  options.sourcePaths?.knowledgeGraph ?? ".understand-anything/knowledge-graph.json";
const domainGraphPath =
  options.sourcePaths?.domainGraph ?? ".understand-anything/domain-graph.json";
```

Use `knowledgeGraphPath` in `sources.knowledgeGraph.path`, and `domainGraphPath` in `sources.domainGraph.path`.

- [ ] **Step 4: Pass shard source paths from CLI**

Modify `understand-anything-plugin/src/product-index-cli.ts` when building `builderOptions`:

```ts
    sourcePaths: options.shardId
      ? {
          knowledgeGraph: `.understand-anything/shards/${options.shardId}.json`,
          domainGraph: existsSync(
            join(
              options.projectRoot,
              ".understand-anything",
              "domain-shards",
              `${options.shardId}.json`,
            ),
          )
            ? `.understand-anything/domain-shards/${options.shardId}.json`
            : undefined,
        }
      : undefined,
```

- [ ] **Step 5: Run product tests**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add understand-anything-plugin/packages/core/src/product-index-builder.ts understand-anything-plugin/src/product-index-cli.ts understand-anything-plugin/src/__tests__/product-index-cli.test.ts
git commit -m "fix(product): record shard source paths"
```

---

### Task 6: Skill And Hook Documentation

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`
- Modify: `understand-anything-plugin/hooks/auto-update-prompt.md`
- Test: `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`

- [ ] **Step 1: Add failing docs test**

Create `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..", "..");

describe("understand sharded diff docs", () => {
  it("documents update-diff and sharded decision logic", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );

    expect(skill).toContain("--update-diff");
    expect(skill).toContain("codebase-sharded");
    expect(skill).toContain("sharded file-level incremental");
    expect(skill).toContain("--with-domain");
    expect(skill).toContain("--with-product");
  });

  it("documents the hook sharded branch", () => {
    const hookPrompt = readFileSync(
      join(pluginRoot, "hooks", "auto-update-prompt.md"),
      "utf-8",
    );

    expect(hookPrompt).toContain("codebase-sharded");
    expect(hookPrompt).toContain("/understand --update-diff");
    expect(hookPrompt).toContain("knowledge-graph.json.update");
  });
});
```

- [ ] **Step 2: Run docs test and verify it fails**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected: FAIL because docs do not yet contain the new sharded diff wording.

- [ ] **Step 3: Update `/understand` skill options**

Modify `understand-anything-plugin/skills/understand/SKILL.md` option list:

```markdown
  - `--update-diff` — Explicitly update an existing graph from git diff. For normal `knowledge-graph.json`, reuse the existing non-sharded incremental path. For `kind: "codebase-sharded"`, run sharded file-level incremental update across all affected shards.
  - `--with-domain` — Only valid with `--update-diff` on a sharded project. Rebuild matching domain shards whose code shard artifact changed.
  - `--with-product` — Only valid with `--update-diff` on a sharded project. Rebuild matching product shards whose code shard artifact changed.
```

Add to Phase 0 decision table:

```markdown
| `--update-diff` + existing graph `kind !== "codebase-sharded"` | Existing non-sharded incremental update path |
| `--update-diff` + existing graph `kind === "codebase-sharded"` | Sharded file-level incremental update. Compute one global git diff, map changed files to affected shards, patch every affected shard, refresh manifests, and advance `knowledge-graph.json.update.gitCommitHash` only after all requested work succeeds. |
```

Add a new subsection after the existing incremental path:

```markdown
### Sharded file-level incremental update path

This path applies only when `--update-diff` is present and root `knowledge-graph.json` has `kind: "codebase-sharded"`.

1. Read `knowledge-graph.json.update.gitCommitHash`; if missing, build baseline update metadata from existing `shards[]` and continue.
2. Run `git diff <lastCommitHash>..HEAD --name-only` once.
3. Map changed files to affected shards by `shards[].scopes`; fall back to each old shard graph's `nodes[*].filePath` for deleted or moved files.
4. For each affected shard, compare changed files against `.understand-anything/fingerprints/shards/<id>.json`.
5. For cosmetic-only shards, update fingerprint content hashes and skip LLM analysis.
6. For structural shards, analyze only structural files with `file-analyzer`.
7. Write pruned old shard nodes/edges to `batch-existing.json`, then run `merge-batch-graphs.py --allow-external-edges`.
8. Re-run architecture/tour for the patched shard and save `.understand-anything/shards/<id>.json`.
9. Refresh `knowledge-graph.json`, preserving its `update` field.
10. If `--with-domain` is present, rebuild matching domain shards only for code shards whose artifact hash changed.
11. If `--with-product` is present, rebuild matching product shards only for code shards whose artifact hash changed.
12. Advance `knowledge-graph.json.update.gitCommitHash` only after all requested code/domain/product work succeeds.
```

- [ ] **Step 4: Update hook prompt**

Modify `understand-anything-plugin/hooks/auto-update-prompt.md` near Phase 0:

```markdown
Before checking `meta.json`, read `.understand-anything/knowledge-graph.json` as raw JSON and inspect top-level `kind`.

If `kind === "codebase-sharded"`:
1. Treat the hook as equivalent to `/understand --update-diff`.
2. Read `knowledge-graph.json.update.gitCommitHash`; if missing, build baseline update metadata from existing shards.
3. Compute one global `git diff <lastCommitHash>..HEAD --name-only`.
4. Patch affected code shards using sharded file-level incremental update.
5. Do not rebuild domain/product by default. Only do so if future config fields `autoUpdateDomain` or `autoUpdateProduct` are explicitly true.
6. Save manifest `update` metadata and stop. Do not run the non-sharded `meta.json` / `fingerprints.json` path.
```

- [ ] **Step 5: Run docs test**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md understand-anything-plugin/hooks/auto-update-prompt.md understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts
git commit -m "docs(understand): add sharded diff update flow"
```

---

### Task 7: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run core targeted tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- src/__tests__/sharded-update.test.ts src/__tests__/sharded-manifest.test.ts src/persistence/persistence.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run skill targeted tests**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run Python manifest tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_refresh_sharded_manifest.py -v
```

Expected: PASS.

- [ ] **Step 4: Run broader package tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test
corepack pnpm --filter @understand-anything/skill test
```

Expected: PASS.

- [ ] **Step 5: Confirm final status**

Run:

```bash
git status --short
```

Expected: no untracked or modified implementation files remain after the task commits, except documentation files intentionally left uncommitted by request.
