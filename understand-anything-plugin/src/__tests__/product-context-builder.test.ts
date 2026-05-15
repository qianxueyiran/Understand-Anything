import { describe, expect, it } from "vitest";
import type { ProductKnowledge } from "@understand-anything/core/product-knowledge";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import {
  buildProductChatContext,
  formatProductContextForPrompt,
} from "../product-context-builder.js";
import { buildChatPrompt, buildProductAwareChatPrompt } from "../understand-chat.js";

const makeNode = (
  overrides: Partial<GraphNode> & { id: string; name: string },
): GraphNode => ({
  type: "file",
  summary: "",
  tags: [],
  complexity: "simple",
  ...overrides,
});

const graph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "video-app",
    languages: ["Kotlin"],
    frameworks: ["Android"],
    description: "A video playback app",
    analyzedAt: "2026-05-15T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    makeNode({
      id: "file:player/PlayerViewModel.kt",
      name: "PlayerViewModel.kt",
      filePath: "player/PlayerViewModel.kt",
      summary: "Builds stream labels for the playback page.",
      tags: ["playback", "stream"],
    }),
    makeNode({
      id: "file:player/model/Stream.kt",
      name: "Stream.kt",
      filePath: "player/model/Stream.kt",
      summary: "Defines stream fields returned by the playback API.",
      tags: ["playback", "model"],
    }),
    makeNode({
      id: "function:player/PlayerViewModel.kt:buildStreamLabels",
      name: "buildStreamLabels",
      type: "function",
      filePath: "player/PlayerViewModel.kt",
      summary: "Builds the user-facing stream label list.",
      tags: ["playback", "stream"],
    }),
  ],
  edges: [],
  layers: [],
  tour: [],
};

const domainGraph: KnowledgeGraph = {
  ...graph,
  nodes: [
    makeNode({
      id: "domain:playback",
      name: "Playback",
      type: "module",
      summary: "播放业务域，承载播放页、清晰度选择和码流标签。",
      tags: ["domain", "playback"],
    }),
  ],
};

const productKnowledge: ProductKnowledge = {
  version: "1.0.0",
  project: {
    name: "video-app",
    analyzedAt: "2026-05-15T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  productAreas: [
    {
      id: "area:playback-page",
      name: "播放页",
      summary: "承载视频播放、清晰度选择、码流标签和权益提示。",
      domainRefs: ["domain:playback"],
      codeRefs: [
        {
          filePath: "player/PlayerViewModel.kt",
          reason: "播放页 ViewModel 承载码流标签展示状态",
        },
      ],
    },
  ],
  concepts: [
    {
      id: "concept:stream-quality-label",
      name: "码流标签",
      areaId: "area:playback-page",
      meaning: "用于向用户表达当前内容可播放的清晰度、画质能力或权益限制。",
      userFacingTerms: ["高清", "蓝光", "HDR"],
      businessRules: ["标签展示依赖内容可用码流、用户权益和设备播放能力。"],
      displayRules: [
        {
          condition: "接口返回 stream.label 且该码流可展示",
          result: "在播放页清晰度入口或码流选择列表展示对应标签",
          evidence: [
            {
              filePath: "player/PlayerViewModel.kt",
              symbol: "buildStreamLabels",
              lineRange: [120, 168],
              reason: "构建播放页可展示码流标签",
            },
          ],
        },
      ],
      dataFields: [
        {
          name: "stream.label",
          source: "api",
          meaning: "服务端下发的码流展示文案或枚举。",
          evidence: [
            {
              filePath: "player/model/Stream.kt",
              symbol: "label",
              lineRange: [8, 12],
              reason: "定义码流标签字段",
            },
          ],
        },
      ],
      relatedConceptIds: [],
      evidence: [
        {
          filePath: "player/PlayerViewModel.kt",
          symbol: "buildStreamLabels",
          lineRange: [120, 168],
          reason: "构建播放页可展示码流标签",
        },
      ],
      confidence: "confirmed",
    },
  ],
};

