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
      entryEvidenceIds: ["ev:cast-button"],
      evidenceIds: ["ev:cast-button", "ev:cast-allowed-field"],
      domainRefs: ["domain:playback"],
    },
  ],
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
  evidence: [
    {
      id: "ev:cast-button",
      role: "entry",
      filePath: "player/PlayerActivity.kt",
      symbol: "PlayerActivity",
      lineRange: [12, 48],
      nodeId: "class:player/PlayerActivity.kt:PlayerActivity",
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
    warnings: [],
  },
};

describe("ProductIndex schema", () => {
  it("validates topics, facts, evidence, and sources", () => {
    const result = validateProductIndex(sampleIndex);
    expect(result.success).toBe(true);
    expect(result.data?.topics[0].name).toBe("投屏");
  });

  it("rejects confirmed fact without evidence ids", () => {
    const invalid: ProductIndex = {
      ...sampleIndex,
      facts: [{ ...sampleIndex.facts[0], evidenceIds: [] }],
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

  it("requires every query token to match", () => {
    expect(searchProductIndex(sampleIndex, "投屏 购物车")).toEqual([]);
  });

  it("returns empty results for unrelated queries", () => {
    expect(searchProductIndex(sampleIndex, "购物车 优惠券")).toEqual([]);
  });
});
