# Sharded Incremental Simplified Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor sharded `--update-diff` from a long chain of fragile finalize commands into a three-stage workflow: `plan`, `assemble-shard`, and `commit`.

**Architecture:** Keep `/understand --update-diff` as the user-facing entry point. Use file-level diff/fingerprint classification to limit LLM input to changed structural files, but make shard writes and manifest advancement script-controlled transactions. Every intermediate artifact must carry `runId`, `headCommitHash`, and `shardId` so stale files cannot be accepted.

**Tech Stack:** Node.js ESM scripts, TypeScript/Vitest tests, Python `merge-batch-graphs.py`, existing Understand Anything agents (`file-analyzer`, `architecture-analyzer`, `tour-builder`), pnpm workspaces.

---

## File Structure

- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`
  - Add the new `plan`, `assemble-shard`, and `commit` commands.
  - Keep old commands as compatibility aliases until the end of the plan.
  - Own run records, candidate validation, stale artifact rejection, and manifest commit semantics.

- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
  - Add new three-stage workflow tests.
  - Keep current tests passing while new commands are introduced.
  - Convert old-command tests after the new flow is green.

- Modify: `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`
  - Assert `/understand` docs reference the new three-stage workflow and the internal workflow document.

- Modify: `understand-anything-plugin/skills/understand/SKILL.md`
  - Thin the sharded `--update-diff` section so it delegates detailed rules to `update-diff-workflow.md`.
  - Keep only entry decision logic and high-level agent dispatch responsibilities.

- Create: `understand-anything-plugin/skills/understand/update-diff-workflow.md`
  - Internal workflow contract for sharded and non-sharded update branching.
  - Detailed sharded state-machine rules for plan/assemble/commit.

- Optionally modify: `understand-anything-plugin/packages/core/src/sharded-update.ts`
  - Only if script logic can safely reuse typed pure helpers without broad refactoring.

---

### Task 1: Introduce Run Record Shape And `plan` Alias

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`

- [ ] **Step 1: Write failing test for `plan` writing `sharded-update-run.json`**

Add a new test near the existing `prepare` tests:

```js
it("plan writes a run record with runId and per-shard statuses", () => {
  const root = initRepo();
  writeCodeShardFixture(root);
  const base = commitAll(root, "base");

  const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.update = {
    gitCommitHash: base,
    updatedAt: "2026-05-22T00:00:00.000Z",
    warnings: [],
    shards: {
      home: {
        artifactHash: hashFile(join(root, ".understand-anything", "shards", "home.json")),
        fingerprintPath: "fingerprints/shards/home.json",
      },
    },
  };
  writeJson(manifestPath, manifest);

  writeFileSync(
    join(root, "a_home", "src", "Home.kt"),
    "function run() {}\nfunction next() {}\n",
    "utf-8",
  );
  const head = commitAll(root, "change home");

  execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });

  const run = JSON.parse(
    readFileSync(
      join(root, ".understand-anything", "intermediate", "sharded-update-run.json"),
      "utf-8",
    ),
  );
  expect(run).toMatchObject({
    version: "1.0.0",
    baseCommitHash: base,
    headCommitHash: head,
    status: "ready",
    changedFiles: ["a_home/src/Home.kt"],
    shards: [
      {
        id: "home",
        path: "shards/home.json",
        status: "needs-file-analysis",
        structuralFiles: ["a_home/src/Home.kt"],
        cosmeticFiles: [],
        deletedFiles: [],
      },
    ],
  });
  expect(run.runId).toEqual(expect.stringContaining(head.slice(0, 12)));
  expect(run.shards[0].requiredOutputs).toMatchObject({
    candidateShard: "intermediate/sharded/home/candidate-shard.json",
    assembleResult: "intermediate/sharded/home/assemble-result.json",
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: fails because `plan` is unknown or `sharded-update-run.json` is missing.

- [ ] **Step 3: Implement minimal `plan` command**

In `sharded-update-workflow.mjs`, add helpers:

```js
function buildRunId(headCommitHash) {
  return `${new Date().toISOString()}-${headCommitHash.slice(0, 12)}`;
}

function statusForShard(shard) {
  if ((shard.structuralFiles ?? []).length > 0) {
    return "needs-file-analysis";
  }
  if ((shard.deletedFiles ?? []).length > 0) {
    return "deleted-only";
  }
  if ((shard.cosmeticFiles ?? []).length > 0) {
    return "cosmetic-only";
  }
  return "noop";
}

