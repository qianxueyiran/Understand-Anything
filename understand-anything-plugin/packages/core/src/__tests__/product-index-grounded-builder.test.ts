import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";
import { validateProductIndex, type ProductCoverageWarning } from "../product-index.js";
import {
  buildProductBoundaryCandidates,
  buildTopicContextPacks,
  finalizeGroundedProductIndex,
  normaliseProductTopics,
} from "../product-index-builder.js";

function node(overrides: Partial<GraphNode> & { id: string; name: string }): GraphNode {
  return {
    type: "class",
    summary: "",
    tags: [],
    complexity: "simple",
    ...overrides,
  };
}

function edge(overrides: Partial<GraphEdge> & { source: string; target: string }): GraphEdge {
  return {
    type: "calls",
    direction: "forward",
    weight: 0.8,
    ...overrides,
  };
}

function graph(nodes: GraphNode[], edges: GraphEdge[] = []): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "video-app",
      languages: ["java"],
      frameworks: ["Android"],
      description: "Video app",
      analyzedAt: "2026-05-19T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes,
    edges,
    layers: [],
    tour: [],
  };
}

describe("grounded product index builder", () => {
  const receiverFile = node({
    id: "file:app/BootBroadcastReceiver.java",
    type: "file",
    name: "BootBroadcastReceiver.java",
    filePath: "app/BootBroadcastReceiver.java",
    summary: "Boot receiver source file.",
  });
  const receiver = node({
    id: "class:BootBroadcastReceiver.java:BootBroadcastReceiver",
    name: "BootBroadcastReceiver",
    filePath: "app/BootBroadcastReceiver.java",
    businessSignals: [{ type: "entry", text: "开机广播接收入口" }],
  });
  const onReceive = node({
    id: "function:BootBroadcastReceiver.java:onReceive",
    type: "function",
    name: "onReceive",
    filePath: "app/BootBroadcastReceiver.java",
    lineRange: [18, 21],
    businessSignals: [{ type: "behavior", text: "接收开机广播并启动后续处理" }],
  });
  const homeTask = node({
    id: "function:HomeBootTask.java:startHomeDataRequest",
    type: "function",
    name: "startHomeDataRequest",
    filePath: "app/HomeBootTask.java",
    lineRange: [31, 65],
    businessSignals: [{ type: "data", text: "开机后首页数据请求" }],
  });
  const homeCoordinator = node({
    id: "class:HomeCoordinator.java:HomeCoordinator",
    name: "HomeCoordinator",
    filePath: "app/HomeCoordinator.java",
    summary: "Coordinates home boot flow.",
  });
  const base = node({
    id: "class:BaseReceiver.java:BaseReceiver",
    name: "BaseReceiver",
    filePath: "common/BaseReceiver.java",
    summary: "Common base receiver.",
    tags: ["base"],
  });

  it("discovers product boundary candidates from graph businessSignals", () => {
    const candidates = buildProductBoundaryCandidates(graph([receiverFile, receiver, onReceive, base]));

    expect(candidates.map((candidate) => candidate.rootNodeId)).toEqual([receiverFile.id]);
    expect(candidates[0].businessSignals.map((signal) => signal.text)).toEqual(
      expect.arrayContaining(["开机广播接收入口", "接收开机广播并启动后续处理"]),
    );
  });

  it("builds compact topic context packs and keeps symbol anchors", () => {
    const kg = graph(
      [receiver, onReceive, homeTask, homeCoordinator, base],
      [
        edge({ source: receiver.id, target: onReceive.id, type: "contains" }),
        edge({ source: receiver.id, target: homeCoordinator.id, type: "calls" }),
        edge({ source: onReceive.id, target: homeTask.id, type: "calls" }),
        edge({ source: receiver.id, target: base.id, type: "inherits", weight: 0.2 }),
      ],
    );
    const topic = normaliseProductTopics([
      {
        id: "candidate:BootBroadcastReceiver",
        rootNodeId: receiver.id,
        name: "BootBroadcastReceiver",
        entryKind: "receiver",
        filePath: receiver.filePath,
        businessSignals: receiver.businessSignals ?? [],
        neighborNodeIds: [onReceive.id],
        domainRefs: [],
      },
    ])[0];

    const packs = buildTopicContextPacks(kg, [topic], { maxFilesPerTopic: 8, maxAnchorsPerFile: 4 });

    expect(packs).toHaveLength(1);
    expect(packs[0].candidateFiles.map((file) => file.filePath)).toContain("app/BootBroadcastReceiver.java");
    expect(packs[0].candidateFiles.flatMap((file) => file.anchors).map((anchor) => anchor.anchorId)).toContain(
      "anchor:function:BootBroadcastReceiver.java:onReceive:0",
    );
    expect(packs[0].candidateFiles.map((file) => file.filePath)).toContain("app/HomeCoordinator.java");
    expect(packs[0].candidateFiles.find((file) => file.filePath === "app/HomeCoordinator.java")?.anchors).toEqual(
      [],
    );
    expect(packs[0].candidateFiles.map((file) => file.filePath)).not.toContain("common/BaseReceiver.java");
  });

  it("builds file-level anchors for file-only graphs", () => {
    const bootFile = node({
      id: "file:app/BootBroadcastReceiver.java",
      type: "file",
      name: "BootBroadcastReceiver.java",
      filePath: "app/BootBroadcastReceiver.java",
      summary: "Boot receiver source file.",
      businessSignals: [
        { type: "entry", text: "开机广播接收入口" },
        { type: "behavior", text: "接收开机广播并启动后续处理" },
      ],
    });
    const homeTaskFile = node({
      id: "file:app/HomeBootTask.java",
      type: "file",
      name: "HomeBootTask.java",
      filePath: "app/HomeBootTask.java",
      businessSignals: [{ type: "data", text: "开机后首页数据请求" }],
    });
    const kg = graph(
      [bootFile, homeTaskFile],
      [edge({ source: bootFile.id, target: homeTaskFile.id, type: "depends_on" })],
    );
    const topic = normaliseProductTopics([
      {
        id: "candidate:file:app/BootBroadcastReceiver.java",
        rootNodeId: bootFile.id,
        name: "BootBroadcastReceiver.java",
        entryKind: "receiver",
        filePath: bootFile.filePath,
        businessSignals: bootFile.businessSignals ?? [],
        neighborNodeIds: [homeTaskFile.id],
        domainRefs: [],
      },
    ])[0];

    const packs = buildTopicContextPacks(kg, [topic], { maxFilesPerTopic: 8, maxAnchorsPerFile: 4 });
    const bootPack = packs[0].candidateFiles.find((file) => file.filePath === bootFile.filePath);

    expect(bootPack?.anchors.map((anchor) => anchor.anchorId)).toEqual([
      "anchor:file:app/BootBroadcastReceiver.java:0",
      "anchor:file:app/BootBroadcastReceiver.java:1",
    ]);
    expect(bootPack?.anchors[0]?.nodeId).toBe(bootFile.id);
    expect(bootPack?.anchors[0]?.lineRange).toBeUndefined();

    const evidenceRef = bootPack!.anchors[0].anchorId;
    const index = finalizeGroundedProductIndex({
      graph: kg,
      topics: [topic],
      contextPacks: packs,
      extractions: [
        {
          topicId: topic.id,
          usedFiles: [{ fileId: `file:${bootFile.filePath}`, reason: "承载开机广播接收" }],
          ignoredFiles: [],
          facts: [
            {
              type: "behavior",
              text: "应用接收开机广播后会启动后续首页初始化处理。",
              conditions: ["系统发出开机广播"],
              evidenceRefs: [evidenceRef],
              confidence: "confirmed",
            },
          ],
        },
      ],
      options: { platform: "android", analyzedAt: "2026-05-19T00:00:00.000Z" },
    });

    expect(index.topics).toHaveLength(1);
    expect(index.evidence).toHaveLength(1);
    expect(index.evidence[0].nodeId).toBe(bootFile.id);
    expect(validateProductIndex(index).success).toBe(true);
  });

  it("recalls business-signal nodes beyond 2 hops up to depth 6", () => {
    const hopA = node({
      id: "file:app/HopA.java",
      type: "file",
      name: "HopA.java",
      filePath: "app/HopA.java",
      summary: "Entry file.",
    });
    const hopB = node({
      id: "file:app/HopB.java",
      type: "file",
      name: "HopB.java",
      filePath: "app/HopB.java",
      summary: "Intermediate file without signals.",
    });
    const hopC = node({
      id: "file:app/HopC.java",
      type: "file",
      name: "HopC.java",
      filePath: "app/HopC.java",
      summary: "Intermediate file without signals.",
    });
    const hopD = node({
      id: "file:app/HopD.java",
      type: "file",
      name: "HopD.java",
      filePath: "app/HopD.java",
      businessSignals: [{ type: "data", text: "深度链路业务信号" }],
    });
    const hopE = node({
      id: "file:app/HopE.java",
      type: "file",
      name: "HopE.java",
      filePath: "app/HopE.java",
      summary: "Too deep without signal.",
    });
    const kg = graph(
      [hopA, hopB, hopC, hopD, hopE],
      [
        edge({ source: hopA.id, target: hopB.id, type: "imports" }),
        edge({ source: hopB.id, target: hopC.id, type: "depends_on" }),
        edge({ source: hopC.id, target: hopD.id, type: "depends_on" }),
        edge({ source: hopD.id, target: hopE.id, type: "imports" }),
      ],
    );
    const topic = normaliseProductTopics([
      {
        id: "candidate:HopA",
        rootNodeId: hopA.id,
        name: "HopA",
        entryKind: "activity",
        filePath: hopA.filePath,
        businessSignals: [],
        neighborNodeIds: [hopB.id],
        domainRefs: [],
      },
    ])[0];

    const packs = buildTopicContextPacks(kg, [topic], { maxFilesPerTopic: 8, maxAnchorsPerFile: 4 });
    const filePaths = packs[0].candidateFiles.map((file) => file.filePath);

    expect(filePaths).toContain("app/HopA.java");
    expect(filePaths).toContain("app/HopB.java");
    expect(filePaths).not.toContain("app/HopC.java");
    expect(filePaths).toContain("app/HopD.java");
    expect(filePaths).not.toContain("app/HopE.java");
    expect(
      packs[0].candidateFiles.find((file) => file.filePath === "app/HopD.java")?.structuralReasons,
    ).toContain("business-signal-reachable");
  });

  it("generates stable unique anchor ids for multiple signals on one node", () => {
    const multiSignalNode = node({
      id: "function:PlaybackRules.java:applyRules",
      type: "function",
      name: "applyRules",
      filePath: "app/PlaybackRules.java",
      lineRange: [12, 28],
      businessSignals: [
        { type: "rule", text: "校验会员播放权限" },
        { type: "data", text: "读取播放配置" },
      ],
    });
    const topic = normaliseProductTopics([
      {
        id: "candidate:PlaybackRules",
        rootNodeId: multiSignalNode.id,
        name: "PlaybackRules",
        entryKind: "handler",
        filePath: multiSignalNode.filePath,
        businessSignals: multiSignalNode.businessSignals ?? [],
        neighborNodeIds: [],
        domainRefs: [],
      },
    ])[0];

    const packs = buildTopicContextPacks(graph([multiSignalNode]), [topic]);
    const anchors = packs[0].candidateFiles.flatMap((file) => file.anchors);

    expect(anchors.map((anchor) => anchor.anchorId)).toEqual([
      "anchor:function:PlaybackRules.java:applyRules:0",
      "anchor:function:PlaybackRules.java:applyRules:1",
    ]);
    expect(new Set(anchors.map((anchor) => anchor.anchorId)).size).toBe(2);
    expect(anchors.map((anchor) => anchor.text)).toEqual(["校验会员播放权限", "读取播放配置"]);
  });

  it("finalizes facts and only promotes referenced anchors to evidence", () => {
    const kg = graph([
      {
        id: "function:BootBroadcastReceiver.java:onReceive",
        type: "function",
        name: "onReceive",
        filePath: "app/BootBroadcastReceiver.java",
        lineRange: [18, 21],
        summary: "Receives boot broadcasts.",
        tags: ["receiver"],
        complexity: "simple",
        businessSignals: [{ type: "behavior", text: "接收开机广播并启动后续处理" }],
      },
    ]);
    const topic = {
      id: "topic:boot-receiver",
      name: "开机广播调起",
      summary: "开机广播触发首页初始化相关业务。",
      kind: "capability" as const,
      sourceCandidateIds: ["candidate:BootBroadcastReceiver"],
      rootNodeIds: ["function:BootBroadcastReceiver.java:onReceive"],
      domainRefs: [],
    };
    const packs = buildTopicContextPacks(kg, [topic]);
    const evidenceRef = packs[0].candidateFiles[0].anchors[0].anchorId;

    const index = finalizeGroundedProductIndex({
      graph: kg,
      topics: [topic],
      contextPacks: packs,
      extractions: [
        {
          topicId: "topic:boot-receiver",
          usedFiles: [{ fileId: "file:app/BootBroadcastReceiver.java", reason: "承载开机广播接收" }],
          ignoredFiles: [],
          facts: [
            {
              type: "behavior",
              text: "应用接收开机广播后会启动后续首页初始化处理。",
              conditions: ["系统发出开机广播"],
              evidenceRefs: [evidenceRef],
              confidence: "confirmed",
            },
          ],
        },
      ],
      options: { platform: "android", analyzedAt: "2026-05-19T00:00:00.000Z" },
    });

    expect(index.topics).toHaveLength(1);
    expect(index.topics[0].facts).toHaveLength(1);
    expect(index.evidence).toHaveLength(1);
    expect(index.topics[0].facts[0].evidenceIds).toEqual([index.evidence[0].id]);
    expect(index.evidence[0].lineRange).toEqual([18, 21]);
    expect(validateProductIndex(index).success).toBe(true);
  });

  it("drops facts without valid evidence refs and removes empty topics", () => {
    const kg = graph([]);
    const topic = {
      id: "topic:empty",
      name: "空主题",
      summary: "没有有效证据。",
      kind: "capability" as const,
      sourceCandidateIds: ["candidate:empty"],
      rootNodeIds: [],
      domainRefs: [],
    };

    const warnings: ProductCoverageWarning[] = [];
    const index = finalizeGroundedProductIndex({
      graph: kg,
      topics: [topic],
      contextPacks: [{ topic, roots: [], candidateFiles: [], overflowFiles: [] }],
      extractions: [
        {
          topicId: "topic:empty",
          usedFiles: [],
          ignoredFiles: [],
          facts: [
            {
              type: "behavior",
              text: "这条事实没有证据。",
              conditions: [],
              evidenceRefs: [],
              confidence: "confirmed",
            },
          ],
        },
      ],
      options: { platform: "android", analyzedAt: "2026-05-19T00:00:00.000Z" },
      warningsSink: warnings,
    });

    expect(index.topics).toHaveLength(0);
    expect(index.evidence).toHaveLength(0);
    expect(warnings.some((warning) => warning.code === "fact-without-evidence")).toBe(true);
  });

  it("merges repeated evidence confidence using the highest confidence independent of fact order", () => {
    const kg = graph([
      {
        id: "function:BootBroadcastReceiver.java:onReceive",
        type: "function",
        name: "onReceive",
        filePath: "app/BootBroadcastReceiver.java",
        lineRange: [18, 21],
        summary: "Receives boot broadcasts.",
        tags: ["receiver"],
        complexity: "simple",
        businessSignals: [{ type: "behavior", text: "接收开机广播并启动后续处理" }],
      },
    ]);
    const topic = {
      id: "topic:boot-receiver",
      name: "开机广播调起",
      summary: "开机广播触发首页初始化相关业务。",
      kind: "capability" as const,
      sourceCandidateIds: ["candidate:BootBroadcastReceiver"],
      rootNodeIds: ["function:BootBroadcastReceiver.java:onReceive"],
      domainRefs: [],
    };
    const packs = buildTopicContextPacks(kg, [topic]);
    const evidenceRef = packs[0].candidateFiles[0].anchors[0].anchorId;
    const inferredFact = {
      type: "behavior" as const,
      text: "开机广播可能触发首页初始化。",
      conditions: ["系统发出开机广播"],
      evidenceRefs: [evidenceRef],
      confidence: "inferred" as const,
    };
    const confirmedFact = {
      type: "behavior" as const,
      text: "开机广播会触发首页初始化。",
      conditions: ["系统发出开机广播"],
      evidenceRefs: [evidenceRef],
      confidence: "confirmed" as const,
    };
    const finalize = (facts: [typeof inferredFact, typeof confirmedFact] | [typeof confirmedFact, typeof inferredFact]) =>
      finalizeGroundedProductIndex({
        graph: kg,
        topics: [topic],
        contextPacks: packs,
        extractions: [
          {
            topicId: "topic:boot-receiver",
            usedFiles: [{ fileId: "file:app/BootBroadcastReceiver.java", reason: "承载开机广播接收" }],
            ignoredFiles: [],
            facts,
          },
        ],
        options: { platform: "android", analyzedAt: "2026-05-19T00:00:00.000Z" },
      });

    const inferredFirstIndex = finalize([inferredFact, confirmedFact]);
    const confirmedFirstIndex = finalize([confirmedFact, inferredFact]);

    for (const index of [inferredFirstIndex, confirmedFirstIndex]) {
      expect(index.topics[0].facts).toHaveLength(2);
      expect(index.evidence).toHaveLength(1);
      expect(index.evidence[0].confidence).toBe("confirmed");
      expect(index.coverage.confirmedEvidence).toBe(1);
    }
  });
});
