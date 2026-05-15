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
});