describe("buildProductChatContext", () => {
  it("matches product concepts and expands to domain and code evidence nodes", () => {
    const ctx = buildProductChatContext({
      graph,
      domainGraph,
      productKnowledge,
      query: "播放页码流标签是什么意思",
    });

    expect(ctx.productResults.map((result) => result.concept.id)).toContain(
      "concept:stream-quality-label",
    );
    expect(ctx.codeEvidenceNodes.map((node) => node.id)).toContain(
      "file:player/PlayerViewModel.kt",
    );
    expect(ctx.domainNodes.map((node) => node.id)).toContain("domain:playback");
  });

  it("matches filePath and symbol evidence to the specific function node", () => {
    const ctx = buildProductChatContext({
      graph,
      domainGraph,
      productKnowledge,
      query: "播放页码流标签是什么意思",
    });

    expect(ctx.codeEvidenceNodes.map((node) => node.id)).toContain(
      "function:player/PlayerViewModel.kt:buildStreamLabels",
    );
  });
});

describe("formatProductContextForPrompt", () => {
  it("formats product knowledge, domain context, and code evidence", () => {
    const ctx = buildProductChatContext({
      graph,
      domainGraph,
      productKnowledge,
      query: "播放页码流标签是什么意思",
    });

    const formatted = formatProductContextForPrompt(ctx);

    expect(formatted).toContain("## Product Knowledge");
    expect(formatted).toContain("码流标签");
    expect(formatted).toContain("stream.label");
    expect(formatted).toContain("PlayerViewModel.kt");
  });

  it("deduplicates repeated evidence and caps rule and field output", () => {
    const repeatedEvidence = {
      filePath: "player/PlayerViewModel.kt",
      symbol: "buildStreamLabels",
      lineRange: [120, 168] as [number, number],
      reason: "构建播放页可展示码流标签",
    };
    const ctx = buildProductChatContext({
      graph,
      domainGraph,
      productKnowledge: {
        ...productKnowledge,
        concepts: [
          {
            ...productKnowledge.concepts[0],
            businessRules: Array.from({ length: 7 }, (_, index) => `business-rule-${index + 1}`),
            displayRules: Array.from({ length: 7 }, (_, index) => ({
              condition: `display-condition-${index + 1}`,
              result: `display-result-${index + 1}`,
              evidence: [repeatedEvidence],
            })),
            dataFields: Array.from({ length: 7 }, (_, index) => ({
              name: `field.${index + 1}`,
              source: "api" as const,
              meaning: `field meaning ${index + 1}`,
              evidence: [repeatedEvidence],
            })),
            evidence: [repeatedEvidence, repeatedEvidence],
          },
        ],
      },
      query: "播放页码流标签是什么意思",
    });

    const formatted = formatProductContextForPrompt(ctx);

    expect(formatted).toContain("business-rule-5");
    expect(formatted).not.toContain("business-rule-6");
    expect(formatted).toContain("display-condition-5");
    expect(formatted).not.toContain("display-condition-6");
    expect(formatted).toContain("field.5");
    expect(formatted).not.toContain("field.6");
    expect(formatted.match(/构建播放页可展示码流标签/g)).toHaveLength(1);
  });
});

describe("buildProductAwareChatPrompt", () => {
  it("falls back to the structural graph prompt without product knowledge", () => {
    const prompt = buildProductAwareChatPrompt({
      graph,
      query: "PlayerViewModel stream",
    });

    expect(prompt).toContain("Code Components");
    expect(prompt).not.toContain("Product Knowledge");
  });

  it("falls back to the structural graph prompt when product knowledge has no query match", () => {
    const input = {
      graph,
      productKnowledge,
      query: "购物车优惠券是什么意思",
    };

    expect(buildProductAwareChatPrompt(input)).toBe(buildChatPrompt(graph, input.query));
  });
});
