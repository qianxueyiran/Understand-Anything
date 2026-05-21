import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { KnowledgeGraph } from "@understand-anything/core";
import { runProductIndexCli } from "../product-index-cli.js";

const testRoot = join(tmpdir(), "ua-product-index-cli-test");

const graph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "video-app",
    languages: ["kotlin"],
    frameworks: ["android"],
    description: "Video app",
    analyzedAt: "2026-05-18T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "class:player/PlayerActivity.kt:PlayerActivity",
      type: "class",
      name: "PlayerActivity",
      filePath: "player/PlayerActivity.kt",
      summary: "播放页 Activity，包含投屏入口。",
      tags: ["activity", "player", "cast"],
      complexity: "moderate",
      businessSignals: [{ type: "behavior", text: "播放页提供投屏入口" }],
    },
    {
      id: "file:player/PlayerActivity.kt",
      type: "file",
      name: "PlayerActivity.kt",
      filePath: "player/PlayerActivity.kt",
      summary: "播放页文件。",
      tags: ["activity", "player"],
      complexity: "simple",
    },
  ],
  edges: [
    {
      source: "file:player/PlayerActivity.kt",
      target: "class:player/PlayerActivity.kt:PlayerActivity",
      type: "contains",
      direction: "forward",
      weight: 1,
    },
  ],
  layers: [],
  tour: [],
};

function writeGraph(nextGraph: KnowledgeGraph): void {
  writeFileSync(
    join(testRoot, ".understand-anything", "knowledge-graph.json"),
    JSON.stringify(nextGraph, null, 2),
    "utf-8",
  );
}

