import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import type { KnowledgeGraph } from "../types.js";
import {
  buildAffectedShardPlan,
  buildCodeManifestUpdate,
  hashArtifactFile,
  pruneGraphForChangedFiles,
  type CodebaseShardedManifest,
} from "../sharded-update.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ua-sharded-update-test-"));
});

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

  it("skips shard metadata with paths outside the expected shard file", () => {
    mkdirSync(join(root, ".understand-anything", "shards"), { recursive: true });
    writeFileSync(
      join(root, ".understand-anything", "shards", "home.json"),
      JSON.stringify({ nodes: [{ id: "file:a_home/Home.kt" }], edges: [] }),
      "utf-8",
    );

    const manifest: CodebaseShardedManifest = {
      version: "1.0.0",
      kind: "codebase-sharded",
      shards: [
        {
          id: "home",
          path: "shards/../../outside.json",
        },
      ],
      warnings: [],
    };

    const update = buildCodeManifestUpdate(root, manifest, "abc123");

    expect(update.shards).toEqual({});
    expect(update.warnings).toEqual([
      "Skipped invalid shard metadata for home: expected path shards/home.json",
    ]);
  });

  it("skips shard metadata with invalid shard ids", () => {
    mkdirSync(join(root, ".understand-anything", "shards"), { recursive: true });

    const manifest: CodebaseShardedManifest = {
      version: "1.0.0",
      kind: "codebase-sharded",
      shards: [
        {
          id: "../bad",
          path: "shards/../bad.json",
        },
      ],
      warnings: [],
    };

    const update = buildCodeManifestUpdate(root, manifest, "abc123");

    expect(update.shards).toEqual({});
    expect(update.warnings).toEqual(["Skipped invalid shard id: ../bad"]);
  });
});

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
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          filePath: "src/a.ts",
          summary: "A",
          tags: ["a"],
          complexity: "simple",
        },
        {
          id: "function:src/a.ts:run",
          type: "function",
          name: "run",
          filePath: "src/a.ts",
          summary: "run",
          tags: ["fn"],
          complexity: "simple",
        },
        {
          id: "file:src/b.ts",
          type: "file",
          name: "b.ts",
          filePath: "src/b.ts",
          summary: "B",
          tags: ["b"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/a.ts",
          target: "function:src/a.ts:run",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
        {
          source: "file:src/b.ts",
          target: "function:src/a.ts:run",
          type: "calls",
          direction: "forward",
          weight: 0.8,
        },
      ],
      layers: [],
      tour: [],
    };

    const pruned = pruneGraphForChangedFiles(graph, ["src/a.ts"], []);

    expect(pruned.nodes.map((node) => node.id)).toEqual(["file:src/b.ts"]);
    expect(pruned.edges).toEqual([]);
  });
});
