import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadProductIndex, saveProductIndex } from "../persistence/index.js";
import type { ProductIndex } from "../product-index.js";

const testRoot = join(tmpdir(), `ua-product-index-persist-test-${process.pid}`);
const productIndexPath = join(testRoot, ".understand-anything", "product-index.json");

const sampleIndex: ProductIndex = {
  version: "1.0.0",
  kind: "product-index",
  project: {
    name: "video-app",
    platforms: ["android"],
    languages: ["kotlin"],
    frameworks: ["android"],
    analyzedAt: "2026-05-18T00:00:00.000Z",
  },
  sources: {
    knowledgeGraph: {
      path: ".understand-anything/knowledge-graph.json",
      required: true,
    },
  },
  topics: [
    {
      id: "topic:casting",
      kind: "capability",
      name: "Casting",
      aliases: ["Cast"],
      summary: "Send playback to a casting device.",
      status: "indexed",
      facts: [
        {
          id: "fact:casting-entry",
          topicIds: ["topic:casting"],
          type: "behavior",
          text: "The casting entry opens device selection.",
          conditions: [],
          evidenceIds: ["ev:cast-button"],
          confidence: "confirmed",
          maturity: "indexed",
        },
      ],
      entryEvidenceIds: ["ev:cast-button"],
      evidenceIds: ["ev:cast-button"],
      domainRefs: [],
    },
  ],
  evidence: [
    {
      id: "ev:cast-button",
      role: "entry",
      filePath: "app/src/main/java/player/PlayerActivity.kt",
      symbol: "PlayerActivity",
      lineRange: [12, 48],
      nodeId: "class:app/src/main/java/player/PlayerActivity.kt:PlayerActivity",
      nodeIds: ["class:app/src/main/java/player/PlayerActivity.kt:PlayerActivity"],
      signalTypes: ["entry", "ui"],
      tokens: ["cast", "playback"],
      reason: "Playback screen casting entry.",
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
};

function cloneIndex(overrides: Partial<ProductIndex> = {}): ProductIndex {
  return {
    ...structuredClone(sampleIndex),
    ...overrides,
  };
}

function savedJson(): ProductIndex {
  return JSON.parse(readFileSync(productIndexPath, "utf-8")) as ProductIndex;
}

describe("product index persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("saves and loads product index from product-index.json", () => {
    saveProductIndex(testRoot, sampleIndex);

    expect(existsSync(productIndexPath)).toBe(true);
    expect(loadProductIndex(testRoot)?.kind).toBe("product-index");
  });

  it("returns null when no product index exists", () => {
    expect(loadProductIndex(testRoot)).toBeNull();
  });

  it("validates before saving", () => {
    const invalid = cloneIndex({
      topics: [
        {
          ...sampleIndex.topics[0],
          facts: [{ ...sampleIndex.topics[0].facts[0], evidenceIds: [] }],
        },
      ],
    });

    expect(() => saveProductIndex(testRoot, invalid)).toThrow(
      /Invalid product index: confirmed facts must reference evidence/,
    );
    expect(existsSync(productIndexPath)).toBe(false);
  });

  it("validates loaded product index by default", () => {
    const dir = join(testRoot, ".understand-anything");
    mkdirSync(dir, { recursive: true });
    const invalid = cloneIndex({
      topics: [{ ...sampleIndex.topics[0], evidenceIds: ["ev:missing"] }],
    });
    writeFileSync(productIndexPath, JSON.stringify(invalid, null, 2), "utf-8");

    expect(() => loadProductIndex(testRoot)).toThrow(
      /Invalid product index: topic topic:casting references unknown evidence id ev:missing/,
    );
  });

  it("can skip validation while loading", () => {
    mkdirSync(join(testRoot, ".understand-anything"), { recursive: true });
    const invalid = cloneIndex({
      topics: [{ ...sampleIndex.topics[0], evidenceIds: ["ev:missing"] }],
    });
    writeFileSync(productIndexPath, JSON.stringify(invalid, null, 2), "utf-8");

    expect(loadProductIndex(testRoot, { validate: false })?.topics[0].evidenceIds).toEqual([
      "ev:missing",
    ]);
  });

  it("converts in-project absolute evidence file paths to relative paths", () => {
    const absoluteFilePath = resolve(
      testRoot,
      "app/src/main/java/player/PlayerActivity.kt",
    );
    const index = cloneIndex({
      evidence: [{ ...sampleIndex.evidence[0], filePath: absoluteFilePath }],
    });

    saveProductIndex(testRoot, index);

    expect(savedJson().evidence[0].filePath).toBe(
      "app/src/main/java/player/PlayerActivity.kt",
    );
    expect(loadProductIndex(testRoot)?.evidence[0].filePath).toBe(
      "app/src/main/java/player/PlayerActivity.kt",
    );
  });

  it("drops unsafe evidence file paths when nodeId is present", () => {
    const unsafePaths = [
      "/tmp/outside/PlayerActivity.kt",
      "C:\\repo\\player\\PlayerActivity.kt",
      "C:repo/player/PlayerActivity.kt",
      "app\\src\\main\\PlayerActivity.kt",
      "src\u0000/player/PlayerActivity.kt",
      "src//player.kt",
      "../outside/PlayerActivity.kt",
    ];

    for (const filePath of unsafePaths) {
      const index = cloneIndex({
        evidence: [{ ...sampleIndex.evidence[0], filePath }],
      });

      saveProductIndex(testRoot, index);
      expect(savedJson().evidence[0]).not.toHaveProperty("filePath");
      expect(loadProductIndex(testRoot)?.evidence[0].nodeId).toBe(
        sampleIndex.evidence[0].nodeId,
      );
    }
  });

  it("drops drive-relative Windows evidence file paths when nodeId is present", () => {
    const index = cloneIndex({
      evidence: [
        {
          ...sampleIndex.evidence[0],
          filePath: "C:repo/player/PlayerActivity.kt",
        },
      ],
    });

    saveProductIndex(testRoot, index);

    expect(savedJson().evidence[0]).not.toHaveProperty("filePath");
    expect(loadProductIndex(testRoot)?.evidence[0].nodeId).toBe(
      sampleIndex.evidence[0].nodeId,
    );
  });

  it("throws for unsafe evidence file paths without nodeId fallback", () => {
    const index = cloneIndex({
      evidence: [
        {
          ...sampleIndex.evidence[0],
          filePath: "../outside/PlayerActivity.kt",
          nodeId: undefined,
        },
      ],
    });

    expect(() => saveProductIndex(testRoot, index)).toThrow(
      /Invalid product evidence filePath/,
    );
    expect(existsSync(productIndexPath)).toBe(false);
  });

  it("throws for drive-relative Windows evidence file paths without nodeId fallback", () => {
    const index = cloneIndex({
      evidence: [
        {
          ...sampleIndex.evidence[0],
          filePath: "C:repo/player/PlayerActivity.kt",
          nodeId: undefined,
        },
      ],
    });

    expect(() => saveProductIndex(testRoot, index)).toThrow(
      /Invalid product evidence filePath/,
    );
    expect(existsSync(productIndexPath)).toBe(false);
  });

  it("throws for malformed evidence file paths without nodeId fallback", () => {
    const malformedPaths = ["src\u0000/player/PlayerActivity.kt", "src//player.kt"];

    for (const filePath of malformedPaths) {
      const index = cloneIndex({
        evidence: [
          {
            ...sampleIndex.evidence[0],
            filePath,
            nodeId: undefined,
          },
        ],
      });

      expect(() => saveProductIndex(testRoot, index)).toThrow(
        /Invalid product evidence filePath/,
      );
      expect(existsSync(productIndexPath)).toBe(false);
    }
  });
});
