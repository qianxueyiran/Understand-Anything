import { describe, expect, it } from "vitest";
import {
  buildDomainShardedManifest,
  buildProductShardedManifest,
  getTopLevelKind,
  isValidShardId,
  validateShardId,
} from "../sharded-manifest.js";

describe("sharded manifest helpers", () => {
  it("validates shard ids", () => {
    expect(isValidShardId("home")).toBe(true);
    expect(isValidShardId("a_home-api2")).toBe(true);
    expect(isValidShardId("../home")).toBe(false);
    expect(isValidShardId("home/api")).toBe(false);
    expect(() => validateShardId("../home")).toThrow(/Invalid shard id/);
  });

  it("builds a domain sharded manifest from shard file names", () => {
    const update = {
      updatedAt: "2026-05-21T00:00:00.000Z",
      shards: {
        home: {
          artifactHash: "sha256:domain",
          sourceCodeArtifactHash: "sha256:code",
        },
      },
      warnings: ["kept"],
    };
    const manifest = buildDomainShardedManifest(["home.json", "player.json"], { update });

    expect(manifest).toEqual({
      version: "1.0.0",
      kind: "domain-sharded",
      source: {
        codeManifest: "knowledge-graph.json",
      },
      shards: [
        { id: "home", path: "domain-shards/home.json", sourceCodeShard: "shards/home.json" },
        {
          id: "player",
          path: "domain-shards/player.json",
          sourceCodeShard: "shards/player.json",
        },
      ],
      warnings: [],
      update,
    });
    expect(JSON.stringify(manifest.shards)).not.toMatch(
      /nodeCount|edgeCount|analyzedAt|gitCommitHash|updatedAt/
    );
  });

  it("builds a product sharded manifest from shard and trace file names", () => {
    const update = {
      updatedAt: "2026-05-21T00:00:00.000Z",
      shards: {
        home: {
          artifactHash: "sha256:product",
          traceArtifactHash: "sha256:trace",
          sourceCodeArtifactHash: "sha256:code",
          sourceDomainArtifactHash: "sha256:domain",
        },
      },
      warnings: [],
    };
    const manifest = buildProductShardedManifest({
      productShardFiles: ["home.json", "player.json"],
      domainShardFiles: ["home.json"],
      traceFiles: ["home.json"],
      update,
    });

    expect(manifest).toEqual({
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
          sourceCodeShard: "shards/home.json",
          sourceDomainShard: "domain-shards/home.json",
          tracePath: "product-traces/home.json",
        },
        {
          id: "player",
          path: "product-shards/player.json",
          sourceCodeShard: "shards/player.json",
        },
      ],
      warnings: ["product-shards/player.json has no matching product-traces/player.json"],
      update,
    });
    expect(JSON.stringify(manifest)).not.toMatch(
      /topicCount|factCount|evidenceCount|signalsCount|contextPacksCount/
    );
  });

  it("filters invalid shard file names when building manifests", () => {
    const domainManifest = buildDomainShardedManifest([
      "home.json",
      "../admin.json",
      "home/api.json",
      "settings.yaml",
      "bad.name.json",
      "player.json",
    ]);
    expect(domainManifest.shards.map((shard) => shard.id)).toEqual(["home", "player"]);

    const productManifest = buildProductShardedManifest({
      productShardFiles: ["home.json", "../admin.json", "home/api.json", "settings.yaml"],
      domainShardFiles: ["../home.json", "home.json"],
      traceFiles: ["home/api.json", "home.json"],
    });
    expect(productManifest.shards).toEqual([
      {
        id: "home",
        path: "product-shards/home.json",
        sourceCodeShard: "shards/home.json",
        sourceDomainShard: "domain-shards/home.json",
        tracePath: "product-traces/home.json",
      },
    ]);
    expect(productManifest.warnings).toEqual([]);
  });

  it("gets the top-level kind from manifest-like values", () => {
    expect(getTopLevelKind({ kind: "codebase-sharded", nodes: [] })).toBe("codebase-sharded");
    expect(getTopLevelKind({ kind: null })).toBeUndefined();
    expect(getTopLevelKind({ kind: "" })).toBeUndefined();
    expect(getTopLevelKind(null)).toBeUndefined();
  });
});
