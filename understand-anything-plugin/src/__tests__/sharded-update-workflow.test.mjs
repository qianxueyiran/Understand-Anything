import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..", "..");
const workflowScript = join(pluginRoot, "skills", "understand", "sharded-update-workflow.mjs");

let tempRoot;

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function initRepo() {
  tempRoot = mkdtempSync(join(tmpdir(), "ua-sharded-workflow-test-"));
  execFileSync("git", ["init", "-q", "-b", "main", tempRoot]);
  execFileSync("git", ["-C", tempRoot, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", tempRoot, "config", "user.name", "Test User"]);
  return tempRoot;
}

function commitAll(root, message) {
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", message]);
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).trim();
}

function hashFile(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function writeCodeShardFixture(root, options = {}) {
  mkdirSync(join(root, "a_home", "src"), { recursive: true });
  writeFileSync(join(root, "a_home", "src", "Home.kt"), "function run() {}\n", "utf-8");
  writeJson(join(root, ".understand-anything", "shards", "home.json"), {
    version: "1.0.0",
    project: {
      name: "Demo",
      languages: ["kotlin"],
      frameworks: ["android"],
      description: "Demo",
      analyzedAt: "2026-05-21T00:00:00.000Z",
      gitCommitHash: "base",
    },
    shard: { id: "home", scopes: ["a_home"] },
    nodes: [
      {
        id: "file:a_home/src/Home.kt",
        type: "file",
        name: "Home.kt",
        filePath: "a_home/src/Home.kt",
        summary: "Home",
        tags: ["home"],
        complexity: "simple",
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  });
  writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
    version: "1.0.0",
    kind: "codebase-sharded",
    project: { name: "Demo" },
    overview: { summary: "Demo", nodeCount: 1, edgeCount: 0, shardCount: 1 },
    shards: [{ id: "home", path: "shards/home.json", scopes: ["a_home"] }],
    warnings: [],
  });

  if (options.withFingerprint !== false) {
    writeJson(join(root, ".understand-anything", "fingerprints", "shards", "home.json"), {
      version: "1.0.0",
      gitCommitHash: "base",
      generatedAt: "2026-05-21T00:00:00.000Z",
      files: {
        "a_home/src/Home.kt": {
          filePath: "a_home/src/Home.kt",
          contentHash: "old",
          functions: [{ name: "run", params: [], exported: false, lineCount: 1 }],
          classes: [],
          imports: [],
          exports: [],
          totalLines: 1,
          hasStructuralAnalysis: true,
        },
      },
    });
  }
}

function expectRemovedCommand(root, command) {
  expect(() => {
    execFileSync("node", [workflowScript, root, command], { encoding: "utf-8" });
  }).toThrow();
}

describe("sharded update workflow plan", () => {
  it("maps one git diff into one complete run record", () => {
    const root = initRepo();
    writeCodeShardFixture(root);
    const base = commitAll(root, "base");

    const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.update = {
      gitCommitHash: base,
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        home: {
          artifactHash: "sha256:old",
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
    expect(run.baseCommitHash).toBe(base);
    expect(run.headCommitHash).toBe(head);
    expect(run.changedFiles).toEqual(["a_home/src/Home.kt"]);
    expect(run.shards).toMatchObject([
      {
        id: "home",
        path: "shards/home.json",
        structuralFiles: ["a_home/src/Home.kt"],
        deletedFiles: [],
      },
    ]);
    expect(
      existsSync(join(root, ".understand-anything", "intermediate", "sharded-update-plan.json")),
    ).toBe(false);
  });

  it("rejects removed legacy workflow commands", () => {
    const root = initRepo();
    for (const command of [
      "prepare",
      "write-batch-existing",
      "finalize-code",
      "finalize-manifest",
      "finalize-downstream",
    ]) {
      expectRemovedCommand(root, command);
    }
  });

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

  it("creates a shard fingerprint baseline and warns when shard fingerprints are missing", () => {
    const root = initRepo();
    writeCodeShardFixture(root, { withFingerprint: false });
    const base = commitAll(root, "base");

    const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.update = {
      gitCommitHash: base,
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        home: {
          artifactHash: "sha256:old",
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
    commitAll(root, "change home");

    execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });

    const run = JSON.parse(
      readFileSync(
        join(root, ".understand-anything", "intermediate", "sharded-update-run.json"),
        "utf-8",
      ),
    );
    expect(run.shards).toMatchObject([
      {
        id: "home",
        structuralFiles: [],
        deletedFiles: [],
      },
    ]);
    expect(run.warnings).toContain(
      "Created shard fingerprint baseline for home; rerun update-diff after this baseline to classify file changes.",
    );
    expect(run.status).toBe("blocked");
  });

  it("blocks commit advancement when the root update baseline is missing", () => {
    const root = initRepo();
    writeCodeShardFixture(root);
    commitAll(root, "base");

    writeFileSync(
      join(root, "a_home", "src", "Home.kt"),
      "function run() {}\nfunction next() {}\n",
      "utf-8",
    );
    const head = commitAll(root, "change home");

    execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });
    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const run = JSON.parse(
      readFileSync(
        join(root, ".understand-anything", "intermediate", "sharded-update-run.json"),
        "utf-8",
      ),
    );
    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );

    expect(run).toMatchObject({
      headCommitHash: head,
      status: "blocked",
    });
    expect(run.warnings).toContain(
      "Initialized sharded update baseline; rerun /understand --update-diff to classify changes from this commit.",
    );
    expect(manifest.update.gitCommitHash).not.toBe(head);
    expect(manifest.update.warnings).toContain("sharded update run is blocked");
  });

  it("plan marks runs blocked when rerun is required", () => {
    const root = initRepo();
    writeCodeShardFixture(root, { withFingerprint: false });
    const base = commitAll(root, "base");

    const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.update = {
      gitCommitHash: base,
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        home: {
          artifactHash: "sha256:old",
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
    commitAll(root, "change home");

    execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });

    const run = JSON.parse(
      readFileSync(
        join(root, ".understand-anything", "intermediate", "sharded-update-run.json"),
        "utf-8",
      ),
    );
    expect(run.status).toBe("blocked");
    expect(run.shards).toMatchObject([
      {
        id: "home",
        status: "blocked",
        requiredOutputs: {
          fileAnalyzerBatches: [],
          candidateShard: "intermediate/sharded/home/candidate-shard.json",
          assembleResult: "intermediate/sharded/home/assemble-result.json",
        },
      },
    ]);
  });

  it("records unmapped source files without rebuilding every shard", () => {
    const root = initRepo();
    writeCodeShardFixture(root);
    const base = commitAll(root, "base");

    const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.update = {
      gitCommitHash: base,
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        home: {
          artifactHash: "sha256:old",
          fingerprintPath: "fingerprints/shards/home.json",
        },
      },
    };
    writeJson(manifestPath, manifest);

    mkdirSync(join(root, "other", "src"), { recursive: true });
    writeFileSync(join(root, "other", "src", "Other.kt"), "function other() {}\n", "utf-8");
    commitAll(root, "add unmapped source");

    execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });

    const run = JSON.parse(
      readFileSync(
        join(root, ".understand-anything", "intermediate", "sharded-update-run.json"),
        "utf-8",
      ),
    );
    expect(run.shards).toEqual([]);
    expect(run.unmappedChangedFiles).toEqual(["other/src/Other.kt"]);
    expect(run.warnings).toContain(
      "other/src/Other.kt did not match any shard; add a shard or rerun /understand --scope ... --shard ...",
    );
  });

  it("classifies Kotlin import, class, and function additions as structural", () => {
    const root = initRepo();
    mkdirSync(join(root, "a_home", "src"), { recursive: true });
    writeFileSync(join(root, "a_home", "src", "Home.kt"), "package demo\n\n// no declarations yet\n", "utf-8");
    writeJson(join(root, ".understand-anything", "shards", "home.json"), {
      version: "1.0.0",
      project: {
        name: "Demo",
        languages: ["kotlin"],
        frameworks: ["android"],
        description: "Demo",
        analyzedAt: "2026-05-21T00:00:00.000Z",
        gitCommitHash: "base",
      },
      shard: { id: "home", scopes: ["a_home"] },
      nodes: [
        {
          id: "file:a_home/src/Home.kt",
          type: "file",
          name: "Home.kt",
          filePath: "a_home/src/Home.kt",
          summary: "Home",
          tags: ["home"],
          complexity: "simple",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    });
    writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 1, edgeCount: 0, shardCount: 1 },
      shards: [{ id: "home", path: "shards/home.json", scopes: ["a_home"] }],
      warnings: [],
    });
    writeJson(join(root, ".understand-anything", "fingerprints", "shards", "home.json"), {
      version: "1.0.0",
      gitCommitHash: "base",
      generatedAt: "2026-05-21T00:00:00.000Z",
      files: {
        "a_home/src/Home.kt": {
          filePath: "a_home/src/Home.kt",
          contentHash: "old",
          functions: [],
          classes: [],
          imports: [],
          exports: [],
          totalLines: 3,
          hasStructuralAnalysis: true,
        },
      },
    });
    const base = commitAll(root, "base");

    const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.update = {
      gitCommitHash: base,
      updatedAt: "2026-05-21T00:00:00.000Z",
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
      "package demo\n\nimport foo.Bar\n\nclass HomeViewModel\n\nfun render() {}\n",
      "utf-8",
    );
    commitAll(root, "add kotlin declarations");

    execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });

    const run = JSON.parse(
      readFileSync(
        join(root, ".understand-anything", "intermediate", "sharded-update-run.json"),
        "utf-8",
      ),
    );
    expect(run.shards[0]).toMatchObject({
      structuralFiles: ["a_home/src/Home.kt"],
      deletedFiles: [],
    });
  });

  it("plan classifies comment-only edits as needs-file-analysis", () => {
    const root = initRepo();
    writeCodeShardFixture(root);
    const base = commitAll(root, "base");

    const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.update = {
      gitCommitHash: base,
      updatedAt: "2026-05-21T00:00:00.000Z",
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
      "// comment-only change\nfunction run() {}\n",
      "utf-8",
    );
    commitAll(root, "comment-only home");

    execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });

    const run = JSON.parse(
      readFileSync(
        join(root, ".understand-anything", "intermediate", "sharded-update-run.json"),
        "utf-8",
      ),
    );
    expect(run.shards[0]).toMatchObject({
      id: "home",
      status: "needs-file-analysis",
      structuralFiles: ["a_home/src/Home.kt"],
      deletedFiles: [],
    });
  });
});

