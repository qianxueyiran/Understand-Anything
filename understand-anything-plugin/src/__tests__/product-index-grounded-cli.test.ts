import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { runProductIndexCli } from "../product-index-cli.js";

const shardId = "home";

const graph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "video-app",
    languages: ["java"],
    frameworks: ["Android"],
    description: "Video app",
    analyzedAt: "2026-05-19T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "file:app/BootBroadcastReceiver.java",
      type: "file",
      name: "BootBroadcastReceiver.java",
      filePath: "app/BootBroadcastReceiver.java",
      summary: "Boot receiver source file.",
      tags: ["receiver"],
      complexity: "simple",
      businessSignals: [
        { type: "entry", text: "开机广播入口" },
        { type: "behavior", text: "接收开机广播并启动后续处理" },
      ],
    },
    {
      id: "function:BootBroadcastReceiver.java:onReceive",
      type: "function",
      name: "onReceive",
      filePath: "app/BootBroadcastReceiver.java",
      lineRange: [18, 21],
      summary: "Receives boot broadcasts.",
      tags: ["receiver"],
      complexity: "simple",
      businessSignals: [
        { type: "behavior", text: "接收开机广播并启动后续处理" },
      ],
    },
  ],
  edges: [
    {
      source: "file:app/BootBroadcastReceiver.java",
      target: "function:BootBroadcastReceiver.java:onReceive",
      type: "contains",
      direction: "forward",
      weight: 1,
    },
  ],
  layers: [],
  tour: [],
};

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function writeShardedProject(projectRoot: string): void {
  const dir = join(projectRoot, ".understand-anything");
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "knowledge-graph.json"), {
    version: "1.0.0",
    kind: "codebase-sharded",
    shards: [{ id: shardId, path: `shards/${shardId}.json` }],
  });
  writeJson(join(dir, "shards", `${shardId}.json`), graph);
}

function intermediateDir(projectRoot: string): string {
  return join(
    projectRoot,
    ".understand-anything",
    "intermediate",
    "product-shards",
    shardId,
  );
}

function expectNoFinalOutputs(projectRoot: string): void {
  expect(
    existsSync(
      join(projectRoot, ".understand-anything", "product-shards", `${shardId}.json`),
    ),
  ).toBe(false);
  expect(
    existsSync(join(projectRoot, ".understand-anything", "product-index.json")),
  ).toBe(false);
}

