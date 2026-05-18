import { describe, expect, it } from "vitest";
import type { KnowledgeGraph, GraphEdge, GraphNode } from "../types.js";
import { validateProductIndex } from "../product-index.js";
import {
  buildDeterministicProductIndex,
  buildProductSignals,
  enumerateProductEntrySeeds,
} from "../product-index-builder.js";

const playerActivityId = "class:player/PlayerActivity.kt:PlayerActivity";
const castManagerId = "function:player/CastManager.kt:checkCastAvailable";
const playbackInfoId = "class:player/model/PlaybackInfo.kt:PlaybackInfo";
const analyticsId = "function:player/AnalyticsTracker.kt:trackCastClick";
const baseActivityId = "class:common/BaseActivity.kt:BaseActivity";
const themeId = "class:common/ThemeRegistry.kt:ThemeRegistry";
const hubId = "class:common/AppContainer.kt:AppContainer";

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
    weight: 0.5,
    ...overrides,
  };
}

const graph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "video-app",
    languages: ["kotlin", "java"],
    frameworks: ["android"],
    description: "Video app",
    analyzedAt: "2026-05-18T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    node({
      id: playerActivityId,
      name: "PlayerActivity",
      filePath: "player/PlayerActivity.kt",
      lineRange: [10, 80],
      summary: "播放页 Activity，包含投屏按钮入口。",
      tags: ["android", "activity", "player", "cast"],
      complexity: "moderate",
    }),
    node({
      id: "class:player/CastFragment.kt:CastFragment",
      name: "CastFragment",
      filePath: "player/CastFragment.kt",
      summary: "投屏设备选择 Fragment。",
      tags: ["android", "fragment", "cast"],
    }),
    node({
      id: "class:routing/PlaybackRouter.kt:PlaybackRouter",
      name: "PlaybackRouter",
      filePath: "routing/PlaybackRouter.kt",
      summary: "播放相关页面路由。",
      tags: ["router", "playback"],
    }),
    node({
      id: "class:player/PlaybackService.kt:PlaybackService",
      name: "PlaybackService",
      filePath: "player/PlaybackService.kt",
      summary: "后台播放 Service。",
      tags: ["service", "playback"],
    }),
    node({
      id: "class:push/PlaybackReceiver.kt:PlaybackReceiver",
      name: "PlaybackReceiver",
      filePath: "push/PlaybackReceiver.kt",
      summary: "处理播放通知 Receiver。",
      tags: ["receiver"],
    }),
    node({
      id: "class:download/DownloadWorker.kt:DownloadWorker",
      name: "DownloadWorker",
      filePath: "download/DownloadWorker.kt",
      summary: "离线下载 Worker。",
      tags: ["worker", "download"],
    }),
    node({
      id: castManagerId,
      type: "function",
      name: "checkCastAvailable",
      filePath: "player/CastManager.kt",
      lineRange: [40, 68],
      summary: "根据 castAllowed 字段和设备状态判断投屏是否可用。",
      tags: ["cast", "rule", "allowed"],
      complexity: "moderate",
    }),
    node({
      id: playbackInfoId,
      name: "PlaybackInfo",
      filePath: "player/model/PlaybackInfo.kt",
      lineRange: [8, 44],
      summary: "服务端下发的播放模型，包含 castAllowed 字段。",
      tags: ["model", "response", "cast"],
    }),
    node({
      id: analyticsId,
      type: "function",
      name: "trackCastClick",
      filePath: "player/AnalyticsTracker.kt",
      lineRange: [20, 26],
      summary: "记录投屏按钮点击事件。",
      tags: ["analytics", "event", "cast"],
    }),
    node({
      id: baseActivityId,
      name: "BaseActivity",
      filePath: "common/BaseActivity.kt",
      summary: "Common base Activity.",
      tags: ["base"],
    }),
    node({
      id: themeId,
      name: "ThemeRegistry",
      filePath: "common/ThemeRegistry.kt",
      summary: "通用主题配置。",
      tags: ["theme"],
    }),
    node({
      id: hubId,
      name: "AppContainer",
      filePath: "common/AppContainer.kt",
      summary: "应用级依赖容器。",
      tags: ["container"],
    }),
    ...Array.from({ length: 4 }, (_, index) =>
      node({
        id: `class:common/Dependency${index}.kt:Dependency${index}`,
        name: `Dependency${index}`,
        filePath: `common/Dependency${index}.kt`,
        summary: "通用依赖。",
        tags: ["common"],
      }),
    ),
  ],
  edges: [
    edge({
      source: playerActivityId,
      target: castManagerId,
      type: "calls",
      weight: 0.9,
    }),
    edge({
      source: castManagerId,
      target: playbackInfoId,
      type: "reads_from",
      weight: 0.8,
    }),
    edge({
      source: playerActivityId,
      target: analyticsId,
      type: "calls",
      weight: 0.7,
    }),
    edge({
      source: playerActivityId,
      target: baseActivityId,
      type: "inherits",
      weight: 0.35,
    }),
    edge({
      source: baseActivityId,
      target: themeId,
      type: "depends_on",
      weight: 0.6,
    }),
    edge({
      source: playerActivityId,
      target: hubId,
      type: "depends_on",
      weight: 1,
    }),
    ...Array.from({ length: 4 }, (_, index) =>
      edge({
        source: hubId,
        target: `class:common/Dependency${index}.kt:Dependency${index}`,
        type: "depends_on",
        weight: 1,
      }),
    ),
  ],
  layers: [],
  tour: [],
};

const domainGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "video-app-domain",
    languages: [],
    frameworks: [],
    description: "Domain graph",
    analyzedAt: "2026-05-18T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    node({
      id: "domain:playback-casting",
      type: "domain",
      name: "PlayerActivity 投屏播放",
      summary: "播放页的 cast 和 DLNA 能力。",
      tags: ["cast"],
    }),
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("product index builder", () => {
  it("enumerates Android entry seeds from entry-like names and paths", () => {
    const seeds = enumerateProductEntrySeeds(graph, { platform: "android" });
    const seedIds = seeds.map((seed) => seed.entryNodeId);

    expect(seedIds).toEqual(
      expect.arrayContaining([
        playerActivityId,
        "class:player/CastFragment.kt:CastFragment",
        "class:routing/PlaybackRouter.kt:PlaybackRouter",
        "class:player/PlaybackService.kt:PlaybackService",
        "class:push/PlaybackReceiver.kt:PlaybackReceiver",
        "class:download/DownloadWorker.kt:DownloadWorker",
      ]),
    );
    expect(seeds.find((seed) => seed.entryNodeId === playerActivityId)?.entryKind).toBe(
      "activity",
    );
    expect(seeds.find((seed) => seed.entryNodeId.endsWith("PlaybackRouter"))?.entryKind).toBe(
      "router",
    );
  });

  it("builds deterministic product signals from node text without LLM", () => {
    const signals = buildProductSignals(graph, { platform: "android" });
    const playerSignal = signals.find((signal) => signal.nodeId === playerActivityId);
    const castSignal = signals.find((signal) => signal.nodeId === castManagerId);

    expect(playerSignal?.types).toContain("entry");
    expect(playerSignal?.types).toContain("ui");
    expect(castSignal?.types).toEqual(expect.arrayContaining(["rule", "integration"]));
    expect(castSignal?.tokens).toEqual(expect.arrayContaining(["cast", "castAllowed"]));
  });

  it("uses weighted expansion limits when building topic evidence", () => {
    const index = buildDeterministicProductIndex(graph, undefined, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 1,
      maxNodesPerTopic: 20,
      maxFrontierPerDepth: 1,
      maxEvidencePerTopic: 2,
      hubDegreeThreshold: 20,
    });
    const playerTopic = index.topics.find((topic) => topic.name === "PlayerActivity");

    expect(playerTopic?.evidenceIds).toHaveLength(2);
    expect(playerTopic?.evidenceIds).toEqual([
      `ev:${playerActivityId}`,
      `ev:${castManagerId}`,
    ]);
    expect(index.evidence.map((evidence) => evidence.nodeId)).not.toContain(playbackInfoId);
  });

  it("respects maxDepth and hubDegreeThreshold during graph expansion", () => {
    const shallow = buildDeterministicProductIndex(graph, undefined, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 1,
      maxNodesPerTopic: 20,
      maxFrontierPerDepth: 10,
      maxEvidencePerTopic: 10,
      hubDegreeThreshold: 20,
    });
    const deepWithHubCutoff = buildDeterministicProductIndex(graph, undefined, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 3,
      maxNodesPerTopic: 20,
      maxFrontierPerDepth: 10,
      maxEvidencePerTopic: 10,
      hubDegreeThreshold: 2,
    });

    expect(shallow.evidence.map((evidence) => evidence.nodeId)).not.toContain(playbackInfoId);
    expect(deepWithHubCutoff.evidence.map((evidence) => evidence.nodeId)).toContain(
      playbackInfoId,
    );
    expect(deepWithHubCutoff.evidence.map((evidence) => evidence.nodeId)).not.toContain(hubId);
  });

  it("builds a valid ProductIndex draft with topics, sources, coverage, and empty facts", () => {
    const index = buildDeterministicProductIndex(graph, domainGraph, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 4,
      maxNodesPerTopic: 20,
      maxFrontierPerDepth: 10,
      maxEvidencePerTopic: 10,
      hubDegreeThreshold: 20,
    });

    expect(index.kind).toBe("product-index");
    expect(index.project).toMatchObject({
      name: "video-app",
      platforms: ["android"],
      analyzedAt: "2026-05-18T00:00:00.000Z",
      gitCommitHash: "abc123",
    });
    expect(index.sources.signals).toMatchObject({
      path: ".understand-anything/product-signals.jsonl",
      available: true,
      truncated: false,
    });
    expect(index.sources.signals?.count).toBeGreaterThan(0);
    expect(index.topics.length).toBeGreaterThan(0);
    expect(index.topics.find((topic) => topic.name === "PlayerActivity")?.domainRefs).toContain(
      "domain:playback-casting",
    );
    expect(index.evidence.map((evidence) => evidence.nodeId)).toEqual(
      expect.arrayContaining([playerActivityId, castManagerId]),
    );
    expect(index.facts).toEqual([]);
    expect(index.coverage).toMatchObject({
      platformProfiles: ["android"],
      entryPoints: 6,
      indexedTopics: index.topics.length,
      generatedFacts: 0,
    });
    expect(validateProductIndex(index).success).toBe(true);
  });
});
