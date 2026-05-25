import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import type { KnowledgeGraph } from "../types.js";
import {
  buildAffectedShardPlan,
  buildCodeManifestUpdate,
  buildDomainManifestUpdate,
  buildProductManifestUpdate,
  buildShardedUpdatePlan,
  buildTransactionalCodeManifestUpdate,
  classifyAffectedShardChanges,
  hashArtifactFile,
  saveShardedUpdatePlan,
  type CodebaseShardedManifest,
} from "../sharded-update.js";
import { pruneGraphForChangedFiles } from "../incremental-update.js";
import type { DomainShardedManifest, ProductShardedManifest } from "../sharded-manifest.js";
import type { FingerprintStore } from "../fingerprint.js";
import type { PluginRegistry } from "../plugins/registry.js";

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

  it("keeps global git commit at base when any requested shard update fails", () => {
    mkdirSync(join(root, ".understand-anything", "shards"), { recursive: true });
    writeFileSync(
      join(root, ".understand-anything", "shards", "home.json"),
      JSON.stringify({ nodes: [{ id: "file:a_home/Home.kt" }], edges: [] }),
      "utf-8",
    );
    writeFileSync(
      join(root, ".understand-anything", "shards", "player.json"),
      JSON.stringify({ nodes: [{ id: "file:a_player/Player.kt" }], edges: [] }),
      "utf-8",
    );

    const manifest: CodebaseShardedManifest = {
      version: "1.0.0",
      kind: "codebase-sharded",
      shards: [
        { id: "home", path: "shards/home.json", scopes: ["a_home"] },
        { id: "player", path: "shards/player.json", scopes: ["a_player"] },
      ],
      warnings: [],
      update: {
        gitCommitHash: "base",
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          home: {
            artifactHash: "sha256:old-home",
            fingerprintPath: "fingerprints/shards/home.json",
          },
          player: {
            artifactHash: "sha256:old-player",
            fingerprintPath: "fingerprints/shards/player.json",
          },
        },
      },
    };

    const update = buildTransactionalCodeManifestUpdate({
      projectRoot: root,
      manifest,
      headCommitHash: "head",
      successfulShardIds: ["home"],
      failedShardIds: ["player"],
      warnings: ["player failed"],
      now: "2026-05-22T00:00:00.000Z",
    });

    expect(update.gitCommitHash).toBe("base");
    expect(update.shards.home.artifactHash).toBe(
      hashArtifactFile(join(root, ".understand-anything", "shards", "home.json")),
    );
    expect(update.shards.player.artifactHash).toBe("sha256:old-player");
    expect(update.warnings).toContain("player failed");
  });

  it("advances global git commit only when all requested code shards succeed", () => {
    mkdirSync(join(root, ".understand-anything", "shards"), { recursive: true });
    writeFileSync(
      join(root, ".understand-anything", "shards", "home.json"),
      JSON.stringify({ nodes: [{ id: "file:a_home/Home.kt" }], edges: [] }),
      "utf-8",
    );
    writeFileSync(
      join(root, ".understand-anything", "shards", "player.json"),
      JSON.stringify({ nodes: [{ id: "file:a_player/Player.kt" }], edges: [] }),
      "utf-8",
    );

    const manifest: CodebaseShardedManifest = {
      version: "1.0.0",
      kind: "codebase-sharded",
      shards: [
        { id: "home", path: "shards/home.json", scopes: ["a_home"] },
        { id: "player", path: "shards/player.json", scopes: ["a_player"] },
      ],
      warnings: [],
      update: {
        gitCommitHash: "base",
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: ["old warning"],
        shards: {
          home: {
            artifactHash: "sha256:old-home",
            fingerprintPath: "fingerprints/shards/home.json",
          },
          player: {
            artifactHash: "sha256:old-player",
            fingerprintPath: "fingerprints/shards/player.json",
          },
        },
      },
    };

    const update = buildTransactionalCodeManifestUpdate({
      projectRoot: root,
      manifest,
      headCommitHash: "head",
      successfulShardIds: ["home", "player"],
      failedShardIds: [],
      warnings: [],
      now: "2026-05-22T00:00:00.000Z",
    });

    expect(update.gitCommitHash).toBe("head");
    expect(update.shards.home.artifactHash).toBe(
      hashArtifactFile(join(root, ".understand-anything", "shards", "home.json")),
    );
    expect(update.shards.player.artifactHash).toBe(
      hashArtifactFile(join(root, ".understand-anything", "shards", "player.json")),
    );
    expect(update.warnings).toEqual([]);
  });

  it("builds domain update metadata for rebuilt shards only", () => {
    mkdirSync(join(root, ".understand-anything", "domain-shards"), { recursive: true });
    writeFileSync(
      join(root, ".understand-anything", "domain-shards", "home.json"),
      JSON.stringify({ nodes: [{ id: "flow:home" }], edges: [] }),
      "utf-8",
    );

    const manifest: DomainShardedManifest = {
      version: "1.0.0",
      kind: "domain-sharded",
      source: { codeManifest: "knowledge-graph.json" },
      shards: [
        { id: "home", path: "domain-shards/home.json", sourceCodeShard: "shards/home.json" },
        { id: "player", path: "domain-shards/player.json", sourceCodeShard: "shards/player.json" },
      ],
      warnings: [],
      update: {
        updatedAt: "2026-05-21T00:00:00.000Z",
        warnings: [],
        shards: {
          player: {
            artifactHash: "sha256:old-player-domain",
            sourceCodeArtifactHash: "sha256:old-player-code",
            lastRebuiltAt: "2026-05-21T00:00:00.000Z",
          },
        },
      },
    };
    const codeUpdate = {
      gitCommitHash: "head",
      updatedAt: "2026-05-22T00:00:00.000Z",
      warnings: [],
      shards: {
        home: { artifactHash: "sha256:home-code" },
        player: { artifactHash: "sha256:player-code" },
      },
    };

    const update = buildDomainManifestUpdate(
      root,
      manifest,
      ["home"],
      codeUpdate,
      "2026-05-22T00:00:00.000Z",
    );

    expect(update.shards.home.artifactHash).toBe(
      hashArtifactFile(join(root, ".understand-anything", "domain-shards", "home.json")),
    );
    expect(update.shards.home.sourceCodeArtifactHash).toBe("sha256:home-code");
    expect(update.shards.home.lastRebuiltAt).toBe("2026-05-22T00:00:00.000Z");
    expect(update.shards.player.artifactHash).toBe("sha256:old-player-domain");
  });

  it("builds product update metadata with trace and source artifact hashes", () => {
    mkdirSync(join(root, ".understand-anything", "product-shards"), { recursive: true });
    mkdirSync(join(root, ".understand-anything", "product-traces"), { recursive: true });
    writeFileSync(
      join(root, ".understand-anything", "product-shards", "home.json"),
      JSON.stringify({ topics: [{ id: "home" }] }),
      "utf-8",
    );
    writeFileSync(
      join(root, ".understand-anything", "product-traces", "home.json"),
      JSON.stringify({ trace: [{ id: "home" }] }),
      "utf-8",
    );

    const manifest: ProductShardedManifest = {
      version: "1.0.0",
      kind: "product-sharded",
      source: {
        codeManifest: "knowledge-graph.json",
        domainManifest: "domain-graph.json",
      },
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
    };
    const codeUpdate = {
      gitCommitHash: "head",
      updatedAt: "2026-05-22T00:00:00.000Z",
      warnings: [],
      shards: { home: { artifactHash: "sha256:home-code" } },
    };
    const domainUpdate = {
      updatedAt: "2026-05-22T00:00:00.000Z",
      warnings: [],
      shards: { home: { artifactHash: "sha256:home-domain" } },
    };

    const update = buildProductManifestUpdate(
      root,
      manifest,
      ["home"],
      codeUpdate,
      domainUpdate,
      "2026-05-22T00:00:00.000Z",
    );

    expect(update.shards.home.artifactHash).toBe(
      hashArtifactFile(join(root, ".understand-anything", "product-shards", "home.json")),
    );
    expect(update.shards.home.traceArtifactHash).toBe(
      hashArtifactFile(join(root, ".understand-anything", "product-traces", "home.json")),
    );
    expect(update.shards.home.sourceCodeArtifactHash).toBe("sha256:home-code");
    expect(update.shards.home.sourceDomainArtifactHash).toBe("sha256:home-domain");
    expect(update.shards.home.lastRebuiltAt).toBe("2026-05-22T00:00:00.000Z");
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

  it("skips invalid shard metadata when planning affected shards", () => {
    const plan = buildAffectedShardPlan({
      manifest: {
        ...manifest,
        shards: [
          { id: "../bad", path: "shards/../bad.json", scopes: ["a_home"] },
          { id: "player", path: "shards/../../player.json", scopes: ["a_player"] },
          { id: "home", path: "shards/home.json", scopes: ["a_home"] },
        ],
      },
      changedFiles: ["a_home/src/Home.kt", "a_player/src/Player.kt"],
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
    expect(plan.unmappedChangedFiles).toEqual(["a_player/src/Player.kt"]);
    expect(plan.warnings).toEqual([
      "Skipped invalid shard id: ../bad",
      "Skipped invalid shard metadata for player: expected path shards/player.json",
      "a_player/src/Player.kt did not match any shard",
    ]);
  });

  it("deduplicates repeated changed files in affected plans and warnings", () => {
    const plan = buildAffectedShardPlan({
      manifest,
      changedFiles: [
        "a_home/src/Home.kt",
        "README.md",
        "a_home/src/Home.kt",
        "README.md",
        "unowned/src/Feature.kt",
        "unowned/src/Feature.kt",
      ],
      knownShardGraphs: {},
      sourceFileExtensions: [".kt"],
    });

    expect(plan.changedFiles).toEqual([
      "a_home/src/Home.kt",
      "README.md",
      "unowned/src/Feature.kt",
    ]);
    expect(plan.affectedCodeShards[0].changedFiles).toEqual(["a_home/src/Home.kt"]);
    expect(plan.unmappedChangedFiles).toEqual(["unowned/src/Feature.kt"]);
    expect(plan.warnings).toEqual([
      "README.md did not match any shard",
      "unowned/src/Feature.kt did not match any shard",
    ]);
  });

  it("does not match sibling scope prefixes without a path boundary", () => {
    const plan = buildAffectedShardPlan({
      manifest,
      changedFiles: ["a_home2/src/Home.kt"],
      knownShardGraphs: {},
      sourceFileExtensions: [".kt"],
    });

    expect(plan.affectedCodeShards).toEqual([]);
    expect(plan.unmappedChangedFiles).toEqual(["a_home2/src/Home.kt"]);
    expect(plan.warnings).toEqual(["a_home2/src/Home.kt did not match any shard"]);
  });

  it("maps one changed file to multiple matching shard scopes in manifest order", () => {
    const plan = buildAffectedShardPlan({
      manifest: {
        ...manifest,
        shards: [
          { id: "home", path: "shards/home.json", scopes: ["a_home"] },
          { id: "home-ui", path: "shards/home-ui.json", scopes: ["a_home/src"] },
          { id: "player", path: "shards/player.json", scopes: ["a_player"] },
        ],
      },
      changedFiles: ["a_home/src/Home.kt"],
      knownShardGraphs: {},
      sourceFileExtensions: [".kt"],
    });

    expect(plan.affectedCodeShards.map((shard) => shard.id)).toEqual(["home", "home-ui"]);
    expect(plan.affectedCodeShards.map((shard) => shard.changedFiles)).toEqual([
      ["a_home/src/Home.kt"],
      ["a_home/src/Home.kt"],
    ]);
  });

  it("builds a complete sharded update plan with base and head commits", () => {
    const plan = buildShardedUpdatePlan({
      baseCommitHash: "base123",
      headCommitHash: "head456",
      manifest,
      changedFiles: ["a_home/src/Home.kt"],
      knownShardGraphs: {},
      sourceFileExtensions: [".kt"],
    });

    expect(plan.baseCommitHash).toBe("base123");
    expect(plan.headCommitHash).toBe("head456");
    expect(plan.affectedCodeShards.map((shard) => shard.id)).toEqual(["home"]);
  });

  it("writes sharded update plans to the intermediate directory", () => {
    const plan = buildShardedUpdatePlan({
      baseCommitHash: "base123",
      headCommitHash: "head456",
      manifest,
      changedFiles: ["a_home/src/Home.kt"],
      knownShardGraphs: {},
      sourceFileExtensions: [".kt"],
    });

    const path = saveShardedUpdatePlan(root, plan);

    expect(path.endsWith(".understand-anything/intermediate/sharded-update-plan.json")).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toMatchObject({
      baseCommitHash: "base123",
      headCommitHash: "head456",
      changedFiles: ["a_home/src/Home.kt"],
    });
  });
});

describe("shard change classification", () => {
  const fakeRegistry = {
    analyzeFile(filePath: string, content: string) {
      if (filePath.endsWith(".txt")) return null;
      const functions = Array.from(content.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gu)).map(
        (match) => ({
          name: match[1],
          params: match[2] ? match[2].split(",").map((item) => item.trim()).filter(Boolean) : [],
          lineRange: [1, 1] as [number, number],
        }),
      );
      return { functions, classes: [], imports: [], exports: [] };
    },
  } as unknown as PluginRegistry;

  const fingerprintStore: FingerprintStore = {
    version: "1.0.0",
    gitCommitHash: "base123",
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
      "a_home/src/Deleted.kt": {
        filePath: "a_home/src/Deleted.kt",
        contentHash: "old",
        functions: [{ name: "deleted", params: [], exported: false, lineCount: 1 }],
        classes: [],
        imports: [],
        exports: [],
        totalLines: 1,
        hasStructuralAnalysis: true,
      },
      "a_home/src/Cosmetic.kt": {
        filePath: "a_home/src/Cosmetic.kt",
        contentHash: "old",
        functions: [{ name: "stable", params: [], exported: false, lineCount: 1 }],
        classes: [],
        imports: [],
        exports: [],
        totalLines: 1,
        hasStructuralAnalysis: true,
      },
    },
  };

  it("classifies changed files for an affected shard using its fingerprint store", () => {
    mkdirSync(join(root, "a_home", "src"), { recursive: true });
    writeFileSync(join(root, "a_home", "src", "Home.kt"), "function run() {}\nfunction next() {}\n", "utf-8");
    writeFileSync(join(root, "a_home", "src", "Cosmetic.kt"), "function stable() {}", "utf-8");
    writeFileSync(join(root, "a_home", "src", "New.kt"), "function created() {}", "utf-8");

    const shard = classifyAffectedShardChanges({
      projectRoot: root,
      shard: {
        id: "home",
        path: "shards/home.json",
        scopes: ["a_home"],
        changedFiles: [
          "a_home/src/Home.kt",
          "a_home/src/Cosmetic.kt",
          "a_home/src/New.kt",
          "a_home/src/Deleted.kt",
        ],
        structuralFiles: [],
        cosmeticFiles: [],
        deletedFiles: [],
        reason: "changed file matched shard scope",
      },
      fingerprintStore,
      registry: fakeRegistry,
    });

    expect(shard.structuralFiles).toEqual(["a_home/src/Home.kt", "a_home/src/New.kt"]);
    expect(shard.cosmeticFiles).toEqual(["a_home/src/Cosmetic.kt"]);
    expect(shard.deletedFiles).toEqual(["a_home/src/Deleted.kt"]);
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
