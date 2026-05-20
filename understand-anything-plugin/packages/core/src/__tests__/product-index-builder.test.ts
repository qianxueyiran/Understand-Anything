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

function graphWith(
  nodes: GraphNode[],
  edges: GraphEdge[] = [],
  overrides: Partial<KnowledgeGraph> = {},
): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "video-app",
      languages: ["kotlin"],
      frameworks: ["android"],
      description: "Video app",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes,
    edges,
    layers: [],
    tour: [],
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
  it("defaults analyzedAt deterministically from graph project metadata", () => {
    const index = buildDeterministicProductIndex(graph, undefined, {
      platform: "android",
      maxDepth: 1,
      maxNodesPerTopic: 5,
      maxFrontierPerDepth: 5,
      maxEvidencePerTopic: 5,
      hubDegreeThreshold: 20,
    });

    expect(index.project.analyzedAt).toBe(graph.project.analyzedAt);
  });

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

  it("uses anchored glob entry patterns for node names", () => {
    const patternGraph = graphWith([
      node({
        id: "class:player/PlayerActivity.kt:PlayerActivity",
        name: "PlayerActivity",
        filePath: "player/PlayerActivity.kt",
        summary: "播放页 Activity。",
        tags: ["activity"],
      }),
      node({
        id: "class:player/PlayerActivityHelper.kt:PlayerActivityHelper",
        name: "PlayerActivityHelper",
        filePath: "player/PlayerActivityHelper.kt",
        summary: "播放页辅助类。",
        tags: ["helper"],
      }),
    ]);

    const seeds = enumerateProductEntrySeeds(patternGraph, {
      platform: "android",
      entryPatterns: ["*Activity"],
    });

    expect(seeds.map((seed) => seed.entryNodeId)).toEqual([
      "class:player/PlayerActivity.kt:PlayerActivity",
    ]);
  });

  it("matches entry pattern globs against full file paths", () => {
    const patternGraph = graphWith([
      node({
        id: "class:feature/player/PlayerScreen.kt:PlayerScreen",
        name: "PlayerScreen",
        filePath: "feature/player/PlayerActivity.kt",
        summary: "播放页 Activity。",
        tags: ["activity"],
      }),
    ]);

    const seeds = enumerateProductEntrySeeds(patternGraph, {
      platform: "android",
      entryPatterns: ["**/*Activity.kt"],
    });

    expect(seeds.map((seed) => seed.entryNodeId)).toEqual([
      "class:feature/player/PlayerScreen.kt:PlayerScreen",
    ]);
  });

  it("uses Android framework entry points when enumerating product seeds", () => {
    const androidGraph = graphWith(
      [
        node({
          id: "class:provider/PlaybackContentProvider.kt:PlaybackContentProvider",
          name: "PlaybackContentProvider",
          filePath: "provider/PlaybackContentProvider.kt",
          summary: "播放记录 ContentProvider。",
          tags: ["content-provider", "android"],
        }),
      ],
      [],
      {
        project: {
          name: "video-app",
          languages: ["kotlin"],
          frameworks: ["Android"],
          description: "Video app",
          analyzedAt: "2026-05-18T00:00:00.000Z",
          gitCommitHash: "abc123",
        },
      },
    );

    const seeds = enumerateProductEntrySeeds(androidGraph, { platform: "android" });

    expect(seeds.map((seed) => seed.entryNodeId)).toEqual([
      "class:provider/PlaybackContentProvider.kt:PlaybackContentProvider",
    ]);
  });

  it("covers common Android business entry suffixes from the framework profile", () => {
    const androidGraph = graphWith(
      [
        node({
          id: "class:entry/PlaybackEntry.kt:PlaybackEntry",
          name: "PlaybackEntry",
          filePath: "entry/PlaybackEntry.kt",
          tags: ["entry"],
        }),
        node({
          id: "class:startup/AppStartup.kt:AppStartup",
          name: "AppStartup",
          filePath: "startup/AppStartup.kt",
          tags: ["startup"],
        }),
        node({
          id: "class:boot/ColdBoot.kt:ColdBoot",
          name: "ColdBoot",
          filePath: "boot/ColdBoot.kt",
          tags: ["boot"],
        }),
        node({
          id: "class:task/HistorySyncTask.kt:HistorySyncTask",
          name: "HistorySyncTask",
          filePath: "task/HistorySyncTask.kt",
          tags: ["task"],
        }),
        node({
          id: "class:proxy/PlaybackActivityProxy.kt:PlaybackActivityProxy",
          name: "PlaybackActivityProxy",
          filePath: "proxy/PlaybackActivityProxy.kt",
          tags: ["activity-proxy"],
        }),
        node({
          id: "class:presenter/PlaybackPresenter.kt:PlaybackPresenter",
          name: "PlaybackPresenter",
          filePath: "presenter/PlaybackPresenter.kt",
          tags: ["presenter"],
        }),
      ],
      [],
      {
        project: {
          name: "video-app",
          languages: ["kotlin"],
          frameworks: ["android"],
          description: "Video app",
          analyzedAt: "2026-05-18T00:00:00.000Z",
          gitCommitHash: "abc123",
        },
      },
    );

    const seeds = enumerateProductEntrySeeds(androidGraph, { platform: "android" });
    const seedKinds = new Map(seeds.map((seed) => [seed.entryNodeId, seed.entryKind]));

    expect(Array.from(seedKinds.keys())).toEqual([
      "class:boot/ColdBoot.kt:ColdBoot",
      "class:entry/PlaybackEntry.kt:PlaybackEntry",
      "class:presenter/PlaybackPresenter.kt:PlaybackPresenter",
      "class:proxy/PlaybackActivityProxy.kt:PlaybackActivityProxy",
      "class:startup/AppStartup.kt:AppStartup",
      "class:task/HistorySyncTask.kt:HistorySyncTask",
    ]);
    expect(seedKinds.get("class:entry/PlaybackEntry.kt:PlaybackEntry")).toBe("entry");
    expect(seedKinds.get("class:startup/AppStartup.kt:AppStartup")).toBe("startup");
    expect(seedKinds.get("class:boot/ColdBoot.kt:ColdBoot")).toBe("boot");
    expect(seedKinds.get("class:task/HistorySyncTask.kt:HistorySyncTask")).toBe("task");
    expect(seedKinds.get("class:proxy/PlaybackActivityProxy.kt:PlaybackActivityProxy")).toBe(
      "activity-proxy",
    );
    expect(seedKinds.get("class:presenter/PlaybackPresenter.kt:PlaybackPresenter")).toBe(
      "presenter",
    );
  });

  it("maps background and startup entries to process topics", () => {
    const processGraph = graphWith(
      [
        node({
          id: "class:startup/AppStartup.kt:AppStartup",
          name: "AppStartup",
          filePath: "startup/AppStartup.kt",
          tags: ["startup"],
        }),
        node({
          id: "class:boot/ColdBoot.kt:ColdBoot",
          name: "ColdBoot",
          filePath: "boot/ColdBoot.kt",
          tags: ["boot"],
        }),
        node({
          id: "class:download/DownloadWorker.kt:DownloadWorker",
          name: "DownloadWorker",
          filePath: "download/DownloadWorker.kt",
          tags: ["worker", "download"],
        }),
        node({
          id: "class:task/HistorySyncTask.kt:HistorySyncTask",
          name: "HistorySyncTask",
          filePath: "task/HistorySyncTask.kt",
          tags: ["task"],
        }),
        node({
          id: "class:job/CleanupJob.kt:CleanupJob",
          name: "CleanupJob",
          filePath: "job/CleanupJob.kt",
          tags: ["job"],
        }),
        node({
          id: "class:scheduler/RefreshScheduler.kt:RefreshScheduler",
          name: "RefreshScheduler",
          filePath: "scheduler/RefreshScheduler.kt",
          tags: ["scheduler"],
        }),
      ],
      [],
      {
        project: {
          name: "video-app",
          languages: ["kotlin"],
          frameworks: ["android"],
          description: "Video app",
          analyzedAt: "2026-05-18T00:00:00.000Z",
          gitCommitHash: "abc123",
        },
      },
    );

    const index = buildDeterministicProductIndex(processGraph, undefined, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 1,
      maxNodesPerTopic: 5,
      maxFrontierPerDepth: 5,
      maxEvidencePerTopic: 5,
      hubDegreeThreshold: 20,
    });

    expect(index.topics.map((topic) => topic.kind)).toEqual([
      "process",
      "process",
      "process",
      "process",
      "process",
      "process",
    ]);
  });

  it("throws a clear error for invalid custom entry pattern syntax", () => {
    expect(() =>
      enumerateProductEntrySeeds(graph, {
        platform: "android",
        entryPatterns: ["["],
      }),
    ).toThrow("Invalid product entry pattern: [");
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

  it("deduplicates frontier candidates before applying per-depth limits", () => {
    const duplicateId = "function:player/CastPolicy.kt:checkCastPolicy";
    const distinctId = "function:player/CastAvailability.kt:resolveCastAvailability";
    const duplicateGraph = graphWith(
      [
        node({
          id: playerActivityId,
          name: "PlayerActivity",
          filePath: "player/PlayerActivity.kt",
          summary: "播放页 Activity，包含投屏按钮入口。",
          tags: ["activity", "cast"],
        }),
        node({
          id: duplicateId,
          type: "function",
          name: "checkCastPolicy",
          filePath: "player/CastPolicy.kt",
          summary: "检查投屏 policy 和 allowed 规则。",
          tags: ["cast", "policy", "allowed"],
        }),
        node({
          id: distinctId,
          type: "function",
          name: "resolveCastAvailability",
          filePath: "player/CastAvailability.kt",
          summary: "解析投屏可用状态和按钮展示。",
          tags: ["cast", "available", "button"],
        }),
      ],
      [
        edge({ source: playerActivityId, target: duplicateId, type: "calls", weight: 1 }),
        edge({ source: playerActivityId, target: duplicateId, type: "calls", weight: 0.95 }),
        edge({ source: playerActivityId, target: duplicateId, type: "calls", weight: 0.9 }),
        edge({ source: playerActivityId, target: distinctId, type: "calls", weight: 0.2 }),
      ],
    );

    const index = buildDeterministicProductIndex(duplicateGraph, undefined, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 1,
      maxNodesPerTopic: 10,
      maxFrontierPerDepth: 3,
      maxEvidencePerTopic: 5,
      hubDegreeThreshold: 20,
    });

    expect(index.evidence.map((evidence) => evidence.nodeId)).toEqual(
      expect.arrayContaining([duplicateId, distinctId]),
    );
  });

  it("keeps high-signal hub nodes despite hub degree penalty", () => {
    const highSignalHubId = "class:player/CastHub.kt:CastHub";
    const hubGraph = graphWith(
      [
        node({
          id: playerActivityId,
          name: "PlayerActivity",
          filePath: "player/PlayerActivity.kt",
          summary: "播放页 Activity，包含投屏按钮入口。",
          tags: ["activity", "cast"],
        }),
        node({
          id: highSignalHubId,
          name: "CastHub",
          filePath: "player/CastHub.kt",
          summary: "投屏 SDK 集成、castAllowed 规则和按钮可用状态中心。",
          tags: ["cast", "sdk", "allowed", "button", "policy"],
        }),
        ...Array.from({ length: 5 }, (_, index) =>
          node({
            id: `class:common/HubDependency${index}.kt:HubDependency${index}`,
            name: `HubDependency${index}`,
            filePath: `common/HubDependency${index}.kt`,
            summary: "通用依赖。",
            tags: ["common"],
          }),
        ),
      ],
      [
        edge({ source: playerActivityId, target: highSignalHubId, type: "calls", weight: 0.7 }),
        ...Array.from({ length: 5 }, (_, index) =>
          edge({
            source: highSignalHubId,
            target: `class:common/HubDependency${index}.kt:HubDependency${index}`,
            type: "depends_on",
            weight: 1,
          }),
        ),
      ],
    );

    const index = buildDeterministicProductIndex(hubGraph, undefined, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 1,
      maxNodesPerTopic: 10,
      maxFrontierPerDepth: 5,
      maxEvidencePerTopic: 5,
      hubDegreeThreshold: 2,
    });

    expect(index.evidence.map((evidence) => evidence.nodeId)).toContain(highSignalHubId);
  });

  it("does not create domain refs from only short or common path tokens", () => {
    const commonDomainGraph = graphWith([
      node({
        id: "domain:generic-player",
        type: "domain",
        name: "Player shell",
        summary: "Generic app page container.",
        tags: ["common"],
      }),
    ]);

    const index = buildDeterministicProductIndex(graph, commonDomainGraph, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 1,
      maxNodesPerTopic: 10,
      maxFrontierPerDepth: 5,
      maxEvidencePerTopic: 5,
      hubDegreeThreshold: 20,
    });

    expect(index.topics.find((topic) => topic.name === "PlayerActivity")?.domainRefs).toEqual([]);
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
