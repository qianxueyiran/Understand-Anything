import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function writeGraph(nextGraph: KnowledgeGraph): void {
  writeFileSync(
    join(testRoot, ".understand-anything", "knowledge-graph.json"),
    JSON.stringify(nextGraph, null, 2),
    "utf-8",
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