function toRunRecord(plan) {
  const runId = buildRunId(plan.headCommitHash);
  const blocked = plan.requiresRerun === true;
  return {
    version: "1.0.0",
    runId,
    baseCommitHash: plan.baseCommitHash,
    headCommitHash: plan.headCommitHash,
    status: blocked ? "blocked" : "ready",
    changedFiles: plan.changedFiles,
    unmappedChangedFiles: plan.unmappedChangedFiles ?? [],
    shards: (plan.affectedCodeShards ?? []).map((shard) => ({
      ...shard,
      status: blocked ? "blocked" : statusForShard(shard),
      requiredOutputs: {
        fileAnalyzerBatches:
          (shard.structuralFiles ?? []).length > 0
            ? [`intermediate/sharded/${shard.id}/batch-001.json`]
            : [],
        candidateShard: `intermediate/sharded/${shard.id}/candidate-shard.json`,
        assembleResult: `intermediate/sharded/${shard.id}/assemble-result.json`,
      },
    })),
    warnings: plan.warnings ?? [],
  };
}
```

Have the new `plan` command call existing `prepare` logic, read `sharded-update-plan.json`, and write `sharded-update-run.json`. Keep `prepare` behavior unchanged for compatibility.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: all current workflow tests pass.

---

### Task 2: Add Current-Run Batch Validation

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`

- [ ] **Step 1: Write failing test rejecting stale analyzer batches**

Add a test under a new `describe("sharded update workflow assemble-shard", ...)`:

```js
it("assemble-shard rejects analyzer batches from a different run", () => {
  const root = initRepo();
  writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
    version: "1.0.0",
    runId: "run-current",
    baseCommitHash: "base",
    headCommitHash: "head",
    status: "ready",
    changedFiles: ["src/a.ts"],
    shards: [
      {
        id: "home",
        path: "shards/home.json",
        scopes: ["src"],
        status: "needs-file-analysis",
        changedFiles: ["src/a.ts"],
        structuralFiles: ["src/a.ts"],
        cosmeticFiles: [],
        deletedFiles: [],
        requiredOutputs: {
          fileAnalyzerBatches: ["intermediate/sharded/home/batch-001.json"],
          candidateShard: "intermediate/sharded/home/candidate-shard.json",
          assembleResult: "intermediate/sharded/home/assemble-result.json",
        },
      },
    ],
    warnings: [],
  });
  writeJson(join(root, ".understand-anything", "shards", "home.json"), {
    version: "1.0.0",
    shard: { id: "home", scopes: ["src"] },
    nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
    edges: [],
    layers: [],
    tour: [],
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "batch-001.json"), {
    runId: "run-stale",
    headCommitHash: "head",
    shardId: "home",
    nodes: [],
    edges: [],
  });

  execFileSync("node", [workflowScript, root, "assemble-shard", "--shard", "home"], {
    encoding: "utf-8",
  });

  const result = JSON.parse(
    readFileSync(
      join(root, ".understand-anything", "intermediate", "sharded", "home", "assemble-result.json"),
      "utf-8",
    ),
  );
  expect(result).toMatchObject({
    runId: "run-current",
    headCommitHash: "head",
    shardId: "home",
    status: "failed",
    warning: "intermediate/sharded/home/batch-001.json does not belong to this sharded update run",
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: fails because `assemble-shard` is unknown.

- [ ] **Step 3: Implement current-run validation helpers**

Add:

```js
function readRun(projectRoot) {
  return readJson(join(projectRoot, ".understand-anything", "intermediate", "sharded-update-run.json"));
}

function findRunShard(run, shardId) {
  const shard = (run.shards ?? []).find((candidate) => candidate.id === shardId);
  if (!shard) {
    throw new Error(`Shard ${shardId} is not present in sharded update run`);
  }
  return shard;
}

function isCurrentRunArtifact(value, run, shardId) {
  return value?.runId === run.runId && value?.headCommitHash === run.headCommitHash && value?.shardId === shardId;
}

function writeAssembleResult(projectRoot, shardId, result) {
  writeJson(join(projectRoot, ".understand-anything", "intermediate", "sharded", shardId, "assemble-result.json"), result);
}

