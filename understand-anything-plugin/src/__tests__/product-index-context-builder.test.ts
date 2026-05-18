import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import type { ProductIndex } from "@understand-anything/core/product-index";
import {
  buildProductIndexChatContext,
  formatProductIndexContextForPrompt,
} from "../product-index-context-builder.js";
import {
  buildChatPrompt,
  buildProductAwareChatPrompt,
} from "../understand-chat.js";

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
      lineRange: [10, 80],
      summary: "播放页 Activity。",
      tags: ["player"],
      complexity: "moderate",
    },
    {
      id: "function:player/CastButton.kt:renderCastButton",
      type: "function",
      name: "renderCastButton",
      filePath: "player/CastButton.kt",
      lineRange: [20, 42],
      summary: "渲染投屏按钮。",
      tags: ["cast", "ui"],
      complexity: "simple",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

const domainGraph: KnowledgeGraph = {
  ...graph,
  nodes: [
    {
      id: "domain:casting",
      type: "domain",
      name: "Casting Domain",
      summary: "投屏业务域。",
      tags: ["cast"],
      complexity: "moderate",
    },
  ],
};

const productIndex: ProductIndex = {
  version: "1.0.0",
  kind: "product-index",
  project: {
    name: "video-app",
    platforms: ["android"],
    languages: ["kotlin"],
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
  },
  topics: [
    {
      id: "topic:casting",
      kind: "capability",
      name: "投屏",
      aliases: ["Cast"],
      summary: "视频投屏能力。",
      status: "summarized",
      entryEvidenceIds: ["ev:player-entry"],
      evidenceIds: ["ev:player-entry"],
      domainRefs: [],
    },
  ],
  facts: [
    {
      id: "fact:casting-entry",
      topicIds: ["topic:casting"],
      type: "behavior",
      text: "播放页提供投屏入口。",
      conditions: ["仅在播放器页面展示"],
      evidenceIds: ["ev:player-entry"],
      confidence: "confirmed",
      maturity: "summarized",
    },
  ],
  evidence: [
    {
      id: "ev:player-entry",
      role: "entry",
      filePath: "player/PlayerActivity.kt",
      symbol: "PlayerActivity",
      lineRange: [10, 80],
      nodeId: "class:player/PlayerActivity.kt:PlayerActivity",
      signalTypes: ["entry", "ui"],
      tokens: ["投屏", "player"],
      reason: "播放页入口。",
      confidence: "confirmed",
    },
  ],
  coverage: {
    platformProfiles: ["android"],
    entryPoints: 1,
    indexedTopics: 1,
    confirmedEvidence: 1,
    generatedFacts: 1,
    warnings: [],
  },
};

describe("product index chat context", () => {
  it("matches product topics and expands code evidence nodes", () => {
    const ctx = buildProductIndexChatContext({
      graph,
      productIndex,
      query: "如何开启投屏功能",
    });

    expect(ctx.productResults.map((result) => result.topic.id)).toContain("topic:casting");
    expect(ctx.codeEvidenceNodes.map((node) => node.id)).toContain(
      "class:player/PlayerActivity.kt:PlayerActivity",
    );
  });

  it("formats product topics, facts, and evidence locations for prompt", () => {
    const ctx = buildProductIndexChatContext({
      graph,
      productIndex,
      query: "如何开启投屏功能",
    });

    const formatted = formatProductIndexContextForPrompt(ctx);

    expect(formatted).toContain("## Product Index");
    expect(formatted).toContain("投屏");
    expect(formatted).toContain("播放页提供投屏入口");
    expect(formatted).toContain("player/PlayerActivity.kt");
    expect(formatted).toContain("PlayerActivity");
    expect(formatted).toContain("lines 10-80");
  });

  it("uses product-aware prompt when product index matches", () => {
    const prompt = buildProductAwareChatPrompt({
      graph,
      productIndex,
      query: "如何开启投屏功能",
    });

    expect(prompt).toContain("Product Index");
    expect(prompt).toContain("Structural Graph Context");
  });

  it("falls back to the normal chat prompt without a product index", () => {
    const prompt = buildProductAwareChatPrompt({
      graph,
      query: "播放器入口在哪里",
    });

    expect(prompt).toBe(buildChatPrompt(graph, "播放器入口在哪里"));
  });

  it("falls back to the normal chat prompt when product index has no matches", () => {
    const prompt = buildProductAwareChatPrompt({
      graph,
      productIndex,
      query: "购物车优惠券在哪里",
    });

    expect(prompt).toBe(buildChatPrompt(graph, "购物车优惠券在哪里"));
  });

  it("finds evidence nodes by file path and symbol when nodeId is absent", () => {
    const indexWithoutNodeId: ProductIndex = {
      ...productIndex,
      topics: [
        {
          ...productIndex.topics[0],
          evidenceIds: ["ev:cast-button"],
          entryEvidenceIds: ["ev:cast-button"],
        },
      ],
      facts: [
        {
          ...productIndex.facts[0],
          evidenceIds: ["ev:cast-button"],
        },
      ],
      evidence: [
        {
          ...productIndex.evidence[0],
          id: "ev:cast-button",
          filePath: "player/CastButton.kt",
          symbol: "renderCastButton",
          nodeId: undefined,
          lineRange: [20, 42],
          reason: "投屏按钮渲染入口。",
        },
      ],
    };

    const ctx = buildProductIndexChatContext({
      graph,
      productIndex: indexWithoutNodeId,
      query: "如何开启投屏功能",
    });

    expect(ctx.codeEvidenceNodes.map((node) => node.id)).toContain(
      "function:player/CastButton.kt:renderCastButton",
    );
  });

  it("collects domain nodes referenced by matched product topics", () => {
    const indexWithDomainRef: ProductIndex = {
      ...productIndex,
      topics: [
        {
          ...productIndex.topics[0],
          domainRefs: ["domain:casting"],
        },
      ],
    };

    const ctx = buildProductIndexChatContext({
      graph,
      productIndex: indexWithDomainRef,
      domainGraph,
      query: "如何开启投屏功能",
    });

    expect(ctx.domainNodes.map((node) => node.id)).toEqual(["domain:casting"]);
  });
});
