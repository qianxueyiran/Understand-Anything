import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";
import {
  buildProductBoundaryCandidates,
  buildTopicContextPacks,
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
    const candidates = buildProductBoundaryCandidates(graph([receiver, onReceive, base]));

    expect(candidates.map((candidate) => candidate.rootNodeId)).toContain(receiver.id);
    expect(candidates[0].businessSignals.map((signal) => signal.text)).toContain("开机广播接收入口");
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
      "anchor:function:BootBroadcastReceiver.java:onReceive",
    );
    expect(packs[0].candidateFiles.map((file) => file.filePath)).toContain("app/HomeCoordinator.java");
    expect(packs[0].candidateFiles.find((file) => file.filePath === "app/HomeCoordinator.java")?.anchors).toEqual(
      [],
    );
    expect(packs[0].candidateFiles.map((file) => file.filePath)).not.toContain("common/BaseReceiver.java");
  });
});