function writeRootGraph(value: unknown): void {
  writeFileSync(
    join(testRoot, ".understand-anything", "knowledge-graph.json"),
    JSON.stringify(value, null, 2),
    "utf-8",
  );
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function writeShardedRoot(shardId = "home"): void {
  writeRootGraph({
    version: "1.0.0",
    kind: "codebase-sharded",
    shards: [{ id: shardId, path: `shards/${shardId}.json` }],
  });
}

function writeCodeShard(shardId: string, nextGraph: KnowledgeGraph = graph): void {
  writeJson(
    join(testRoot, ".understand-anything", "shards", `${shardId}.json`),
    nextGraph,
  );
}

function readSignals(): Array<{ filePath?: string; nodeId: string }> {
  const content = readFileSync(
    join(testRoot, ".understand-anything", "product-signals.jsonl"),
    "utf-8",
  ).trim();
  return content
    ? content
        .split("\n")
        .map((line) => JSON.parse(line) as { filePath?: string; nodeId: string })
    : [];
}

describe("product-index CLI", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true });
    }
    mkdirSync(join(testRoot, ".understand-anything"), { recursive: true });
    writeGraph(graph);
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true });
    }
  });

  it("prepares boundary candidates without product-index.json", async () => {
    const result = await runProductIndexCli([
      testRoot,
      "--platform",
      "android",
      "--prepare-candidates",
    ]);
    expect(result.productIndexPath.endsWith("product-index.json")).toBe(true);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-index.json")),
    ).toBe(false);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-signals.jsonl")),
    ).toBe(true);

    const raw = JSON.parse(
      readFileSync(
        join(
          testRoot,
          ".understand-anything",
          "intermediate",
          "product-boundary-candidates.json",
        ),
        "utf-8",
      ),
    ) as unknown[];
    expect(raw.length).toBeGreaterThan(0);
  });

  it("prepares candidates for a product shard without writing the root product index", async () => {
    writeShardedRoot();
    writeCodeShard("home");

    const result = await runProductIndexCli([
      testRoot,
      "--platform",
      "android",
      "--prepare-candidates",
      "--shard",
      "home",
    ]);

    expect(result.productIndexPath.endsWith("product-shards/home.json")).toBe(
      true,
    );
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
    expect(result.productSignalsPath?.endsWith("product-shards/home.signals.jsonl")).toBe(
      true,
    );
    expect(
      existsSync(
        join(testRoot, ".understand-anything", "product-shards", "home.signals.jsonl"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          testRoot,
          ".understand-anything",
          "intermediate",
          "product-shards",
          "home",
          "product-signals.jsonl",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-index.json")),
    ).toBe(false);
  });

  it("rejects sharded roots without shard or refresh mode", async () => {
    writeShardedRoot();

    await expect(
      runProductIndexCli([
        testRoot,
        "--platform",
        "android",
        "--prepare-candidates",
      ]),
    ).rejects.toThrow(/--shard <id>.*--refresh-shards/s);
  });

  it("rejects unsafe shard ids", async () => {
    await expect(
      runProductIndexCli([
        testRoot,
        "--platform",
        "android",
        "--prepare-candidates",
        "--shard",
        "../home",
      ]),
    ).rejects.toThrow(/Invalid shard id/);
  });

  it("refreshes the product sharded manifest without reading shard contents", async () => {
    mkdirSync(join(testRoot, ".understand-anything", "product-shards"), {
      recursive: true,
    });
    mkdirSync(join(testRoot, ".understand-anything", "product-traces"), {
      recursive: true,
    });
    mkdirSync(join(testRoot, ".understand-anything", "domain-shards"), {
      recursive: true,
    });
    writeFileSync(
      join(testRoot, ".understand-anything", "product-shards", "home.json"),
      "{not json",
      "utf-8",
    );
    writeFileSync(
      join(testRoot, ".understand-anything", "product-shards", "player.json"),
      "{also not json",
      "utf-8",
    );
    writeJson(
      join(testRoot, ".understand-anything", "product-traces", "home.json"),
      { trace: true },
    );
    writeJson(
      join(testRoot, ".understand-anything", "domain-shards", "home.json"),
      { domain: true },
    );

    await runProductIndexCli([testRoot, "--refresh-shards"]);

    const productIndex = JSON.parse(
      readFileSync(
        join(testRoot, ".understand-anything", "product-index.json"),
        "utf-8",
      ),
    ) as {
      kind: string;
      shards: Array<{
        id: string;
        path: string;
        tracePath?: string;
        sourceCodeShard: string;
        sourceDomainShard?: string;
      }>;
      warnings: string[];
    };
    expect(productIndex.kind).toBe("product-sharded");
    expect(productIndex.shards).toEqual([
      {
        id: "home",
        path: "product-shards/home.json",
        tracePath: "product-traces/home.json",
        sourceCodeShard: "shards/home.json",
        sourceDomainShard: "domain-shards/home.json",
      },
      {
        id: "player",
        path: "product-shards/player.json",
        sourceCodeShard: "shards/player.json",
      },
    ]);
    expect(productIndex.warnings).toContain(
      "product-shards/player.json has no matching product-traces/player.json",
    );
    expect(JSON.stringify(productIndex)).not.toMatch(
      /topicCount|factCount|evidenceCount|signalsCount|contextPacksCount|coverage|quality/,
    );
  });

  it("finalizes a product shard and refreshes the root product manifest", async () => {
    writeShardedRoot();
    writeCodeShard("home", {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0],
          businessSignals: [{ type: "behavior", text: "播放页提供投屏入口" }],
        },
        graph.nodes[1],
      ],
    });
    writeJson(
      join(testRoot, ".understand-anything", "domain-shards", "home.json"),
      graph,
    );
    await runProductIndexCli([
      testRoot,
      "--platform",
      "android",
      "--prepare-candidates",
      "--shard",
      "home",
    ]);

    const intermediateDir = join(
      testRoot,
      ".understand-anything",
      "intermediate",
      "product-shards",
      "home",
    );
    const candidates = JSON.parse(
      readFileSync(
        join(intermediateDir, "product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeJson(join(intermediateDir, "product-topic-normalization.json"), {
      topics: [
        {
          id: "topic:player",
          name: "播放页",
          summary: "播放页包含投屏入口。",
          kind: "capability",
          sourceCandidateIds: [candidates[0].id],
          rootNodeIds: [candidates[0].rootNodeId],
          domainRefs: [],
          confidence: "confirmed",
        },
      ],
      discardedCandidates: [],
      sourceReads: [],
      warnings: [],
    });

    await runProductIndexCli([
      testRoot,
      "--platform",
      "android",
      "--build-context-packs",
      "--shard",
      "home",
    ]);
    const packs = JSON.parse(
      readFileSync(join(intermediateDir, "product-context-packs.json"), "utf-8"),
    );
    writeJson(
      join(
        intermediateDir,
        "product-index-extractions-by-topic",
        "topic_player.json",
      ),
      {
        topicId: packs[0].topic.id,
        sourceReads: [
          {
            fileId: packs[0].candidateFiles[0].fileId,
            filePath: packs[0].candidateFiles[0].filePath,
            reason: "确认播放页入口。",
          },
        ],
        usedFiles: [
          {
            fileId: packs[0].candidateFiles[0].fileId,
            reason: "承载播放页能力",
          },
        ],
        ignoredFiles: [],
        facts: [
          {
            type: "behavior",
            text: "播放页提供投屏入口。",
            conditions: ["用户打开播放页"],
            evidenceRefs: [packs[0].candidateFiles[0].anchors[0].anchorId],
            confidence: "confirmed",
          },
        ],
      },
    );

    const result = await runProductIndexCli([
      testRoot,
      "--platform",
      "android",
      "--finalize",
      "--shard",
      "home",
    ]);

    expect(result.productIndexPath.endsWith("product-shards/home.json")).toBe(true);
    expect(result.tracePath?.endsWith("product-traces/home.json")).toBe(true);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-shards", "home.json")),
    ).toBe(true);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-traces", "home.json")),
    ).toBe(true);
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
    expect(productIndex.sources.knowledgeGraph.path).toBe(
      ".understand-anything/shards/home.json",
    );
    expect(productIndex.sources.domainGraph?.path).toBe(
      ".understand-anything/domain-shards/home.json",
    );
    const productManifest = JSON.parse(
      readFileSync(join(testRoot, ".understand-anything", "product-index.json"), "utf-8"),
    ) as { kind: string; shards: Array<{ id: string; path: string; tracePath?: string }> };
    expect(productManifest.kind).toBe("product-sharded");
    expect(productManifest.shards).toEqual([
      {
        id: "home",
        path: "product-shards/home.json",
        sourceCodeShard: "shards/home.json",
        sourceDomainShard: "domain-shards/home.json",
        tracePath: "product-traces/home.json",
      },
    ]);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-index-trace.json")),
    ).toBe(false);
  });

  it("throws a clear error when knowledge graph is missing", async () => {
    rmSync(join(testRoot, ".understand-anything", "knowledge-graph.json"));
    await expect(
      runProductIndexCli([testRoot, "--platform", "android", "--prepare-candidates"]),
    ).rejects.toThrow(/knowledge-graph\.json not found/);
  });

  it("rejects unknown CLI flags", async () => {
    await expect(runProductIndexCli([testRoot, "--unknown"])).rejects.toThrow(
      /Unknown option: --unknown/,
    );
  });

  it("rejects flag-like project roots with usage error", async () => {
    await expect(runProductIndexCli(["--unknown"])).rejects.toThrow(/Usage:/);
    await expect(runProductIndexCli(["--prepare-candidates"])).rejects.toThrow(/Usage:/);
  });

  it("rejects value flags with missing values", async () => {
    await expect(runProductIndexCli([testRoot, "--platform"])).rejects.toThrow(
      /Missing value for --platform/,
    );
    await expect(
      runProductIndexCli([testRoot, "--platform", "--prepare-candidates"]),
    ).rejects.toThrow(/Missing value for --platform/);
  });

  it("rejects numeric flags unless they are positive integers", async () => {
    for (const value of ["abc", "Infinity", "0", "-1", "1.5"]) {
      await expect(
        runProductIndexCli([testRoot, "--prepare-candidates", "--max-depth", value]),
      ).rejects.toThrow(/--max-depth must be a positive integer/);
    }
  });

  it("writes project-relative signal paths for in-project absolute file paths", async () => {
    const filePath = resolve(testRoot, "player/PlayerActivity.kt");
    writeGraph({
      ...graph,
      nodes: [{ ...graph.nodes[0], filePath }],
    });

    await runProductIndexCli([testRoot, "--platform", "android", "--prepare-candidates"]);

    expect(readSignals()[0].filePath).toBe("player/PlayerActivity.kt");
  });

  it("does not write unsafe signal file paths to the sidecar", async () => {
    const unsafePaths = [
      "/tmp/outside/PlayerActivity.kt",
      "/Users/private-user/outsideSecret/PlayerActivity.kt",
      "C:\\repo\\player\\PlayerActivity.kt",
      "\\\\server\\share\\PlayerActivity.kt",
      "app\\src\\main\\PlayerActivity.kt",
      "src\u0000/player/PlayerActivity.kt",
      "src//PlayerActivity.kt",
      "../outside/PlayerActivity.kt",
    ];

    writeGraph({
      ...graph,
      nodes: unsafePaths.map((filePath, index) => ({
        ...graph.nodes[0],
        id: `class:unsafe-${index}:PlayerActivity`,
        filePath,
      })),
    });

    await runProductIndexCli([testRoot, "--platform", "android", "--prepare-candidates"]);

    const signalContent = readFileSync(
      join(testRoot, ".understand-anything", "product-signals.jsonl"),
      "utf-8",
    );
    const candidatesContent = readFileSync(
      join(
        testRoot,
        ".understand-anything",
        "intermediate",
        "product-boundary-candidates.json",
      ),
      "utf-8",
    );
    for (const filePath of unsafePaths) {
      expect(signalContent).not.toContain(filePath);
      expect(candidatesContent).not.toContain(filePath);
    }
    for (const sensitiveToken of ["Users", "private-user", "outsideSecret"]) {
      expect(signalContent).not.toContain(sensitiveToken);
      expect(candidatesContent).not.toContain(sensitiveToken);
    }
    expect(readSignals().every((signal) => signal.filePath === undefined)).toBe(
      true,
    );
  });
});
