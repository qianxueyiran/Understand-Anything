import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import {
  buildCodeManifestUpdate,
  hashArtifactFile,
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
