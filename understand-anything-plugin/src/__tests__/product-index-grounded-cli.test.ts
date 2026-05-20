import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { runProductIndexCli } from "../product-index-cli.js";

function writeGraph(projectRoot: string): void {
  const dir = join(projectRoot, ".understand-anything");
  mkdirSync(dir, { recursive: true });
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
    edges: [],
    layers: [],
    tour: [],
  };
  writeFileSync(
    join(dir, "knowledge-graph.json"),
    JSON.stringify(graph, null, 2),
    "utf-8",
  );
}

function expectNoFinalOutputs(projectRoot: string): void {
  expect(
    existsSync(join(projectRoot, ".understand-anything/product-signals.jsonl")),
  ).toBe(false);
  expect(
    existsSync(join(projectRoot, ".understand-anything/product-index.json")),
  ).toBe(false);
}

describe("grounded product index cli", () => {
  it("prepares boundary candidates without writing context packs or final facts", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-prepare-"));
    writeGraph(projectRoot);

    const result = await runProductIndexCli([
      projectRoot,
      "--prepare-candidates",
      "--platform",
      "android",
    ]);

    expect(result.contextPacks).toBe(0);
    expect(result.facts).toBe(0);
    expect(result.evidence).toBe(0);
    expect(
      existsSync(
        join(
          projectRoot,
          ".understand-anything/intermediate/product-boundary-candidates.json",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          projectRoot,
          ".understand-anything/intermediate/product-context-packs.json",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(join(projectRoot, ".understand-anything/product-index.json")),
    ).toBe(false);
  });

  it("builds context packs from llm-normalized topics", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-context-"));
    writeGraph(projectRoot);
    await runProductIndexCli([projectRoot, "--prepare-candidates", "--platform", "android"]);

    const candidates = JSON.parse(
      readFileSync(
        join(projectRoot, ".understand-anything/intermediate/product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(projectRoot, ".understand-anything/intermediate/product-topic-normalization.json"),
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
    ]);

    expect(result.contextPacks).toBe(1);
    const packs = JSON.parse(
      readFileSync(
        join(projectRoot, ".understand-anything/intermediate/product-context-packs.json"),
        "utf-8",
      ),
    );
    expect(packs[0].topic.id).toBe("topic:boot-startup");
    expect(packs[0].topic.name).toBe("开机启动处理");
    const perTopicPack = JSON.parse(
      readFileSync(
        join(
          projectRoot,
          ".understand-anything/intermediate/product-context-packs-by-topic/topic_boot-startup.json",
        ),
        "utf-8",
      ),
    );
    expect(perTopicPack.topic.id).toBe("topic:boot-startup");
  });

  it("finalizes product index from per-topic extraction files", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-finalize-"));
    writeGraph(projectRoot);
    await runProductIndexCli([projectRoot, "--prepare-candidates", "--platform", "android"]);
    const candidates = JSON.parse(
      readFileSync(
        join(projectRoot, ".understand-anything/intermediate/product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(projectRoot, ".understand-anything/intermediate/product-topic-normalization.json"),
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
    await runProductIndexCli([projectRoot, "--build-context-packs", "--platform", "android"]);

    const packs = JSON.parse(
      readFileSync(
        join(
          projectRoot,
          ".understand-anything/intermediate/product-context-packs.json",
        ),
        "utf-8",
      ),
    );
    mkdirSync(
      join(
        projectRoot,
        ".understand-anything/intermediate/product-index-extractions-by-topic",
      ),
      { recursive: true },
    );
    writeFileSync(
      join(
        projectRoot,
        ".understand-anything/intermediate/product-index-extractions-by-topic/topic_boot-startup.json",
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
    ]);

    expect(result.topics).toBe(1);
    expect(result.facts).toBe(1);
    expect(result.evidence).toBe(1);
    expect(
      existsSync(
        join(
          projectRoot,
          ".understand-anything/intermediate/product-index-extractions.json",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(projectRoot, ".understand-anything/product-index.json"),
      ),
    ).toBe(true);
    const trace = JSON.parse(
      readFileSync(join(projectRoot, ".understand-anything/product-index-trace.json"), "utf-8"),
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
      writeGraph(projectRoot);

      await expect(runProductIndexCli([projectRoot, ...args])).rejects.toThrow(
        /Choose only one of --prepare-candidates, --build-context-packs, or --finalize\./,
      );
      expectNoFinalOutputs(projectRoot);
    }
  });

  it("rejects fast and default fallback paths", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-strict-"));
    writeGraph(projectRoot);

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
    writeGraph(projectRoot);
    await runProductIndexCli([projectRoot, "--prepare-candidates", "--platform", "android"]);
    const candidates = JSON.parse(
      readFileSync(
        join(projectRoot, ".understand-anything/intermediate/product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(projectRoot, ".understand-anything/intermediate/product-topic-normalization.json"),
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
      runProductIndexCli([projectRoot, "--finalize", "--platform", "android"]),
    ).rejects.toThrow(
      /product-context-packs\.json not found\. 请先运行 \/understand-product --build-context-packs。/,
    );
  });

  it("reports a clear error when finalizing without extraction output", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-no-extractions-"));
    writeGraph(projectRoot);
    await runProductIndexCli([projectRoot, "--prepare-candidates", "--platform", "android"]);
    const candidates = JSON.parse(
      readFileSync(
        join(projectRoot, ".understand-anything/intermediate/product-boundary-candidates.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(projectRoot, ".understand-anything/intermediate/product-topic-normalization.json"),
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
    await runProductIndexCli([projectRoot, "--build-context-packs", "--platform", "android"]);

    await expect(
      runProductIndexCli([projectRoot, "--finalize", "--platform", "android"]),
    ).rejects.toThrow(
      /product-index-extractions-by-topic\/\*\.json or product-index-extractions\.json not found\. LLM analyzer did not write extraction output\./,
    );
  });
});
