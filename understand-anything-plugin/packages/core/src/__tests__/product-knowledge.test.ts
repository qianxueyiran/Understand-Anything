import { describe, expect, it } from "vitest";
import {
  ProductKnowledgeSchema,
  searchProductKnowledge,
  validateProductKnowledge,
  type ProductKnowledge,
} from "../product-knowledge.js";

const sampleKnowledge: ProductKnowledge = {
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
          filePath: "player/PlayerActivity.kt",
          nodeId: "file:player/PlayerActivity.kt",
          reason: "播放页入口",
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

describe("product knowledge schema", () => {
  it("validates product knowledge with areas, concepts, rules, fields, and evidence", () => {
    const result = validateProductKnowledge(sampleKnowledge);
    expect(result.success).toBe(true);
    expect(result.data?.concepts[0].name).toBe("码流标签");
  });

  it("rejects confirmed concepts without evidence", () => {
    const invalid = structuredClone(sampleKnowledge);
    invalid.concepts[0].evidence = [];
    const result = validateProductKnowledge(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("confirmed");
  });

  it("exports a zod schema for direct consumers", () => {
    const parsed = ProductKnowledgeSchema.parse(sampleKnowledge);
    expect(parsed.productAreas).toHaveLength(1);
  });
});

describe("searchProductKnowledge", () => {
  it("matches by concept name and user-facing terms", () => {
    const results = searchProductKnowledge(sampleKnowledge, "播放页 蓝光 标签");
    expect(results.map((r) => r.concept.id)).toContain("concept:stream-quality-label");
    expect(results[0].matchedText.join(" ")).toContain("蓝光");
  });

  it("matches by display rule and data field", () => {
    const results = searchProductKnowledge(sampleKnowledge, "stream.label 怎么展示");
    expect(results[0].concept.id).toBe("concept:stream-quality-label");
    expect(results[0].area?.id).toBe("area:playback-page");
  });

  it("returns an empty list for unrelated queries", () => {
    const results = searchProductKnowledge(sampleKnowledge, "购物车 优惠券");
    expect(results).toEqual([]);
  });
});
