import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("product-index CLI", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true });
    }
    mkdirSync(join(testRoot, ".understand-anything"), { recursive: true });
    writeFileSync(
      join(testRoot, ".understand-anything", "knowledge-graph.json"),
      JSON.stringify(graph, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true });
    }
  });

  it("builds product-index.json and product-signals.jsonl", async () => {
    const result = await runProductIndexCli([
      testRoot,
      "--platform",
      "android",
      "--fast",
    ]);
    expect(result.productIndexPath.endsWith("product-index.json")).toBe(true);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-index.json")),
    ).toBe(true);
    expect(
      existsSync(join(testRoot, ".understand-anything", "product-signals.jsonl")),
    ).toBe(true);

    const raw = JSON.parse(
      readFileSync(
        join(testRoot, ".understand-anything", "product-index.json"),
        "utf-8",
      ),
    ) as { topics: unknown[] };
    expect(raw.topics.length).toBeGreaterThan(0);
  });

  it("throws a clear error when knowledge graph is missing", async () => {
    rmSync(join(testRoot, ".understand-anything", "knowledge-graph.json"));
    await expect(
      runProductIndexCli([testRoot, "--platform", "android", "--fast"]),
    ).rejects.toThrow(/knowledge-graph\.json not found/);
  });
});