describe("sharded update workflow assemble-shard", () => {
  it("assemble-shard creates a candidate for deleted-only changes", () => {
    const root = initRepo();
    writeJson(join(root, ".understand-anything", "shards", "home.json"), {
      version: "1.0.0",
      shard: { id: "home", scopes: ["src"] },
      nodes: [
        {
          id: "file:src/deleted.ts",
          type: "file",
          name: "deleted.ts",
          filePath: "src/deleted.ts",
          summary: "Deleted",
          tags: ["deleted"],
          complexity: "simple",
        },
        {
          id: "function:src/deleted.ts:run",
          type: "function",
          name: "run",
          filePath: "src/deleted.ts",
          summary: "run",
          tags: ["fn"],
          complexity: "simple",
        },
        {
          id: "file:src/kept.ts",
          type: "file",
          name: "kept.ts",
          filePath: "src/kept.ts",
          summary: "Kept",
          tags: ["kept"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/kept.ts",
          target: "file:src/deleted.ts",
          type: "imports",
          direction: "forward",
          weight: 0.5,
        },
      ],
      layers: [
        { id: "files", nodeIds: ["file:src/kept.ts", "file:src/deleted.ts"] },
        { id: "deleted-only", nodeIds: ["file:src/deleted.ts"] },
      ],
      tour: [
        { title: "Kept", nodeIds: ["file:src/kept.ts", "file:src/deleted.ts"] },
        { title: "Deleted", nodeIds: ["file:src/deleted.ts"] },
      ],
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
    expect(candidate).toMatchObject({
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
    });
    expect(candidate.nodes.map((node) => node.id)).toEqual(["file:src/kept.ts"]);
    expect(candidate.edges).toEqual([]);
    expect(candidate).not.toHaveProperty("layers");
    expect(candidate).not.toHaveProperty("tour");

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
      status: "success",
      candidatePath: "intermediate/sharded/home/candidate-shard.json",
    });
  });

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

  it("assemble-shard rejects failed analyzer batches without writing a candidate", () => {
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
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "failed",
      warning: "analyzer failed",
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
      warning: "intermediate/sharded/home/batch-001.json failed: analyzer failed",
    });
    expect(
      existsSync(
        join(root, ".understand-anything", "intermediate", "sharded", "home", "candidate-shard.json"),
      ),
    ).toBe(false);
  });

  it("assemble-shard fails when an analyzer batch is missing", () => {
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
      warning: "intermediate/sharded/home/batch-001.json is missing",
    });
  });

  it("assemble-shard merges retained graph with current-run analyzer batches", () => {
    const root = initRepo();
    writeJson(join(root, ".understand-anything", "shards", "home.json"), {
      version: "1.0.0",
      project: {
        name: "Demo",
        languages: ["ts"],
        frameworks: [],
        description: "Demo",
        analyzedAt: "2026-05-21T00:00:00.000Z",
        gitCommitHash: "base",
      },
      shard: { id: "home", scopes: ["src"] },
      nodes: [
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          filePath: "src/a.ts",
          summary: "Old",
          tags: ["old"],
          complexity: "simple",
        },
        {
          id: "function:src/a.ts:old",
          type: "function",
          name: "old",
          filePath: "src/a.ts",
          summary: "old",
          tags: ["fn"],
          complexity: "simple",
        },
        {
          id: "file:src/kept.ts",
          type: "file",
          name: "kept.ts",
          filePath: "src/kept.ts",
          summary: "Kept",
          tags: ["kept"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/a.ts",
          target: "function:src/a.ts:old",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
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
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          filePath: "src/a.ts",
          summary: "New",
          tags: ["new"],
          complexity: "simple",
        },
        {
          id: "function:src/a.ts:new",
          type: "function",
          name: "new",
          filePath: "src/a.ts",
          summary: "new",
          tags: ["fn"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/a.ts",
          target: "function:src/a.ts:new",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
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
    expect(candidate).toMatchObject({
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
    });
    expect(candidate.nodes.map((node) => node.id)).toEqual([
      "file:src/kept.ts",
      "file:src/a.ts",
      "function:src/a.ts:new",
    ]);
    expect(candidate.edges).toEqual([
      {
        source: "file:src/a.ts",
        target: "function:src/a.ts:new",
        type: "contains",
        direction: "forward",
        weight: 1,
      },
    ]);
    expect(candidate).not.toHaveProperty("layers");
    expect(candidate).not.toHaveProperty("tour");

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
      status: "success",
      candidatePath: "intermediate/sharded/home/candidate-shard.json",
    });
  });

  it("assemble-shard dedupes structural candidate nodes and edges deterministically", () => {
    const root = initRepo();
    writeJson(join(root, ".understand-anything", "shards", "home.json"), {
      version: "1.0.0",
      shard: { id: "home", scopes: ["src"] },
      nodes: [
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          filePath: "src/a.ts",
          summary: "Old",
          tags: ["old"],
          complexity: "simple",
        },
        {
          id: "file:src/kept.ts",
          type: "file",
          name: "kept.ts",
          filePath: "src/kept.ts",
          summary: "Kept from retained",
          tags: ["retained"],
          complexity: "simple",
        },
        {
          id: "file:src/shared.ts",
          type: "file",
          name: "shared.ts",
          filePath: "src/shared.ts",
          summary: "Shared",
          tags: ["shared"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/a.ts",
          target: "file:src/kept.ts",
          type: "imports",
          direction: "forward",
          weight: 0.9,
        },
        {
          source: "file:src/kept.ts",
          target: "file:src/shared.ts",
          type: "imports",
          direction: "forward",
          weight: 0.1,
        },
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
          deletedFiles: [],
          requiredOutputs: {
            fileAnalyzerBatches: [
              "intermediate/sharded/home/batch-001.json",
              "intermediate/sharded/home/batch-002.json",
            ],
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
        {
          id: "file:src/kept.ts",
          type: "file",
          name: "kept.ts",
          filePath: "src/kept.ts",
          summary: "Kept from batch",
          tags: ["batch"],
          complexity: "moderate",
        },
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          filePath: "src/a.ts",
          summary: "New",
          tags: ["new"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/kept.ts",
          target: "file:src/shared.ts",
          type: "imports",
          direction: "forward",
          weight: 0.8,
        },
        {
          source: "file:src/a.ts",
          target: "file:src/kept.ts",
          type: "imports",
          direction: "forward",
          weight: 0.3,
        },
        {
          source: "file:src/kept.ts",
          target: "file:src/a.ts",
          type: "imports",
          direction: "forward",
          weight: 0.2,
        },
      ],
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "batch-002.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      nodes: [
        {
          id: "function:src/a.ts:new",
          type: "function",
          name: "new",
          filePath: "src/a.ts",
          summary: "new",
          tags: ["fn"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/kept.ts",
          target: "file:src/a.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
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
      "file:src/shared.ts",
      "file:src/a.ts",
      "function:src/a.ts:new",
    ]);
    expect(candidate.nodes.find((node) => node.id === "file:src/kept.ts")).toMatchObject({
      summary: "Kept from batch",
      complexity: "moderate",
    });

    const edgeKey = (edge) => `${edge.source}|${edge.target}|${edge.type}|${edge.direction}`;
    const edgesByKey = new Map(candidate.edges.map((edge) => [edgeKey(edge), edge]));
    expect(edgesByKey.size).toBe(candidate.edges.length);
    expect(edgesByKey.get("file:src/kept.ts|file:src/shared.ts|imports|forward")).toMatchObject({
      weight: 0.8,
    });
    expect(edgesByKey.get("file:src/a.ts|file:src/kept.ts|imports|forward")).toMatchObject({
      weight: 0.3,
    });
    expect(edgesByKey.get("file:src/kept.ts|file:src/a.ts|imports|forward")).toMatchObject({
      weight: 0.7,
    });
  });
});

function writeCommitValidationFixture(root, options = {}) {
  const shardId = options.shardId ?? "home";
  const candidatePath = options.candidatePath ?? `intermediate/sharded/${shardId}/candidate-shard.json`;
  const assembleResultPath =
    options.assembleResultPath ?? `intermediate/sharded/${shardId}/assemble-result.json`;
  writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
    version: "1.0.0",
    kind: "codebase-sharded",
    project: { name: "Demo" },
    overview: { summary: "Demo", nodeCount: 1, edgeCount: 0, shardCount: 1 },
    shards: [{ id: shardId, path: `shards/${shardId}.json`, scopes: ["src"] }],
    warnings: [],
    update: {
      gitCommitHash: "base",
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {},
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
        id: shardId,
        path: `shards/${shardId}.json`,
        scopes: ["src"],
        status: "needs-file-analysis",
        changedFiles: ["src/a.ts"],
        structuralFiles: ["src/a.ts"],
        deletedFiles: [],
        requiredOutputs: {
          fileAnalyzerBatches: [`intermediate/sharded/${shardId}/batch-001.json`],
          candidateShard: candidatePath,
          assembleResult: assembleResultPath,
        },
        ...(options.runShard ?? {}),
      },
    ],
    warnings: [],
  });

  if (options.candidate !== undefined) {
    writeJson(join(root, ".understand-anything", candidatePath), options.candidate);
  }
  if (options.assembleResult !== undefined) {
    writeJson(join(root, ".understand-anything", assembleResultPath), options.assembleResult);
  }
}

function writeDownstreamCommitFixture(root, options = {}) {
  const codeArtifactHash = options.codeArtifactHash ?? "sha256:new-home";
  const domainArtifactHash = options.domainArtifactHash ?? "sha256:old-domain";
  const productArtifactHash = options.productArtifactHash ?? "sha256:old-product";
  writeJson(join(root, ".understand-anything", "shards", "home.json"), {
    version: "1.0.0",
    shard: { id: "home", scopes: ["home"] },
    nodes: [{ id: "file:home/Home.ts", type: "file", filePath: "home/Home.ts" }],
    edges: [],
    layers: [{ id: "files", nodeIds: ["file:home/Home.ts"] }],
    tour: [{ title: "Home", nodeIds: ["file:home/Home.ts"] }],
  });
  writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
    version: "1.0.0",
    kind: "codebase-sharded",
    project: { name: "Demo" },
    overview: { summary: "Demo", nodeCount: 1, edgeCount: 0, shardCount: 1 },
    shards: [{ id: "home", path: "shards/home.json", scopes: ["home"] }],
    warnings: [],
    update: {
      gitCommitHash: "base",
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        home: { artifactHash: codeArtifactHash, fingerprintPath: "fingerprints/shards/home.json" },
      },
    },
  });
  writeJson(join(root, ".understand-anything", "domain-graph.json"), {
    version: "1.0.0",
    kind: "domain-sharded",
    source: { codeManifest: "knowledge-graph.json" },
    shards: [{ id: "home", path: "domain-shards/home.json", sourceCodeShard: "shards/home.json" }],
    warnings: [],
    update: {
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        home: { artifactHash: domainArtifactHash, sourceCodeArtifactHash: "sha256:old-home" },
      },
    },
  });
  writeJson(join(root, ".understand-anything", "product-index.json"), {
    version: "1.0.0",
    kind: "product-sharded",
    source: { codeManifest: "knowledge-graph.json", domainManifest: "domain-graph.json" },
    shards: [
      {
        id: "home",
        path: "product-shards/home.json",
        tracePath: "product-traces/home.json",
        sourceCodeShard: "shards/home.json",
        sourceDomainShard: "domain-shards/home.json",
      },
    ],
    warnings: [],
    update: {
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        home: {
          artifactHash: productArtifactHash,
          traceArtifactHash: "sha256:old-trace",
          sourceCodeArtifactHash: "sha256:old-home",
          sourceDomainArtifactHash: domainArtifactHash,
        },
      },
    },
  });
  writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
    version: "1.0.0",
    runId: "run-current",
    baseCommitHash: "base",
    headCommitHash: "head",
    status: "ready",
    changedFiles: [],
    shards: [],
    downstream: {
      domain: {
        requested: options.withDomain !== false,
        shardsToRebuild: options.withDomain === false ? [] : ["home"],
      },
      product: {
        requested: options.withProduct !== false,
        shardsToRebuild: options.withProduct === false ? [] : ["home"],
      },
    },
    warnings: [],
  });
}