describe("grounded product index cli", () => {
  it("prepares boundary candidates without writing context packs or final facts", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-prepare-"));
    writeShardedProject(projectRoot);

    const result = await runProductIndexCli([
      projectRoot,
      "--prepare-candidates",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);

    expect(result.contextPacks).toBe(0);
    expect(result.facts).toBe(0);
    expect(result.evidence).toBe(0);
    expect(
      existsSync(
        join(intermediateDir(projectRoot), "product-boundary-candidates.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(intermediateDir(projectRoot), "product-context-packs.json"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(projectRoot, ".understand-anything", "product-shards", `${shardId}.json`),
      ),
    ).toBe(false);
  });

  it("builds context packs from llm-normalized topics", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-context-"));
    writeShardedProject(projectRoot);
    await runProductIndexCli([
      projectRoot,
      "--prepare-candidates",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);

    const candidates = JSON.parse(
      readFileSync(
        join(intermediateDir(projectRoot), "product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(intermediateDir(projectRoot), "product-topic-normalization.json"),
      JSON.stringify(
        {
          topics: [
            {
              id: "topic:boot-startup",
              name: "开机启动处理",
              summary: "系统开机广播触发应用初始化和首页数据准备。",
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
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = await runProductIndexCli([
      projectRoot,
      "--build-context-packs",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);

    expect(result.contextPacks).toBe(1);
    const packs = JSON.parse(
      readFileSync(
        join(intermediateDir(projectRoot), "product-context-packs.json"),
        "utf-8",
      ),
    );
    expect(packs[0].topic.id).toBe("topic:boot-startup");
    expect(packs[0].topic.name).toBe("开机启动处理");
    const perTopicPack = JSON.parse(
      readFileSync(
        join(
          intermediateDir(projectRoot),
          "product-context-packs-by-topic",
          "topic_boot-startup.json",
        ),
        "utf-8",
      ),
    );
    expect(perTopicPack.topic.id).toBe("topic:boot-startup");
  });

  it("finalizes product index from per-topic extraction files", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-finalize-"));
    writeShardedProject(projectRoot);
    await runProductIndexCli([
      projectRoot,
      "--prepare-candidates",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);
    const candidates = JSON.parse(
      readFileSync(
        join(intermediateDir(projectRoot), "product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(intermediateDir(projectRoot), "product-topic-normalization.json"),
      JSON.stringify(
        {
          topics: [
            {
              id: "topic:boot-startup",
              name: "开机启动处理",
              summary: "系统开机广播触发应用初始化和首页数据准备。",
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
        },
        null,
        2,
      ),
      "utf-8",
    );
    await runProductIndexCli([
      projectRoot,
      "--build-context-packs",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);

    const packs = JSON.parse(
      readFileSync(
        join(intermediateDir(projectRoot), "product-context-packs.json"),
        "utf-8",
      ),
    );
    mkdirSync(
      join(intermediateDir(projectRoot), "product-index-extractions-by-topic"),
      { recursive: true },
    );
    writeFileSync(
      join(
        intermediateDir(projectRoot),
        "product-index-extractions-by-topic",
        "topic_boot-startup.json",
      ),
      JSON.stringify(
        {
          topicId: packs[0].topic.id,
          sourceReads: [
            {
              fileId: packs[0].candidateFiles[0].fileId,
              filePath: packs[0].candidateFiles[0].filePath,
              reason: "确认开机广播处理。",
            },
          ],
          usedFiles: [
            {
              fileId: packs[0].candidateFiles[0].fileId,
              reason: "承载开机广播处理",
            },
          ],
          ignoredFiles: [],
          facts: [
            {
              type: "behavior",
              text: "应用接收开机广播后会启动后续首页初始化处理。",
              conditions: ["系统发出开机广播"],
              evidenceRefs: [packs[0].candidateFiles[0].anchors[0].anchorId],
              confidence: "confirmed",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = await runProductIndexCli([
      projectRoot,
      "--finalize",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);

    expect(result.topics).toBe(1);
    expect(result.facts).toBe(1);
    expect(result.evidence).toBe(1);
    expect(
      existsSync(
        join(intermediateDir(projectRoot), "product-index-extractions.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(projectRoot, ".understand-anything", "product-shards", `${shardId}.json`),
      ),
    ).toBe(true);
    const trace = JSON.parse(
      readFileSync(
        join(projectRoot, ".understand-anything", "product-traces", `${shardId}.json`),
        "utf-8",
      ),
    );
    expect(trace.mode).toBe("llm-strict");
    expect(trace.boundaryCandidates.length).toBeGreaterThan(0);
    expect(trace.topicNormalization.topics).toHaveLength(1);
    expect(trace.contextPacks).toHaveLength(1);
    expect(trace.extractions).toHaveLength(1);
    expect(trace.extractions[0].sourceReads).toHaveLength(1);
  });

  it("rejects conflicting modes before writing outputs", async () => {
    for (const args of [
      ["--prepare-candidates", "--build-context-packs"],
      ["--prepare-candidates", "--finalize"],
      ["--build-context-packs", "--finalize"],
    ]) {
      const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-conflict-"));
      writeShardedProject(projectRoot);

      await expect(
        runProductIndexCli([projectRoot, ...args, "--shard", shardId]),
      ).rejects.toThrow(
        /Choose only one of --prepare-candidates, --build-context-packs, or --finalize\./,
      );
      expectNoFinalOutputs(projectRoot);
    }
  });

  it("rejects fast and default fallback paths", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-strict-"));
    writeShardedProject(projectRoot);

    await expect(runProductIndexCli([projectRoot, "--platform", "android"])).rejects.toThrow(
      /Please run through \/understand-product or specify one stage:/,
    );
    await expect(runProductIndexCli([projectRoot, "--fast"])).rejects.toThrow(
      /Unknown option: --fast/,
    );
    expectNoFinalOutputs(projectRoot);
  });

  it("reports a clear error when finalizing without context packs", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-no-packs-"));
    writeShardedProject(projectRoot);
    await runProductIndexCli([
      projectRoot,
      "--prepare-candidates",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);
    const candidates = JSON.parse(
      readFileSync(
        join(intermediateDir(projectRoot), "product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(intermediateDir(projectRoot), "product-topic-normalization.json"),
      JSON.stringify(
        {
          topics: [
            {
              id: "topic:boot-startup",
              name: "开机启动处理",
              summary: "系统开机广播触发应用初始化和首页数据准备。",
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
        },
        null,
        2,
      ),
      "utf-8",
    );

    await expect(
      runProductIndexCli([
        projectRoot,
        "--finalize",
        "--platform",
        "android",
        "--shard",
        shardId,
      ]),
    ).rejects.toThrow(
      /product-context-packs\.json not found\. 请先运行 \/understand-product --build-context-packs。/,
    );
  });

  it("reports a clear error when finalizing without extraction output", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-no-extractions-"));
    writeShardedProject(projectRoot);
    await runProductIndexCli([
      projectRoot,
      "--prepare-candidates",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);
    const candidates = JSON.parse(
      readFileSync(
        join(intermediateDir(projectRoot), "product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(intermediateDir(projectRoot), "product-topic-normalization.json"),
      JSON.stringify(
        {
          topics: [
            {
              id: "topic:boot-startup",
              name: "开机启动处理",
              summary: "系统开机广播触发应用初始化和首页数据准备。",
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
        },
        null,
        2,
      ),
      "utf-8",
    );
    await runProductIndexCli([
      projectRoot,
      "--build-context-packs",
      "--platform",
      "android",
      "--shard",
      shardId,
    ]);

    await expect(
      runProductIndexCli([
        projectRoot,
        "--finalize",
        "--platform",
        "android",
        "--shard",
        shardId,
      ]),
    ).rejects.toThrow(
      /product-index-extractions-by-topic\/\*\.json or product-index-extractions\.json not found\. LLM analyzer did not write extraction output\./,
    );
  });
});
