import { describe, expect, it } from "vitest";
import {
  ProductIndexSchema,
  searchProductIndex,
  validateProductIndex,
  type ProductIndex,
} from "../product-index.js";

const sampleIndex: ProductIndex = {
  version: "1.0.0",
  kind: "product-index",
  project: {
    name: "video-app",
    platforms: ["android"],
    languages: ["kotlin", "java"],
    frameworks: ["android"],
    analyzedAt: "2026-05-18T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  sources: {
    knowledgeGraph: {
      path: ".understand-anything/knowledge-graph.json",
      gitCommitHash: "abc123",
      required: true,
    },
    domainGraph: {
      path: ".understand-anything/domain-graph.json",
      available: true,
      required: false,
    },
    signals: {
      path: ".understand-anything/product-signals.jsonl",
      available: true,
      count: 2,
      indexedNodes: 2,
      truncated: false,
    },
  },
  topics: [
    {
      id: "topic:casting",
      kind: "capability",
      name: "投屏",
      aliases: ["Cast", "DLNA"],
      summary: "把当前视频推送到可投屏设备播放。",
      status: "summarized",
      facts: [
        {
          id: "fact:casting-disabled-by-cast-allowed",
          topicIds: ["topic:casting"],
          type: "rule",
          text: "当 castAllowed 为 false 时，投屏入口会被禁用或隐藏。",
          conditions: ["castAllowed=false"],
          evidenceIds: ["ev:cast-allowed-field"],
          confidence: "confirmed",
          maturity: "summarized",
        },
      ],
      entryEvidenceIds: ["ev:cast-button"],
      evidenceIds: ["ev:cast-button", "ev:cast-allowed-field"],
      domainRefs: ["domain:playback"],
    },
  ],
  evidence: [
    {
      id: "ev:cast-button",
      role: "entry",
      filePath: "player/PlayerActivity.kt",
      symbol: "PlayerActivity",
      lineRange: [12, 48],
      nodeId: "class:player/PlayerActivity.kt:PlayerActivity",
      nodeIds: ["class:player/PlayerActivity.kt:PlayerActivity"],
      signalTypes: ["entry", "ui"],
      tokens: ["player", "cast", "投屏"],
      reason: "播放页投屏入口。",
      confidence: "confirmed",
    },
    {
      id: "ev:cast-allowed-field",
      role: "data",
      filePath: "player/model/PlaybackInfo.kt",
      symbol: "castAllowed",
      lineRange: [31, 31],
      nodeId: "class:player/model/PlaybackInfo.kt:PlaybackInfo",
      nodeIds: ["class:player/model/PlaybackInfo.kt:PlaybackInfo"],
      signalTypes: ["data", "rule"],
      tokens: ["cast", "allowed", "投屏", "可用"],
      reason: "播放信息模型包含服务端下发的投屏可用性字段。",
      confidence: "confirmed",
    },
  ],
  coverage: {
    platformProfiles: ["android"],
    entryPoints: 1,
    indexedTopics: 1,
    confirmedEvidence: 2,
    generatedFacts: 1,
  },
};