describe("sharded update workflow commit", () => {
  it("plan assemble-shard and commit complete add delete modify updates", () => {
    const root = initRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "modify.ts"), "export function oldName() {}\n", "utf-8");
    writeFileSync(join(root, "src", "delete.ts"), "export function removeMe() {}\n", "utf-8");
    writeFileSync(join(root, "src", "keep.ts"), "export function keep() {}\n", "utf-8");
    writeJson(join(root, ".understand-anything", "shards", "app.json"), {
      version: "1.0.0",
      project: {
        name: "Demo",
        languages: ["ts"],
        frameworks: [],
        description: "Demo",
        analyzedAt: "2026-05-21T00:00:00.000Z",
        gitCommitHash: "base",
      },
      shard: { id: "app", scopes: ["src"] },
      nodes: [
        {
          id: "file:src/modify.ts",
          type: "file",
          name: "modify.ts",
          filePath: "src/modify.ts",
          summary: "Modify",
          tags: ["modify"],
          complexity: "simple",
        },
        {
          id: "function:src/modify.ts:oldName",
          type: "function",
          name: "oldName",
          filePath: "src/modify.ts",
          summary: "oldName",
          tags: ["fn"],
          complexity: "simple",
        },
        {
          id: "file:src/delete.ts",
          type: "file",
          name: "delete.ts",
          filePath: "src/delete.ts",
          summary: "Delete",
          tags: ["delete"],
          complexity: "simple",
        },
        {
          id: "function:src/delete.ts:removeMe",
          type: "function",
          name: "removeMe",
          filePath: "src/delete.ts",
          summary: "removeMe",
          tags: ["fn"],
          complexity: "simple",
        },
        {
          id: "file:src/keep.ts",
          type: "file",
          name: "keep.ts",
          filePath: "src/keep.ts",
          summary: "Keep",
          tags: ["keep"],
          complexity: "simple",
        },
        {
          id: "function:src/keep.ts:keep",
          type: "function",
          name: "keep",
          filePath: "src/keep.ts",
          summary: "keep",
          tags: ["fn"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/modify.ts",
          target: "function:src/modify.ts:oldName",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
        {
          source: "file:src/delete.ts",
          target: "function:src/delete.ts:removeMe",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
        {
          source: "file:src/keep.ts",
          target: "function:src/keep.ts:keep",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
      ],
      layers: [{ id: "base", nodeIds: ["file:src/modify.ts", "file:src/delete.ts", "file:src/keep.ts"] }],
      tour: [{ title: "Base", nodeIds: ["file:src/modify.ts", "file:src/delete.ts", "file:src/keep.ts"] }],
    });
    writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 6, edgeCount: 3, shardCount: 1 },
      shards: [{ id: "app", path: "shards/app.json", scopes: ["src"] }],
      warnings: [],
    });
    const base = commitAll(root, "base");
    const shardPath = join(root, ".understand-anything", "shards", "app.json");
    const manifestPath = join(root, ".understand-anything", "knowledge-graph.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.update = {
      gitCommitHash: base,
      updatedAt: "2026-05-21T00:00:00.000Z",
      warnings: [],
      shards: {
        app: {
          artifactHash: hashFile(shardPath),
          fingerprintPath: "fingerprints/shards/app.json",
        },
      },
    };
    writeJson(manifestPath, manifest);
    writeJson(join(root, ".understand-anything", "fingerprints", "shards", "app.json"), {
      version: "1.0.0",
      shardId: "app",
      gitCommitHash: base,
      generatedAt: "2026-05-21T00:00:00.000Z",
      files: {
        "src/modify.ts": {
          filePath: "src/modify.ts",
          contentHash: createHash("sha256").update("export function oldName() {}\n").digest("hex"),
          functions: [{ name: "oldName", params: [], exported: true, lineCount: 1 }],
          classes: [],
          imports: [],
          exports: [{ name: "oldName" }],
          totalLines: 2,
          hasStructuralAnalysis: true,
        },
        "src/delete.ts": {
          filePath: "src/delete.ts",
          contentHash: createHash("sha256").update("export function removeMe() {}\n").digest("hex"),
          functions: [{ name: "removeMe", params: [], exported: true, lineCount: 1 }],
          classes: [],
          imports: [],
          exports: [{ name: "removeMe" }],
          totalLines: 2,
          hasStructuralAnalysis: true,
        },
        "src/keep.ts": {
          filePath: "src/keep.ts",
          contentHash: createHash("sha256").update("export function keep() {}\n").digest("hex"),
          functions: [{ name: "keep", params: [], exported: true, lineCount: 1 }],
          classes: [],
          imports: [],
          exports: [{ name: "keep" }],
          totalLines: 2,
          hasStructuralAnalysis: true,
        },
      },
    });

    writeFileSync(join(root, "src", "modify.ts"), "export function newName() {}\n", "utf-8");
    rmSync(join(root, "src", "delete.ts"));
    writeFileSync(join(root, "src", "add.ts"), "export function add() {}\n", "utf-8");
    const head = commitAll(root, "add delete modify");

    execFileSync("node", [workflowScript, root, "plan"], { encoding: "utf-8" });
    const run = JSON.parse(
      readFileSync(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), "utf-8"),
    );
    expect(run.headCommitHash).toBe(head);
    expect(run.shards[0]).toMatchObject({
      id: "app",
      status: "needs-file-analysis",
      structuralFiles: ["src/add.ts", "src/modify.ts"],
      deletedFiles: ["src/delete.ts"],
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "app", "batch-001.json"), {
      runId: run.runId,
      headCommitHash: run.headCommitHash,
      shardId: "app",
      nodes: [
        {
          id: "file:src/modify.ts",
          type: "file",
          name: "modify.ts",
          filePath: "src/modify.ts",
          summary: "Modified",
          tags: ["modify"],
          complexity: "simple",
        },
        {
          id: "function:src/modify.ts:newName",
          type: "function",
          name: "newName",
          filePath: "src/modify.ts",
          summary: "newName",
          tags: ["fn"],
          complexity: "simple",
        },
        {
          id: "file:src/add.ts",
          type: "file",
          name: "add.ts",
          filePath: "src/add.ts",
          summary: "Added",
          tags: ["add"],
          complexity: "simple",
        },
        {
          id: "function:src/add.ts:add",
          type: "function",
          name: "add",
          filePath: "src/add.ts",
          summary: "add",
          tags: ["fn"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/modify.ts",
          target: "function:src/modify.ts:newName",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
        {
          source: "file:src/add.ts",
          target: "function:src/add.ts:add",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
      ],
    });

    execFileSync("node", [workflowScript, root, "assemble-shard", "--shard", "app"], {
      encoding: "utf-8",
    });
    const candidatePath = join(root, ".understand-anything", "intermediate", "sharded", "app", "candidate-shard.json");
    const candidate = JSON.parse(readFileSync(candidatePath, "utf-8"));
    delete candidate.layers;
    delete candidate.tour;
    writeJson(candidatePath, candidate);

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const finalShard = JSON.parse(readFileSync(shardPath, "utf-8"));
    expect(finalShard.runId).toBeUndefined();
    expect(finalShard.headCommitHash).toBeUndefined();
    expect(finalShard.shardId).toBeUndefined();
    expect(finalShard.nodes.map((node) => node.id)).toEqual([
      "file:src/keep.ts",
      "function:src/keep.ts:keep",
      "file:src/modify.ts",
      "function:src/modify.ts:newName",
      "file:src/add.ts",
      "function:src/add.ts:add",
    ]);
    expect(finalShard.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "file:src/keep.ts->function:src/keep.ts:keep",
      "file:src/modify.ts->function:src/modify.ts:newName",
      "file:src/add.ts->function:src/add.ts:add",
    ]);

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.update.gitCommitHash).toBe(head);
    expect(finalManifest.update.warnings).toEqual([]);
    expect(finalManifest.update.shards.app.artifactHash).toBe(hashFile(shardPath));
    expect(finalManifest.overview).toMatchObject({
      nodeCount: finalShard.nodes.length,
      edgeCount: finalShard.edges.length,
      shardCount: 1,
    });
    expect(finalManifest.shards[0]).toMatchObject({
      id: "app",
      nodeCount: finalShard.nodes.length,
      edgeCount: finalShard.edges.length,
    });

    const fingerprints = JSON.parse(
      readFileSync(join(root, ".understand-anything", "fingerprints", "shards", "app.json"), "utf-8"),
    );
    expect(Object.keys(fingerprints.files).sort()).toEqual([
      "src/add.ts",
      "src/keep.ts",
      "src/modify.ts",
    ]);
    expect(fingerprints.files["src/add.ts"].functions.map((fn) => fn.name)).toEqual(["add"]);
    expect(fingerprints.files["src/modify.ts"].functions.map((fn) => fn.name)).toEqual(["newName"]);
    expect(fingerprints.files["src/keep.ts"].functions.map((fn) => fn.name)).toEqual(["keep"]);
    expect(fingerprints.files["src/delete.ts"]).toBeUndefined();
  });

  it("commit accepts structural candidates without layers or tour keys", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      candidate: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
        edges: [],
      },
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/candidate-shard.json",
      },
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    const shard = JSON.parse(
      readFileSync(join(root, ".understand-anything", "shards", "home.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("head");
    expect(shard).not.toHaveProperty("layers");
    expect(shard).not.toHaveProperty("tour");
  });

  it("commit rejects non-noop shards with missing assemble results", () => {
    const root = initRepo();
    writeCommitValidationFixture(root);

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain("home assemble result is missing");
  });

  it("commit rejects failed assemble results and preserves their warning", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "failed",
        warning: "intermediate/sharded/home/batch-001.json is missing",
      },
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain(
      "home assemble result failed: intermediate/sharded/home/batch-001.json is missing",
    );
  });

  it("commit rejects successful assemble results with missing candidate shards", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/missing-candidate.json",
      },
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain("home candidate shard is missing");
  });

  it("commit rejects blocked runs before writing shards or fingerprints", () => {
    const root = initRepo();
    writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 0, edgeCount: 0, shardCount: 0 },
      shards: [],
      warnings: [],
      update: {
        gitCommitHash: "base",
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {},
      },
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
      version: "1.0.0",
      runId: "run-current",
      baseCommitHash: "base",
      headCommitHash: "head",
      status: "blocked",
      changedFiles: ["src/a.ts"],
      shards: [],
      warnings: ["baseline missing"],
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain("sharded update run is blocked");
    expect(existsSync(join(root, ".understand-anything", "fingerprints", "shards"))).toBe(false);
  });

  it("commit rejects assemble result candidate paths outside required output", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      candidatePath: "intermediate/sharded/home/candidate-shard.json",
      candidate: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
        edges: [],
        layers: [{ id: "files", nodeIds: ["file:src/a.ts"] }],
        tour: [{ title: "A", nodeIds: ["file:src/a.ts"] }],
      },
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/alternate-candidate.json",
      },
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "alternate-candidate.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
      edges: [],
      layers: [{ id: "files", nodeIds: ["file:src/a.ts"] }],
      tour: [{ title: "A", nodeIds: ["file:src/a.ts"] }],
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain(
      "home assemble result candidate path does not match required output",
    );
  });

  it("commit accepts structural candidates with external import edges", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      candidate: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        version: "1.0.0",
        shard: { id: "home", scopes: ["src"] },
        nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
        edges: [
          {
            source: "file:src/a.ts",
            target: "file:src/external.ts",
            type: "imports",
            direction: "forward",
            weight: 0.7,
            external: true,
          },
        ],
        layers: [{ id: "files", nodeIds: ["file:src/a.ts"] }],
        tour: [{ title: "A", nodeIds: ["file:src/a.ts"] }],
      },
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/candidate-shard.json",
      },
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.warnings).toEqual([]);
    const shardGraph = JSON.parse(
      readFileSync(join(root, ".understand-anything", "shards", "home.json"), "utf-8"),
    );
    expect(shardGraph.edges).toEqual([
      {
        source: "file:src/a.ts",
        target: "file:src/external.ts",
        type: "imports",
        direction: "forward",
        weight: 0.7,
        external: true,
      },
    ]);
  });

  it("commit validates structural files deleted files and candidate edge endpoints", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      runShard: {
        structuralFiles: ["src/a.ts", "src/missing.ts"],
        deletedFiles: ["src/deleted.ts"],
      },
      candidate: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        nodes: [
          { id: "file:src/a.ts", type: "file", filePath: "src/a.ts" },
          { id: "file:src/deleted.ts", type: "file", filePath: "src/deleted.ts" },
        ],
        edges: [
          {
            source: "file:src/a.ts",
            target: "function:src/missing.ts:missing",
            type: "contains",
            direction: "forward",
            weight: 1,
          },
        ],
        layers: [{ id: "files", nodeIds: ["file:src/a.ts"] }],
        tour: [{ title: "A", nodeIds: ["file:src/a.ts"] }],
      },
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/candidate-shard.json",
      },
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain("home candidate is missing structural file src/missing.ts");
    expect(manifest.update.warnings).toContain("home candidate still contains deleted file src/deleted.ts");
    expect(manifest.update.warnings).toContain(
      "home candidate has dangling edge file:src/a.ts -> function:src/missing.ts:missing",
    );
  });

  it("commit requires structural files to have candidate file nodes", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      candidate: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        nodes: [{ id: "function:src/a.ts:run", type: "function", filePath: "src/a.ts" }],
        edges: [],
        layers: [{ id: "files", nodeIds: ["function:src/a.ts:run"] }],
        tour: [{ title: "A", nodeIds: ["function:src/a.ts:run"] }],
      },
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/candidate-shard.json",
      },
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain("home candidate is missing structural file src/a.ts");
  });

  it("commit does not partially write valid shards when another shard is invalid", () => {
    const root = initRepo();
    mkdirSync(join(root, "home"), { recursive: true });
    writeFileSync(join(root, "home", "Home.ts"), "export function home() {}\n", "utf-8");
    writeJson(join(root, ".understand-anything", "shards", "home.json"), {
      version: "1.0.0",
      shard: { id: "home", scopes: ["home"] },
      nodes: [{ id: "file:home/Home.ts", type: "file", filePath: "home/Home.ts", summary: "old" }],
      edges: [],
      layers: [],
      tour: [],
    });
    const originalHomeShard = readFileSync(
      join(root, ".understand-anything", "shards", "home.json"),
      "utf-8",
    );
    writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 2, edgeCount: 0, shardCount: 2 },
      shards: [
        { id: "home", path: "shards/home.json", scopes: ["home"] },
        { id: "player", path: "shards/player.json", scopes: ["player"] },
      ],
      warnings: [],
      update: {
        gitCommitHash: "base",
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          home: { artifactHash: "sha256:old-home", fingerprintPath: "fingerprints/shards/home.json" },
          player: { artifactHash: "sha256:old-player", fingerprintPath: "fingerprints/shards/player.json" },
        },
      },
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
      version: "1.0.0",
      runId: "run-current",
      baseCommitHash: "base",
      headCommitHash: "head",
      status: "ready",
      changedFiles: ["home/Home.ts", "player/Player.ts"],
      shards: [
        {
          id: "home",
          path: "shards/home.json",
          scopes: ["home"],
          status: "needs-file-analysis",
          changedFiles: ["home/Home.ts"],
          structuralFiles: ["home/Home.ts"],
          deletedFiles: [],
          requiredOutputs: {
            fileAnalyzerBatches: ["intermediate/sharded/home/batch-001.json"],
            candidateShard: "intermediate/sharded/home/candidate-shard.json",
            assembleResult: "intermediate/sharded/home/assemble-result.json",
          },
        },
        {
          id: "player",
          path: "shards/player.json",
          scopes: ["player"],
          status: "needs-file-analysis",
          changedFiles: ["player/Player.ts"],
          structuralFiles: ["player/Player.ts"],
          deletedFiles: [],
          requiredOutputs: {
            fileAnalyzerBatches: ["intermediate/sharded/player/batch-001.json"],
            candidateShard: "intermediate/sharded/player/candidate-shard.json",
            assembleResult: "intermediate/sharded/player/assemble-result.json",
          },
        },
      ],
      warnings: [],
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "candidate-shard.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      version: "1.0.0",
      shard: { id: "home", scopes: ["home"] },
      nodes: [{ id: "file:home/Home.ts", type: "file", filePath: "home/Home.ts", summary: "new" }],
      edges: [],
      layers: [{ id: "files", nodeIds: ["file:home/Home.ts"] }],
      tour: [{ title: "Home", nodeIds: ["file:home/Home.ts"] }],
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "assemble-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      candidatePath: "intermediate/sharded/home/candidate-shard.json",
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "player", "assemble-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "player",
      status: "success",
      candidatePath: "intermediate/sharded/player/candidate-shard.json",
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(readFileSync(join(root, ".understand-anything", "shards", "home.json"), "utf-8")).toBe(
      originalHomeShard,
    );
    expect(existsSync(join(root, ".understand-anything", "fingerprints", "shards", "home.json"))).toBe(false);
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.shards.home.artifactHash).toBe("sha256:old-home");
    expect(manifest.update.warnings).toContain("player candidate shard is missing");
  });

  it("commit with downstream flags writes code metadata without advancing git commit", () => {
    const root = initRepo();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export function a() {}\n", "utf-8");
    writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 0, edgeCount: 0, shardCount: 1 },
      shards: [{ id: "home", path: "shards/home.json", scopes: ["src"] }],
      warnings: [],
      update: {
        gitCommitHash: "base",
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          home: { artifactHash: "sha256:old-home", fingerprintPath: "fingerprints/shards/home.json" },
        },
      },
    });
    writeJson(join(root, ".understand-anything", "domain-graph.json"), {
      version: "1.0.0",
      kind: "domain-sharded",
      source: { codeManifest: "knowledge-graph.json" },
      shards: [{ id: "home", path: "domain-shards/home.json", sourceCodeShard: "shards/home.json" }],
      warnings: [],
      update: { updatedAt: "2026-05-21T00:00:00.000Z", warnings: [], shards: {} },
    });
    writeCommitValidationFixture(root, {
      candidate: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        version: "1.0.0",
        shard: { id: "home", scopes: ["src"] },
        nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
        edges: [],
        layers: [{ id: "files", nodeIds: ["file:src/a.ts"] }],
        tour: [{ title: "A", nodeIds: ["file:src/a.ts"] }],
      },
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/candidate-shard.json",
      },
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain"], { encoding: "utf-8" });

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.shards.home.artifactHash).toMatch(/^sha256:/);
    expect(manifest.update.shards.home.artifactHash).not.toBe("sha256:old-home");
    expect(manifest.update.warnings).toEqual([]);
  });

  it("commit does not accept old downstream shard files without current-run results", () => {
    const root = initRepo();
    writeJson(join(root, ".understand-anything", "shards", "home.json"), {
      version: "1.0.0",
      shard: { id: "home", scopes: ["home"] },
      nodes: [{ id: "file:home/Home.ts", type: "file", filePath: "home/Home.ts" }],
      edges: [],
      layers: [],
      tour: [],
    });
    writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 1, edgeCount: 0, shardCount: 1 },
      shards: [{ id: "home", path: "shards/home.json", scopes: ["home"] }],
      warnings: [],
      update: {
        gitCommitHash: "base",
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          home: { artifactHash: "sha256:code-home", fingerprintPath: "fingerprints/shards/home.json" },
        },
      },
    });
    writeJson(join(root, ".understand-anything", "domain-graph.json"), {
      version: "1.0.0",
      kind: "domain-sharded",
      source: { codeManifest: "knowledge-graph.json" },
      shards: [{ id: "home", path: "domain-shards/home.json", sourceCodeShard: "shards/home.json" }],
      warnings: [],
      update: {
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          home: { artifactHash: "sha256:old-domain", sourceCodeArtifactHash: "sha256:old-code" },
        },
      },
    });
    writeJson(join(root, ".understand-anything", "domain-shards", "home.json"), {
      version: "1.0.0",
      shard: { id: "home" },
      flows: [{ id: "flow:old-home", title: "Old Home" }],
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
      version: "1.0.0",
      runId: "run-current",
      baseCommitHash: "base",
      headCommitHash: "head",
      status: "ready",
      changedFiles: [],
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

    const manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain("home domain rebuild result is missing for current run");
  });

  it("commit advances and writes downstream metadata after current-run domain and product results validate", () => {
    const root = initRepo();
    writeDownstreamCommitFixture(root);
    writeJson(join(root, ".understand-anything", "intermediate", "domain-shards", "home", "domain-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      artifactHash: "sha256:new-domain",
    });
    writeJson(join(root, ".understand-anything", "intermediate", "product-shards", "home", "product-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      artifactHash: "sha256:new-product",
      traceArtifactHash: "sha256:new-trace",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain", "--with-product"], {
      encoding: "utf-8",
    });

    const codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    const domainManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "domain-graph.json"), "utf-8"),
    );
    const productManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "product-index.json"), "utf-8"),
    );
    expect(codeManifest.update.gitCommitHash).toBe("head");
    expect(codeManifest.update.warnings).toEqual([]);
    expect(domainManifest.update.shards.home).toMatchObject({
      artifactHash: "sha256:new-domain",
      sourceCodeArtifactHash: "sha256:new-home",
      lastRebuiltAt: expect.any(String),
    });
    expect(productManifest.update.shards.home).toMatchObject({
      artifactHash: "sha256:new-product",
      traceArtifactHash: "sha256:new-trace",
      sourceCodeArtifactHash: "sha256:new-home",
      sourceDomainArtifactHash: "sha256:new-domain",
      lastRebuiltAt: expect.any(String),
    });
  });

  it("commit completes downstream rebuilds from its previously written downstream plan", () => {
    const root = initRepo();
    writeJson(join(root, ".understand-anything", "shards", "home.json"), {
      version: "1.0.0",
      shard: { id: "home", scopes: ["home"] },
      nodes: [{ id: "file:home/Home.ts", type: "file", filePath: "home/Home.ts" }],
      edges: [],
      layers: [],
      tour: [],
    });
    writeJson(join(root, ".understand-anything", "knowledge-graph.json"), {
      version: "1.0.0",
      kind: "codebase-sharded",
      project: { name: "Demo" },
      overview: { summary: "Demo", nodeCount: 1, edgeCount: 0, shardCount: 1 },
      shards: [{ id: "home", path: "shards/home.json", scopes: ["home"] }],
      warnings: [],
      update: {
        gitCommitHash: "base",
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          home: { artifactHash: "sha256:old-home", fingerprintPath: "fingerprints/shards/home.json" },
        },
      },
    });
    writeJson(join(root, ".understand-anything", "domain-graph.json"), {
      version: "1.0.0",
      kind: "domain-sharded",
      source: { codeManifest: "knowledge-graph.json" },
      shards: [{ id: "home", path: "domain-shards/home.json", sourceCodeShard: "shards/home.json" }],
      warnings: [],
      update: {
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          home: { artifactHash: "sha256:old-domain", sourceCodeArtifactHash: "sha256:old-home" },
        },
      },
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded-update-run.json"), {
      version: "1.0.0",
      runId: "run-current",
      baseCommitHash: "base",
      headCommitHash: "head",
      status: "ready",
      changedFiles: ["home/Home.ts"],
      shards: [
        {
          id: "home",
          path: "shards/home.json",
          scopes: ["home"],
          status: "needs-file-analysis",
          changedFiles: ["home/Home.ts"],
          structuralFiles: ["home/Home.ts"],
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
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "candidate-shard.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      version: "1.0.0",
      shard: { id: "home", scopes: ["home"] },
      nodes: [
        { id: "file:home/Home.ts", type: "file", filePath: "home/Home.ts" },
        { id: "function:home/Home.ts:next", type: "function", filePath: "home/Home.ts" },
      ],
      edges: [
        {
          source: "file:home/Home.ts",
          target: "function:home/Home.ts:next",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
      ],
      layers: [{ id: "files", nodeIds: ["file:home/Home.ts"] }],
      tour: [{ title: "Home", nodeIds: ["file:home/Home.ts"] }],
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "assemble-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      candidatePath: "intermediate/sharded/home/candidate-shard.json",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain"], { encoding: "utf-8" });

    let codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    const downstreamPlan = JSON.parse(
      readFileSync(
        join(root, ".understand-anything", "intermediate", "sharded-downstream-plan.json"),
        "utf-8",
      ),
    );
    expect(codeManifest.update.gitCommitHash).toBe("base");
    expect(downstreamPlan).toMatchObject({
      runId: "run-current",
      baseCommitHash: "base",
      headCommitHash: "head",
      requested: { domain: true, product: false },
      changedCodeShards: ["home"],
      domainShardsToRebuild: ["home"],
    });

    writeJson(join(root, ".understand-anything", "intermediate", "domain-shards", "home", "domain-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      artifactHash: "sha256:new-domain",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain"], { encoding: "utf-8" });

    codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    const domainManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "domain-graph.json"), "utf-8"),
    );
    expect(codeManifest.update.gitCommitHash).toBe("head");
    expect(codeManifest.update.warnings).toEqual([]);
    expect(domainManifest.update.shards.home).toMatchObject({
      artifactHash: "sha256:new-domain",
      sourceCodeArtifactHash: codeManifest.update.shards.home.artifactHash,
      lastRebuiltAt: expect.any(String),
    });
  });

  it("commit rejects downstream plans that do not belong to the current run", () => {
    const root = initRepo();
    writeDownstreamCommitFixture(root, { withProduct: false });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded-downstream-plan.json"), {
      runId: "run-stale",
      baseCommitHash: "base",
      headCommitHash: "head",
      requested: { domain: true, product: false },
      changedCodeShards: ["home"],
      domainShardsToRebuild: ["home"],
      productShardsToRebuild: [],
      warnings: [],
    });
    writeJson(join(root, ".understand-anything", "intermediate", "domain-shards", "home", "domain-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      artifactHash: "sha256:new-domain",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain"], { encoding: "utf-8" });

    const codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    const domainManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "domain-graph.json"), "utf-8"),
    );
    expect(codeManifest.update.gitCommitHash).toBe("base");
    expect(codeManifest.update.warnings).toContain(
      "sharded downstream plan does not belong to this sharded update run",
    );
    expect(domainManifest.update.shards.home.artifactHash).toBe("sha256:old-domain");
  });

  it("commit with product-only downstream preserves source domain artifact metadata", () => {
    const root = initRepo();
    writeDownstreamCommitFixture(root, {
      withDomain: false,
      domainArtifactHash: "sha256:current-domain",
    });
    writeJson(join(root, ".understand-anything", "intermediate", "product-shards", "home", "product-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      artifactHash: "sha256:new-product",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-product"], { encoding: "utf-8" });

    const codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    const productManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "product-index.json"), "utf-8"),
    );
    expect(codeManifest.update.gitCommitHash).toBe("head");
    expect(productManifest.update.shards.home).toMatchObject({
      artifactHash: "sha256:new-product",
      sourceCodeArtifactHash: "sha256:new-home",
      sourceDomainArtifactHash: "sha256:current-domain",
    });
  });

  it("commit rejects stale downstream results and preserves code commit", () => {
    const root = initRepo();
    writeDownstreamCommitFixture(root, { withProduct: false });
    writeJson(join(root, ".understand-anything", "intermediate", "domain-shards", "home", "domain-update-result.json"), {
      runId: "run-stale",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      artifactHash: "sha256:new-domain",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain"], { encoding: "utf-8" });

    const codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(codeManifest.update.gitCommitHash).toBe("base");
    expect(codeManifest.update.warnings).toContain(
      "home domain rebuild result does not belong to this sharded update run",
    );
  });

  it("commit rejects failed downstream results and missing artifact hashes", () => {
    const root = initRepo();
    writeDownstreamCommitFixture(root);
    writeJson(join(root, ".understand-anything", "intermediate", "domain-shards", "home", "domain-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
    });
    writeJson(join(root, ".understand-anything", "intermediate", "product-shards", "home", "product-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "failed",
      warning: "product rebuild crashed",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain", "--with-product"], {
      encoding: "utf-8",
    });

    const codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(codeManifest.update.gitCommitHash).toBe("base");
    expect(codeManifest.update.warnings).toContain("home domain rebuild result is missing artifactHash");
    expect(codeManifest.update.warnings).toContain("home product rebuild result failed: product rebuild crashed");
  });

  it("commit does not partially write downstream metadata when one requested result fails", () => {
    const root = initRepo();
    writeDownstreamCommitFixture(root);
    writeJson(join(root, ".understand-anything", "intermediate", "domain-shards", "home", "domain-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      artifactHash: "sha256:new-domain",
    });
    writeJson(join(root, ".understand-anything", "intermediate", "product-shards", "home", "product-update-result.json"), {
      runId: "run-current",
      headCommitHash: "head",
      shardId: "home",
      status: "failed",
      warning: "product rebuild crashed",
    });

    execFileSync("node", [workflowScript, root, "commit", "--with-domain", "--with-product"], {
      encoding: "utf-8",
    });

    const codeManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    const domainManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "domain-graph.json"), "utf-8"),
    );
    const productManifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "product-index.json"), "utf-8"),
    );
    expect(codeManifest.update.gitCommitHash).toBe("base");
    expect(domainManifest.update.shards.home.artifactHash).toBe("sha256:old-domain");
    expect(productManifest.update.shards.home.artifactHash).toBe("sha256:old-product");
    expect(codeManifest.update.warnings).toContain("home product rebuild result failed: product rebuild crashed");
  });

  it("commit rejects stale assemble result and candidate metadata", () => {
    const root = initRepo();
    writeCommitValidationFixture(root, {
      candidatePath: "intermediate/sharded/home/stale-candidate.json",
      candidate: {
        runId: "run-stale",
        headCommitHash: "head",
        shardId: "home",
        nodes: [{ id: "file:src/a.ts", type: "file", filePath: "src/a.ts" }],
        edges: [],
        layers: [{ id: "files", nodeIds: ["file:src/a.ts"] }],
        tour: [{ title: "A", nodeIds: ["file:src/a.ts"] }],
      },
      assembleResult: {
        runId: "run-current",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/stale-candidate.json",
      },
    });
    writeJson(join(root, ".understand-anything", "intermediate", "sharded", "home", "stale-assemble-result.json"), {
      runId: "run-stale",
      headCommitHash: "head",
      shardId: "home",
      status: "success",
      candidatePath: "intermediate/sharded/home/candidate-shard.json",
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    let manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain(
      "home candidate shard does not belong to this sharded update run",
    );

    writeCommitValidationFixture(root, {
      assembleResultPath: "intermediate/sharded/home/stale-assemble-result.json",
      assembleResult: {
        runId: "run-stale",
        headCommitHash: "head",
        shardId: "home",
        status: "success",
        candidatePath: "intermediate/sharded/home/candidate-shard.json",
      },
    });

    execFileSync("node", [workflowScript, root, "commit"], { encoding: "utf-8" });

    manifest = JSON.parse(
      readFileSync(join(root, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(manifest.update.gitCommitHash).toBe("base");
    expect(manifest.update.warnings).toContain(
      "home assemble result does not belong to this sharded update run",
    );
  });
});