function failAssemble(projectRoot, run, shardId, warning) {
  writeAssembleResult(projectRoot, shardId, {
    runId: run.runId,
    headCommitHash: run.headCommitHash,
    shardId,
    status: "failed",
    warning,
  });
}
```

Implement `assembleShard(projectRoot, args)` that reads the run and rejects non-current required batches before doing any merge.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: all tests pass.

---

### Task 3: Implement `assemble-shard` Cosmetic And Deleted-Only Paths

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`

- [ ] **Step 1: Write failing test for cosmetic-only assemble**

Add:

```js
it("assemble-shard records skipped-cosmetic without writing a candidate", () => {
  const root = initRepo();
  writeJson(join(root, ".understand-anything", "shards", "home.json"), {
    version: "1.0.0",
    shard: { id: "home", scopes: ["src"] },
    nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
    edges: [],
    layers: [],
    tour: [],
  });
  const oldHash = hashFile(join(root, ".understand-anything", "shards", "home.json"));
  writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
    version: "1.0.0",
    runId: "run-current",
    baseCommitHash: "base",
    headCommitHash: "head",
    status: "ready",
    changedFiles: ["src/a.ts"],
    shards: [
      {
        id: "home",
        path: "shards/home.json",
        scopes: ["src"],
        status: "cosmetic-only",
        changedFiles: ["src/a.ts"],
        structuralFiles: [],
        cosmeticFiles: ["src/a.ts"],
        deletedFiles: [],
        requiredOutputs: {
          fileAnalyzerBatches: [],
          candidateShard: "intermediate/sharded/home/candidate-shard.json",
          assembleResult: "intermediate/sharded/home/assemble-result.json",
        },
      },
    ],
    warnings: [],
  });

  execFileSync("node", [workflowScript, root, "assemble-shard", "--shard", "home"], {
    encoding: "utf-8",
  });

  const result = JSON.parse(
    readFileSync(
      join(root, ".understand-anything", "intermediate", "sharded", "home", "assemble-result.json"),
      "utf-8",
    ),
  );
  expect(result).toMatchObject({
    runId: "run-current",
    headCommitHash: "head",
    shardId: "home",
    status: "skipped-cosmetic",
    artifactHash: oldHash,
  });
});
```

- [ ] **Step 2: Write failing test for deleted-only candidate**

Add:

```js
it("assemble-shard creates a candidate for deleted-only changes", () => {
  const root = initRepo();
  writeJson(join(root, ".understand-anything", "shards", "home.json"), {
    version: "1.0.0",
    shard: { id: "home", scopes: ["src"] },
    nodes: [
      { id: "file:src/deleted.ts", type: "file", filePath: "src/deleted.ts" },
      { id: "function:src/deleted.ts:gone", type: "function", filePath: "src/deleted.ts" },
      { id: "file:src/kept.ts", type: "file", filePath: "src/kept.ts" },
    ],
    edges: [
      { source: "file:src/deleted.ts", target: "function:src/deleted.ts:gone", type: "contains", direction: "forward", weight: 1 },
      { source: "file:src/kept.ts", target: "file:src/deleted.ts", type: "imports", direction: "forward", weight: 1 },
    ],
    layers: [{ id: "layer:app", name: "App", description: "App", nodeIds: ["file:src/kept.ts"] }],
    tour: [{ order: 1, title: "Kept", description: "Kept", nodeIds: ["file:src/kept.ts"] }],
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
    version: "1.0.0",
    runId: "run-current",
    baseCommitHash: "base",
    headCommitHash: "head",
    status: "ready",
    changedFiles: ["src/deleted.ts"],
    shards: [
      {
        id: "home",
        path: "shards/home.json",
        scopes: ["src"],
        status: "deleted-only",
        changedFiles: ["src/deleted.ts"],
        structuralFiles: [],
        cosmeticFiles: [],
        deletedFiles: ["src/deleted.ts"],
        requiredOutputs: {
          fileAnalyzerBatches: [],
          candidateShard: "intermediate/sharded/home/candidate-shard.json",
          assembleResult: "intermediate/sharded/home/assemble-result.json",
        },
      },
    ],
    warnings: [],
  });

  execFileSync("node", [workflowScript, root, "assemble-shard", "--shard", "home"], {
    encoding: "utf-8",
  });

  const candidate = JSON.parse(
    readFileSync(
      join(root, ".understand-anything", "intermediate", "sharded", "home", "candidate-shard.json"),
      "utf-8",
    ),
  );
  expect(candidate.nodes.map((node) => node.id)).toEqual(["file:src/kept.ts"]);
  expect(candidate.edges).toEqual([]);
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: fails until `assemble-shard` writes cosmetic and deleted-only results.

- [ ] **Step 4: Implement cosmetic and deleted-only assembly**

In `assembleShard`:

```js
if (runShard.status === "cosmetic-only") {
  const shardPath = join(uaDir, runShard.path);
  writeAssembleResult(projectRoot, runShard.id, {
    runId: run.runId,
    headCommitHash: run.headCommitHash,
    shardId: runShard.id,
    status: "skipped-cosmetic",
    artifactHash: artifactHash(shardPath),
  });
  return;
}