describe("ProductIndex schema", () => {
  it("validates topics, facts, evidence, and sources", () => {
    const result = validateProductIndex(sampleIndex);
    expect(result.success).toBe(true);
    expect(result.data?.topics[0].name).toBe("投屏");
  });

  it("accepts process topics", () => {
    const result = validateProductIndex({
      ...sampleIndex,
      topics: [
        {
          ...sampleIndex.topics[0],
          kind: "process",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("validates grounded topics, facts, and evidence", () => {
    const result = validateProductIndex({
      version: "1.0.0",
      kind: "product-index",
      project: {
        name: "video-app",
        platforms: ["android"],
        languages: ["java"],
        frameworks: ["Android"],
        analyzedAt: "2026-05-19T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      sources: {
        knowledgeGraph: {
          path: ".understand-anything/knowledge-graph.json",
          gitCommitHash: "abc123",
          required: true,
        },
      },
      topics: [
        {
          id: "topic:boot-receiver",
          kind: "capability",
          name: "开机广播调起",
          aliases: [],
          summary: "开机广播触发首页初始化相关业务。",
          status: "indexed",
          facts: [
            {
              id: "fact:boot-receiver-entry",
              topicIds: ["topic:boot-receiver"],
              type: "behavior",
              text: "应用接收开机广播后会启动后续首页初始化处理。",
              conditions: ["系统发出开机广播"],
              evidenceIds: ["evidence:BootBroadcastReceiver.onReceive"],
              confidence: "confirmed",
              maturity: "indexed",
            },
          ],
          entryEvidenceIds: ["evidence:BootBroadcastReceiver.onReceive"],
          evidenceIds: ["evidence:BootBroadcastReceiver.onReceive"],
          domainRefs: [],
        },
      ],
      evidence: [
        {
          id: "evidence:BootBroadcastReceiver.onReceive",
          role: "behavior",
          filePath: "app/BootBroadcastReceiver.java",
          symbol: "onReceive",
          lineRange: [18, 21],
          nodeId: "function:BootBroadcastReceiver.java:onReceive",
          nodeIds: ["function:BootBroadcastReceiver.java:onReceive"],
          signalTypes: ["behavior"],
          tokens: [],
          reason: "接收开机广播并启动后续处理。",
          summary: "接收开机广播并启动后续处理。",
          confidence: "confirmed",
        },
      ],
      coverage: {
        platformProfiles: ["android"],
        entryPoints: 1,
        indexedTopics: 1,
        confirmedEvidence: 1,
        generatedFacts: 1,
      },
      quality: {
        groundedFacts: 1,
        ignoredFiles: 0,
        overflowFiles: 0,
      },
    });

    expect(result.success).toBe(true);
  });

  it("applies defaults for grounded fields on raw product index input", () => {
    const result = validateProductIndex({
      ...sampleIndex,
      topics: [
        {
          ...sampleIndex.topics[0],
          facts: undefined,
        },
      ],
      evidence: [
        ...sampleIndex.evidence.map((evidence) => ({
          ...evidence,
          nodeIds: undefined,
        })),
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data?.topics[0].facts).toEqual([]);
    expect(result.data?.evidence[0].nodeIds).toEqual([]);
  });

  it("rejects confirmed fact without evidence ids", () => {
    const invalid: ProductIndex = {
      ...sampleIndex,
      topics: [
        {
          ...sampleIndex.topics[0],
          facts: [{ ...sampleIndex.topics[0].facts[0], evidenceIds: [] }],
        },
      ],
    };
    const result = validateProductIndex(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("confirmed facts must reference evidence");
  });

  it("rejects topic evidence ids that do not exist", () => {
    const invalid: ProductIndex = {
      ...sampleIndex,
      topics: [{ ...sampleIndex.topics[0], evidenceIds: ["ev:missing"] }],
    };
    const result = validateProductIndex(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown evidence id");
  });

  it("rejects duplicate topic ids", () => {
    const invalid: ProductIndex = {
      ...sampleIndex,
      topics: [...sampleIndex.topics, { ...sampleIndex.topics[0], name: "投屏入口" }],
    };
    const result = validateProductIndex(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("duplicate topic id");
  });

  it("rejects duplicate fact ids", () => {
    const invalid: ProductIndex = {
      ...sampleIndex,
      topics: [
        {
          ...sampleIndex.topics[0],
          facts: [
            ...sampleIndex.topics[0].facts,
            { ...sampleIndex.topics[0].facts[0], text: "重复事实。" },
          ],
        },
      ],
    };
    const result = validateProductIndex(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("duplicate fact id");
  });

  it("rejects duplicate evidence ids", () => {
    const invalid: ProductIndex = {
      ...sampleIndex,
      evidence: [
        ...sampleIndex.evidence,
        { ...sampleIndex.evidence[0], reason: "重复证据。" },
      ],
    };
    const result = validateProductIndex(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("duplicate evidence id");
  });

  it("exports a zod schema for direct consumers", () => {
    const parsed = ProductIndexSchema.parse(sampleIndex);
    expect(parsed.kind).toBe("product-index");
  });
});

describe("searchProductIndex", () => {
  it("matches by topic name, aliases, fact text, and evidence tokens", () => {
    const results = searchProductIndex(sampleIndex, "投屏 可用");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
    expect(results[0].facts.map((fact) => fact.id)).toContain(
      "fact:casting-disabled-by-cast-allowed",
    );
  });

  it("matches by topic alias", () => {
    const results = searchProductIndex(sampleIndex, "DLNA");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
  });

  it("matches by fact condition", () => {
    const results = searchProductIndex(sampleIndex, "castAllowed=false");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
    expect(results[0].facts.map((fact) => fact.id)).toContain(
      "fact:casting-disabled-by-cast-allowed",
    );
  });

  it("matches by evidence token", () => {
    const results = searchProductIndex(sampleIndex, "allowed");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
    expect(results[0].evidence.map((evidence) => evidence.id)).toContain(
      "ev:cast-allowed-field",
    );
  });

  it("includes fact-only evidence in search and returned evidence", () => {
    const factOnlyIndex: ProductIndex = {
      ...sampleIndex,
      topics: [
        {
          ...sampleIndex.topics[0],
          evidenceIds: ["ev:cast-button"],
          facts: [
            {
              ...sampleIndex.topics[0].facts[0],
              evidenceIds: ["ev:server-experiment"],
            },
          ],
        },
      ],
      evidence: [
        sampleIndex.evidence[0],
        {
          id: "ev:server-experiment",
          role: "data",
          filePath: "player/model/PlaybackInfo.kt",
          symbol: "serverExperiment",
          lineRange: [42, 42],
          nodeId: "class:player/model/PlaybackInfo.kt:PlaybackInfo",
          nodeIds: ["class:player/model/PlaybackInfo.kt:PlaybackInfo"],
          signalTypes: ["data"],
          tokens: ["serverExperiment"],
          reason: "服务端实验开关。",
          confidence: "confirmed",
        },
      ],
    };

    const results = searchProductIndex(factOnlyIndex, "serverExperiment");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
    expect(results[0].evidence.map((evidence) => evidence.id)).toContain(
      "ev:server-experiment",
    );
  });

  it("matches Chinese natural-language queries", () => {
    const results = searchProductIndex(sampleIndex, "如何开启投屏功能");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
  });

  it("matches punctuation-normalized queries", () => {
    const results = searchProductIndex(sampleIndex, "投屏，");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
  });

  it("requires every query token to match", () => {
    expect(searchProductIndex(sampleIndex, "投屏 购物车")).toEqual([]);
  });

  it("returns empty results for unrelated queries", () => {
    expect(searchProductIndex(sampleIndex, "购物车 优惠券")).toEqual([]);
  });
});
