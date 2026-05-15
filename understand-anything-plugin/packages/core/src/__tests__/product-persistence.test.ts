import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProductKnowledge, saveProductKnowledge } from "../persistence/index.js";
import type { ProductKnowledge } from "../product-knowledge.js";

const testRoot = join(tmpdir(), "ua-product-knowledge-persist-test");

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
      summary: "承载播放和码流展示。",
      domainRefs: [],
      codeRefs: [],
    },
  ],
  concepts: [
    {
      id: "concept:stream-quality-label",
      name: "码流标签",
      areaId: "area:playback-page",
      meaning: "表达清晰度、画质能力或权益限制。",
      userFacingTerms: ["高清"],
      businessRules: ["有可展示码流时才展示。"],
      displayRules: [{ condition: "stream.label 存在", result: "展示标签", evidence: [] }],
      dataFields: [{ name: "stream.label", source: "api", meaning: "服务端下发标签", evidence: [] }],
      relatedConceptIds: [],
      evidence: [{ filePath: "player/PlayerViewModel.kt", reason: "构建标签" }],
      confidence: "confirmed",
    },
  ],
};

describe("product knowledge persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("saves and loads product knowledge", () => {
    saveProductKnowledge(testRoot, productKnowledge);
    const loaded = loadProductKnowledge(testRoot);
    expect(loaded?.concepts[0].id).toBe("concept:stream-quality-label");
  });

  it("returns null when no product knowledge file exists", () => {
    expect(loadProductKnowledge(testRoot)).toBeNull();
  });

  it("saves to product-knowledge.json and not knowledge-graph.json", () => {
    saveProductKnowledge(testRoot, productKnowledge);
    expect(existsSync(join(testRoot, ".understand-anything", "product-knowledge.json"))).toBe(true);
    expect(existsSync(join(testRoot, ".understand-anything", "knowledge-graph.json"))).toBe(false);
  });

  it("throws on invalid product knowledge when validation is enabled", () => {
    const invalid = structuredClone(productKnowledge);
    invalid.concepts[0].evidence = [];
    expect(() => saveProductKnowledge(testRoot, invalid)).toThrow(/confirmed product concept/);
  });

  it("sanitises product knowledge evidence paths without mutating input", () => {
    const insideAreaPath = join(testRoot, "src/product/PlaybackArea.kt");
    const insideConceptPath = join(testRoot, "src/player/PlayerViewModel.kt");
    const outsideRulePath = join(tmpdir(), "outside-user-home/DisplayRules.kt");
    const outsideDataFieldPath = join(tmpdir(), "outside-user-home/StreamDto.kt");
    const similarPrefixOutsidePath = join(`${testRoot}-outside`, "Secret.kt");
    const knowledgeWithAbsolutePaths: ProductKnowledge = {
      ...productKnowledge,
      productAreas: [
        {
          ...productKnowledge.productAreas[0],
          codeRefs: [
            { filePath: insideAreaPath, reason: "业务区域入口" },
            { filePath: similarPrefixOutsidePath, reason: "前缀相似但在项目外" },
          ],
        },
      ],
      concepts: [
        {
          ...productKnowledge.concepts[0],
          evidence: [{ filePath: insideConceptPath, reason: "构建标签" }],
          displayRules: [
            {
              condition: "stream.label 存在",
              result: "展示标签",
              evidence: [{ filePath: outsideRulePath, reason: "展示规则" }],
            },
          ],
          dataFields: [
            {
              name: "stream.label",
              source: "api",
              meaning: "服务端下发标签",
              evidence: [{ filePath: outsideDataFieldPath, reason: "接口字段" }],
            },
          ],
        },
      ],
    };

    saveProductKnowledge(testRoot, knowledgeWithAbsolutePaths);

    const loaded = loadProductKnowledge(testRoot);
    expect(loaded?.productAreas[0].codeRefs[0].filePath).toBe("src/product/PlaybackArea.kt");
    expect(loaded?.productAreas[0].codeRefs[1].filePath).toBe("Secret.kt");
    expect(loaded?.concepts[0].evidence[0].filePath).toBe("src/player/PlayerViewModel.kt");
    expect(loaded?.concepts[0].displayRules[0].evidence[0].filePath).toBe("DisplayRules.kt");
    expect(loaded?.concepts[0].dataFields[0].evidence[0].filePath).toBe("StreamDto.kt");
    expect(knowledgeWithAbsolutePaths.productAreas[0].codeRefs[0].filePath).toBe(insideAreaPath);
    expect(knowledgeWithAbsolutePaths.concepts[0].evidence[0].filePath).toBe(insideConceptPath);
    expect(knowledgeWithAbsolutePaths.concepts[0].displayRules[0].evidence[0].filePath).toBe(outsideRulePath);
    expect(knowledgeWithAbsolutePaths.concepts[0].dataFields[0].evidence[0].filePath).toBe(outsideDataFieldPath);
  });
});