if (runShard.status === "deleted-only") {
  const oldGraph = readJson(join(uaDir, runShard.path));
  const candidate = pruneGraphForChangedFiles(oldGraph, [], runShard.deletedFiles ?? []);
  candidate.runId = run.runId;
  candidate.headCommitHash = run.headCommitHash;
  candidate.shardId = runShard.id;
  const candidatePath = join(uaDir, "intermediate", "sharded", runShard.id, "candidate-shard.json");
  writeJson(candidatePath, candidate);
  writeAssembleResult(projectRoot, runShard.id, {
    runId: run.runId,
    headCommitHash: run.headCommitHash,
    shardId: runShard.id,
    status: "success",
    candidatePath: `intermediate/sharded/${runShard.id}/candidate-shard.json`,
  });
  return;
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: tests pass.

---

### Task 4: Implement Structural `assemble-shard` Candidate Creation

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`

- [ ] **Step 1: Write failing test for structural candidate**

Add:

```js
it("assemble-shard merges retained graph with current-run analyzer batches", () => {
  const root = initRepo();
  writeJson(join(root, ".understand-anything", "shards", "home.json"), {
    version: "1.0.0",
    shard: { id: "home", scopes: ["src"] },
    nodes: [
      { id: "file:src/a.ts", type: "file", filePath: "src/a.ts" },
      { id: "function:src/a.ts:old", type: "function", filePath: "src/a.ts" },
      { id: "file:src/kept.ts", type: "file", filePath: "src/kept.ts" },
    ],
    edges: [
      { source: "file:src/a.ts", target: "function:src/a.ts:old", type: "contains", direction: "forward", weight: 1 },
    ],
    layers: [],
    tour: [],
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
    version: "1.0.0",
    runId: "run-current",
    baseCommitHash: "base",
    headCommitHash: "head",
    status: "ready",
    changedFiles: ["src/a.ts"],
    shards: [
      {
        id: "home",
        path: "shards/home.json",
        scopes: ["src"],
        status: "needs-file-analysis",
        changedFiles: ["src/a.ts"],
        structuralFiles: ["src/a.ts"],
        cosmeticFiles: [],
        deletedFiles: [],
        requiredOutputs: {
          fileAnalyzerBatches: ["intermediate/sharded/home/batch-001.json"],
          candidateShard: "intermediate/sharded/home/candidate-shard.json",
          assembleResult: "intermediate/sharded/home/assemble-result.json",
        },
      },
    ],
    warnings: [],
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "batch-001.json"), {
    runId: "run-current",
    headCommitHash: "head",
    shardId: "home",
    nodes: [
      { id: "file:src/a.ts", type: "file", filePath: "src/a.ts" },
      { id: "function:src/a.ts:new", type: "function", filePath: "src/a.ts" },
    ],
    edges: [
      { source: "file:src/a.ts", target: "function:src/a.ts:new", type: "contains", direction: "forward", weight: 1 },
    ],
  });

  execFileSync("node", [workflowScript, root, "assemble-shard", "--shard", "home"], {
    encoding: "utf-8",
  });

  const candidate = JSON.parse(
    readFileSync(
      join(root, ".understand-anything", "intermediate", "sharded", "home", "candidate-shard.json"),
      "utf-8",
    ),
  );
  expect(candidate.nodes.map((node) => node.id)).toEqual([
    "file:src/kept.ts",
    "file:src/a.ts",
    "function:src/a.ts:new",
  ]);
  expect(candidate.layers).toEqual([]);
  expect(candidate.tour).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: fails until structural assembly exists.

- [ ] **Step 3: Implement structural assembly**

Use existing `pruneGraphForChangedFiles` and merge logic. The fastest safe path is to have `assemble-shard` write a temporary `batch-existing.json`, then invoke the existing Python merge script with shard-local paths.

Add:

```js
function runMergeBatchGraphs(projectRoot, pluginRoot, shardId) {
  const shardIntermediate = join(projectRoot, ".understand-anything", "intermediate", "sharded", shardId);
  execFileSync("python3", [
    join(pluginRoot, "skills", "understand", "merge-batch-graphs.py"),
    projectRoot,
    "--allow-external-edges",
    "--intermediate-dir",
    shardIntermediate,
    "--output",
    join(shardIntermediate, "candidate-shard.json"),
  ], { stdio: "pipe" });
}
```

If resolving `pluginRoot` inside the script is inconvenient, pass it with `--plugin-root <path>` in tests and document it in `/understand`, or derive it from `import.meta.url`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: tests pass.

---

### Task 5: Make `commit` Reject Missing Layers/Tour For Structural Candidates

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`

- [ ] **Step 1: Write failing test for missing layers/tour**

Add:

```js
it("commit rejects structural candidates without refreshed layers and tour", () => {
  const root = initRepo();
  writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
    version: "1.0.0",
    kind: "codebase-sharded",
    project: { name: "Demo" },
    overview: { summary: "Demo", nodeCount: 0, edgeCount: 0, shardCount: 1 },
    shards: [{ id: "home", path: "shards/home.json", scopes: ["src"] }],
    warnings: [],
    update: {
      gitCommitHash: "base",
      updatedAt: "2026-05-22T00:00:00.000Z",
      warnings: [],
      shards: { home: { artifactHash: "sha256:old", fingerprintPath: "fingerprints/shards/home.json" } },
    },
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
    version: "1.0.0",
    runId: "run-current",
    baseCommitHash: "base",
    headCommitHash: "head",
    status: "ready",
    changedFiles: ["src/a.ts"],
    shards: [
      {
        id: "home",
        path: "shards/home.json",
        status: "needs-file-analysis",
        structuralFiles: ["src/a.ts"],
        cosmeticFiles: [],
        deletedFiles: [],
      },
    ],
    warnings: [],
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "candidate-shard.json"), {
    runId: "run-current",
    headCommitHash: "head",
    shardId: "home",
    version: "1.0.0",
    shard: { id: "home", scopes: ["src"] },
    nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
    edges: [],
    layers: [],
    tour: [],
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "assemble-result.json"), {
    runId: "run-current",
    headCommitHash: "head",
    shardId: "home",
    status: "success",
    candidatePath: "intermediate/sharded/home/candidate-shard.json",
  });

  execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

  const manifest = JSON.parse(
    readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
  );
  expect(manifest.update.gitCommitHash).toBe("base");
  expect(manifest.update.warnings).toContain("home structural candidate is missing refreshed layers or tour");
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: fails because `commit` does not exist or does not validate layers/tour.

- [ ] **Step 3: Implement `commit` validation**

Add:

```js
function structuralCandidateNeedsLayersAndTour(runShard) {
  return (runShard.structuralFiles ?? []).length > 0 || (runShard.deletedFiles ?? []).length > 0;
}

function hasRefreshedLayersAndTour(candidate) {
  return Array.isArray(candidate.layers) && candidate.layers.length > 0 &&
    Array.isArray(candidate.tour) && candidate.tour.length > 0;
}
```

In `commit`, reject structural/deleted candidates without refreshed layers/tour.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: tests pass.

---

### Task 6: Implement `commit` Code Shard Writes And Manifest Advancement

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`

- [ ] **Step 1: Write failing end-to-end test for add/delete/modify**

Add a test based on the shell simulation already used manually:

```js
it("plan assemble-shard and commit complete add delete modify updates", () => {
  const root = initRepo();
  // Create a base shard with src/modify.ts, src/delete.ts, src/keep.ts.
  // Commit baseline, set knowledge-graph.json.update.gitCommitHash to that commit.
  // Modify src/modify.ts, delete src/delete.ts, add src/add.ts, and commit.
  // Run: plan.
  // Write current-run batch-001.json for structural files.
  // Run: assemble-shard --shard app.
  // Add refreshed layers/tour to candidate-shard.json.
  // Run: commit.
  // Assert:
  // - final shard contains keep, modify, add.
  // - final shard does not contain delete.
  // - root manifest commit is HEAD.
  // - root manifest counts match final shard.
  // - fingerprints contain add/modify/keep and not delete.
});
```

Use the complete setup from the existing manual simulation or the current add/delete/modify test fixtures. Do not use comments as the final test body; expand it into explicit writes and assertions when implementing this task.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: fails because `commit` does not yet write candidates atomically and update fingerprints/manifests.

- [ ] **Step 3: Implement code commit**

`commit` should:

1. Read `sharded-update-run.json`.
2. Iterate `run.shards`.
3. Require `assemble-result.json` for non-`noop` shards.
4. Reject stale result metadata.
5. For `skipped-cosmetic`, update fingerprint only.
6. For `success`, read `candidate-shard.json`.
7. Validate candidate metadata.
8. Write candidate to `.understand-anything/shards/<id>.json`.
9. Refresh fingerprint store from candidate file nodes.
10. Refresh root manifest summary and `update.shards`.
11. Advance `update.gitCommitHash` only when all requested work succeeds and no downstream flags are present.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: tests pass.

---

### Task 7: Add Downstream Current-Run Results

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`

- [ ] **Step 1: Write failing test for old downstream files not being accepted**

Add:

```js
it("commit does not accept old downstream shard files without current-run results", () => {
  const root = initRepo();
  writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
    version: "1.0.0",
    kind: "codebase-sharded",
    project: { name: "Demo" },
    overview: { summary: "Demo", nodeCount: 0, edgeCount: 0, shardCount: 1 },
    shards: [{ id: "home", path: "shards/home.json", scopes: ["src"] }],
    warnings: [],
    update: {
      gitCommitHash: "base",
      updatedAt: "2026-05-22T00:00:00.000Z",
      warnings: [],
      shards: { home: { artifactHash: "sha256:new-home", fingerprintPath: "fingerprints/shards/home.json" } },
    },
  });
  writeJson(join(root, ".understand-anything", "domain-graph.json"), {
    version: "1.0.0",
    kind: "domain-sharded",
    source: { codeManifest: "knowledge-graph.json" },
    shards: [{ id: "home", path: "domain-shards/home.json", sourceCodeShard: "shards/home.json" }],
    warnings: [],
    update: { updatedAt: "2026-05-22T00:00:00.000Z", warnings: [], shards: {} },
  });
  writeJson(join(root, ".understand-anything", "domain-shards", "home.json"), {
    version: "1.0.0",
    stale: true,
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
    version: "1.0.0",
    runId: "run-current",
    baseCommitHash: "base",
    headCommitHash: "head",
    status: "ready",
    changedFiles: ["src/a.ts"],
    shards: [],
    downstream: {
      domain: {
        requested: true,
        shardsToRebuild: ["home"],
      },
    },
    warnings: [],
  });

  execFileSync("node", [workflowScript, root, "commit", "--with-domain"], { encoding: "utf-8" });

  const codeManifest = JSON.parse(
    readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
  );
  expect(codeManifest.update.gitCommitHash).toBe("base");
  expect(codeManifest.update.warnings).toContain("home domain rebuild result is missing for current run");
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: fails until downstream current-run result validation exists.

- [ ] **Step 3: Implement downstream result validation**

Require files:

```text
.understand-anything/intermediate/domain-shards/<id>/domain-update-result.json
.understand-anything/intermediate/product-shards/<id>/product-update-result.json
```

Expected result shape:

```json
{
  "runId": "run-current",
  "headCommitHash": "head",
  "shardId": "home",
  "status": "success",
  "artifactHash": "sha256:...",
  "traceArtifactHash": "sha256:..."
}
```

`commit` must reject missing/stale/failed downstream results.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: tests pass.

---

### Task 8: Update `/understand` Docs And Internal Workflow Contract

**Files:**
- Create: `understand-anything-plugin/skills/understand/update-diff-workflow.md`
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`
- Modify: `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`

- [ ] **Step 1: Write failing docs test**

Update `understand-sharded-diff-docs.test.ts`:

```ts
it("documents the simplified sharded update transaction workflow", () => {
  const skill = readFileSync(
    join(pluginRoot, "skills", "understand", "SKILL.md"),
    "utf-8",
  );
  const workflow = readFileSync(
    join(pluginRoot, "skills", "understand", "update-diff-workflow.md"),
    "utf-8",
  );

  expect(skill).toContain("update-diff-workflow.md");
  expect(workflow).toContain("plan");
  expect(workflow).toContain("assemble-shard");
  expect(workflow).toContain("commit");
  expect(workflow).toContain("runId");
  expect(workflow).toContain("headCommitHash");
  expect(workflow).toContain("candidate-shard.json");
  expect(workflow).toContain("current-run result");
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm test -- src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected: fails because `update-diff-workflow.md` does not exist.

- [ ] **Step 3: Create internal workflow doc**

Create `skills/understand/update-diff-workflow.md` with sections:

```markdown
# Update Diff Workflow

## Non-Sharded Graphs

Use the existing incremental path.

## Sharded Graphs

Run:

1. `plan`
2. `file-analyzer` for `needs-file-analysis` shards
3. `assemble-shard --shard <id>`
4. `architecture-analyzer` and `tour-builder` for structural candidates
5. `commit [--with-domain] [--with-product]`

All artifacts after `plan` must include `runId`, `headCommitHash`, and `shardId`.
The `commit` command is the only command allowed to advance `knowledge-graph.json.update.gitCommitHash`.
```

- [ ] **Step 4: Thin `SKILL.md`**

Replace the long sharded update block with a short delegation:

```markdown
**Sharded file-level incremental path (`--update-diff` + `kind: "codebase-sharded"`):**
Follow `skills/understand/update-diff-workflow.md`. Keep `/understand` responsible for dispatching the listed agents, and keep `sharded-update-workflow.mjs` responsible for plan/assemble/commit validation.
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
corepack pnpm test -- src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected: tests pass.

---

### Task 9: Remove Legacy Command Aliases

**Files:**
- Modify: `understand-anything-plugin/skills/understand/sharded-update-workflow.mjs`
- Modify: `understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/update-diff-workflow.md`

- [x] **Step 1: Delete legacy CLI handlers** (`prepare`, `write-batch-existing`, `finalize-code`, `finalize-manifest`, `finalize-downstream`)
- [x] **Step 2: `plan` writes only `sharded-update-run.json`** (internal `buildShardedDiffPlan` no longer writes `sharded-update-plan.json`)
- [x] **Step 3: Remove legacy-only tests; add rejection test for removed commands**
- [x] **Step 4: Update workflow docs to list supported commands only**

---

### Task 10: Final Focused Verification

**Files:**
- No production changes unless verification finds a defect.

- [ ] **Step 1: Run sharded workflow tests**

Run:

```bash
corepack pnpm test -- src/__tests__/sharded-update-workflow.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run docs contract tests**

Run:

```bash
corepack pnpm test -- src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run merge script tests**

Run:

```bash
python3 understand-anything-plugin/skills/understand/test_merge_batch_graphs.py -v
```

Expected: all tests pass.

- [ ] **Step 4: Run core sharded update tests**

Run:

```bash
corepack pnpm test -- packages/core/src/__tests__/sharded-update.test.ts packages/core/src/__tests__/incremental-update.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Read lints for edited files**

Check:

```text
understand-anything-plugin/skills/understand/sharded-update-workflow.mjs
understand-anything-plugin/skills/understand/SKILL.md
understand-anything-plugin/skills/understand/update-diff-workflow.md
understand-anything-plugin/src/__tests__/sharded-update-workflow.test.mjs
understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected: no new diagnostics introduced by this work.

---

## Spec Coverage Self-Review

- File-level token savings: covered by Tasks 1, 2, 4, and 6.
- Shard-level candidate assembly: covered by Tasks 3, 4, 5, and 6.
- Manifest-level commit: covered by Tasks 5, 6, and 7.
- `runId/headCommitHash/shardId` stale artifact rejection: covered by Tasks 2 and 7.
- Cosmetic-only no-op: covered by Task 3.
- Downstream current-run result validation: covered by Task 7.
- `/understand` entry remains user-facing command: covered by Task 8.
- Backward compatibility during migration: covered by Task 9.
- Non-sharded flow unchanged: covered by Task 10 focused verification and by avoiding edits to non-sharded architecture.
