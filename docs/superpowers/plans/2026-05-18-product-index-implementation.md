# Product Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/understand-product`，生成以入口驱动的 `product-index.json` 产品知识索引，并让 `/understand-chat` 与 Dashboard 能使用该索引定位产品问题代码证据。

**Architecture:** 在 core 中新增 Product Index schema、搜索、持久化和确定性索引构建器；在 skill package 中新增 CLI 作为 `/understand-product` 的可执行入口；LLM 仅通过 `product-index-analyzer` 对确定性草稿做 topic 命名和高置信 fact 归纳。Dashboard 第一版只做轻量面板，不新增复杂关系图。

**Tech Stack:** TypeScript strict mode、Zod、Fuse.js、Vitest、pnpm workspace、React + Zustand + Vite dashboard、Codex/Claude-compatible skill markdown。

---

## 文件结构

### Core 包

- Create: `understand-anything-plugin/packages/core/src/product-index.ts`
  - 定义 `ProductIndex`、`ProductTopic`、`ProductFact`、`ProductEvidence`、`ProductSignal` schema 和类型。
  - 提供 `validateProductIndex()`、`searchProductIndex()`。
- Create: `understand-anything-plugin/packages/core/src/product-index-builder.ts`
  - 从 `KnowledgeGraph` 枚举 Android entry seeds。
  - 构建确定性 `ProductSignal[]`。
  - 通过加权 graph expansion 聚合 evidence。
  - 生成不依赖 LLM 的初始 `ProductIndex` 草稿。
- Modify: `understand-anything-plugin/packages/core/src/persistence/index.ts`
  - 新增 `saveProductIndex()`、`loadProductIndex()`。
  - 新增 product evidence 路径安全处理。
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
  - 导出 product index API。
- Modify: `understand-anything-plugin/packages/core/package.json`
  - 新增 `./product-index` subpath export。
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-index.test.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-index-builder.test.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-index-persistence.test.ts`

### Skill 包

- Create: `understand-anything-plugin/src/product-index-cli.ts`
  - CLI：读取 graph、构建 deterministic draft、保存 signals sidecar、验证并保存 final index。
- Create: `understand-anything-plugin/src/product-index-context-builder.ts`
  - Chat 检索 product index，收集 facts、topics、evidence、domain nodes、code evidence nodes。
- Modify: `understand-anything-plugin/src/understand-chat.ts`
  - 新增 product-aware prompt builder。
- Modify: `understand-anything-plugin/src/index.ts`
  - 导出 product index chat context builder 和 product-aware prompt builder。
- Test: `understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts`
- Create: `understand-anything-plugin/skills/understand-product/SKILL.md`
  - 定义 `/understand-product` 运行流程。
- Create: `understand-anything-plugin/agents/product-index-analyzer.md`
  - LLM 只处理 topic normalization 和 fact summarization。

### Dashboard

- Modify: `understand-anything-plugin/packages/dashboard/vite.config.ts`
  - 服务 `/product-index.json` 和 `/product-signals.jsonl`，沿用 token 保护。
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`
  - 加载并校验 product index。
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`
  - 存储 product index。
- Create: `understand-anything-plugin/packages/dashboard/src/components/ProductIndexPanel.tsx`
  - 展示 topics、facts、evidence，支持 evidence 跳转 CodeViewer。
- Modify: `understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx`
  - 在 overview/sidebar 中嵌入 ProductIndexPanel。

---

## Task 1: Core Product Index Schema 和搜索

**Files:**
- Create: `understand-anything-plugin/packages/core/src/product-index.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Modify: `understand-anything-plugin/packages/core/package.json`
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-index.test.ts`

- [ ] **Step 1: 写失败测试**

Create `understand-anything-plugin/packages/core/src/__tests__/product-index.test.ts`:

```ts
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
    const results = searchProductIndex(sampleIndex, "投屏 为什么 不可用");
    expect(results.map((result) => result.topic.id)).toContain("topic:casting");
    expect(results[0].facts.map((fact) => fact.id)).toContain(
      "fact:casting-disabled-by-cast-allowed",
    );
  });

  it("returns empty results for unrelated queries", () => {
    expect(searchProductIndex(sampleIndex, "购物车 优惠券")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/__tests__/product-index.test.ts
```

Expected: FAIL，提示找不到 `../product-index.js` 或相关导出。

- [ ] **Step 3: 新增 product-index schema 和搜索**

Create `understand-anything-plugin/packages/core/src/product-index.ts`:

```ts
import Fuse, { type IFuseOptions } from "fuse.js";
import { z } from "zod";

export const ProductTopicKindSchema = z.enum(["capability", "surface", "element", "data"]);
export const ProductTopicStatusSchema = z.enum(["seeded", "indexed", "summarized", "verified"]);
export const ProductFactTypeSchema = z.enum(["behavior", "rule", "display", "mapping", "lifecycle"]);
export const ProductConfidenceSchema = z.enum(["confirmed", "inferred", "uncertain"]);
export const ProductFactMaturitySchema = z.enum(["indexed", "summarized", "verified"]);
export const ProductEvidenceRoleSchema = z.enum([
  "entry",
  "copy",
  "ui",
  "rule",
  "data",
  "lifecycle",
  "network",
  "storage",
  "analytics",
  "integration",
]);
export const ProductSignalTypeSchema = ProductEvidenceRoleSchema;

export const ProductSourcesSchema = z.object({
  knowledgeGraph: z.object({
    path: z.string().min(1),
    gitCommitHash: z.string().min(1).optional(),
    required: z.literal(true),
  }),
  domainGraph: z.object({
    path: z.string().min(1),
    available: z.boolean(),
    required: z.literal(false),
  }).optional(),
  signals: z.object({
    path: z.string().min(1),
    available: z.boolean(),
    count: z.number().int().nonnegative(),
    indexedNodes: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).optional(),
});

export const ProductEvidenceSchema = z.object({
  id: z.string().min(1),
  role: ProductEvidenceRoleSchema,
  filePath: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  nodeId: z.string().min(1).optional(),
  signalTypes: z.array(ProductSignalTypeSchema).default([]),
  tokens: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1),
  confidence: ProductConfidenceSchema,
}).superRefine((evidence, ctx) => {
  if (!evidence.filePath && !evidence.nodeId) {
    ctx.addIssue({
      code: "custom",
      message: "evidence must include filePath or nodeId",
      path: ["filePath"],
    });
  }
  if (evidence.lineRange && evidence.lineRange[1] < evidence.lineRange[0]) {
    ctx.addIssue({
      code: "custom",
      message: "lineRange end must be greater than or equal to start",
      path: ["lineRange"],
    });
  }
});

export const ProductTopicSchema = z.object({
  id: z.string().min(1),
  kind: ProductTopicKindSchema,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
  status: ProductTopicStatusSchema,
  entryEvidenceIds: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  domainRefs: z.array(z.string().min(1)).default([]),
});

export const ProductFactSchema = z.object({
  id: z.string().min(1),
  topicIds: z.array(z.string().min(1)).min(1),
  type: ProductFactTypeSchema,
  text: z.string().min(1),
  conditions: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  confidence: ProductConfidenceSchema,
  maturity: ProductFactMaturitySchema,
}).superRefine((fact, ctx) => {
  if (fact.confidence === "confirmed" && fact.evidenceIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "confirmed facts must reference evidence",
      path: ["evidenceIds"],
    });
  }
});

export const ProductCoverageWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  topicId: z.string().min(1).optional(),
});

export const ProductCoverageSchema = z.object({
  platformProfiles: z.array(z.string().min(1)).default([]),
  entryPoints: z.number().int().nonnegative(),
  indexedTopics: z.number().int().nonnegative(),
  confirmedEvidence: z.number().int().nonnegative(),
  generatedFacts: z.number().int().nonnegative(),
  warnings: z.array(ProductCoverageWarningSchema).default([]),
});

const ProductProjectSchema = z.object({
  name: z.string().min(1),
  platforms: z.array(z.string().min(1)).default([]),
  languages: z.array(z.string().min(1)).default([]),
  frameworks: z.array(z.string().min(1)).default([]),
  analyzedAt: z.string().min(1),
  gitCommitHash: z.string().min(1).optional(),
});

export const ProductSignalSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  filePath: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  types: z.array(ProductSignalTypeSchema).min(1),
  tokens: z.array(z.string().min(1)).default([]),
  score: z.number().min(0).max(1),
});

export const ProductIndexSchema = z.object({
  version: z.string().min(1),
  kind: z.literal("product-index"),
  project: ProductProjectSchema,
  sources: ProductSourcesSchema,
  topics: z.array(ProductTopicSchema).default([]),
  facts: z.array(ProductFactSchema).default([]),
  evidence: z.array(ProductEvidenceSchema).default([]),
  coverage: ProductCoverageSchema,
}).superRefine((index, ctx) => {
  const evidenceIds = new Set(index.evidence.map((evidence) => evidence.id));
  const topicIds = new Set(index.topics.map((topic) => topic.id));

  for (const topic of index.topics) {
    for (const evidenceId of [...topic.entryEvidenceIds, ...topic.evidenceIds]) {
      if (!evidenceIds.has(evidenceId)) {
        ctx.addIssue({
          code: "custom",
          message: `topic ${topic.id} references unknown evidence id ${evidenceId}`,
          path: ["topics"],
        });
      }
    }
  }

  for (const fact of index.facts) {
    for (const topicId of fact.topicIds) {
      if (!topicIds.has(topicId)) {
        ctx.addIssue({
          code: "custom",
          message: `fact ${fact.id} references unknown topic id ${topicId}`,
          path: ["facts"],
        });
      }
    }
    for (const evidenceId of fact.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        ctx.addIssue({
          code: "custom",
          message: `fact ${fact.id} references unknown evidence id ${evidenceId}`,
          path: ["facts"],
        });
      }
    }
  }
});

export type ProductTopicKind = z.infer<typeof ProductTopicKindSchema>;
export type ProductTopicStatus = z.infer<typeof ProductTopicStatusSchema>;
export type ProductFactType = z.infer<typeof ProductFactTypeSchema>;
export type ProductConfidence = z.infer<typeof ProductConfidenceSchema>;
export type ProductEvidenceRole = z.infer<typeof ProductEvidenceRoleSchema>;
export type ProductSignal = z.infer<typeof ProductSignalSchema>;
export type ProductEvidence = z.infer<typeof ProductEvidenceSchema>;
export type ProductTopic = z.infer<typeof ProductTopicSchema>;
export type ProductFact = z.infer<typeof ProductFactSchema>;
export type ProductIndex = z.infer<typeof ProductIndexSchema>;

export type ProductIndexValidationResult =
  | { success: true; data: ProductIndex; error?: undefined }
  | { success: false; data?: undefined; error: string };

export interface ProductIndexSearchResult {
  topic: ProductTopic;
  facts: ProductFact[];
  evidence: ProductEvidence[];
  score: number;
  matchedText: string[];
}

interface ProductIndexSearchDocument {
  topic: ProductTopic;
  facts: ProductFact[];
  evidence: ProductEvidence[];
  searchableText: string[];
  topicName: string;
  aliases: string[];
  summary: string;
  factText: string[];
  evidenceTokens: string[];
}

const PRODUCT_INDEX_FUSE_OPTIONS: IFuseOptions<ProductIndexSearchDocument> = {
  keys: [
    { name: "topicName", weight: 0.25 },
    { name: "aliases", weight: 0.2 },
    { name: "summary", weight: 0.15 },
    { name: "factText", weight: 0.25 },
    { name: "evidenceTokens", weight: 0.15 },
  ],
  threshold: 0.38,
  includeScore: true,
  ignoreLocation: true,
  useExtendedSearch: true,
};

export function validateProductIndex(data: unknown): ProductIndexValidationResult {
  const result = ProductIndexSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    error: result.error.issues.map((issue) => issue.message).join("; "),
  };
}

export function searchProductIndex(
  index: ProductIndex,
  query: string,
  limit = 8,
): ProductIndexSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed || limit <= 0) return [];

  const documents = buildSearchDocuments(index);
  const tokens = tokenizeQuery(trimmed);
  const fuse = new Fuse(documents, PRODUCT_INDEX_FUSE_OPTIONS);
  const extendedQuery = tokens.join(" | ");

  return fuse.search(extendedQuery)
    .filter((result) => documentMatchesTokens(result.item, tokens))
    .slice(0, limit)
    .map((result) => ({
      topic: result.item.topic,
      facts: result.item.facts,
      evidence: result.item.evidence,
      score: result.score ?? 0,
      matchedText: collectMatchedText(result.item, trimmed),
    }));
}

function buildSearchDocuments(index: ProductIndex): ProductIndexSearchDocument[] {
  const factsByTopic = new Map<string, ProductFact[]>();
  for (const fact of index.facts) {
    for (const topicId of fact.topicIds) {
      const facts = factsByTopic.get(topicId) ?? [];
      facts.push(fact);
      factsByTopic.set(topicId, facts);
    }
  }

  const evidenceById = new Map(index.evidence.map((evidence) => [evidence.id, evidence]));
  return index.topics.map((topic) => {
    const facts = factsByTopic.get(topic.id) ?? [];
    const evidence = Array.from(new Set([...topic.entryEvidenceIds, ...topic.evidenceIds]))
      .map((id) => evidenceById.get(id))
      .filter((item): item is ProductEvidence => Boolean(item));
    const factText = facts.flatMap((fact) => [fact.text, ...fact.conditions]);
    const evidenceTokens = evidence.flatMap((item) => [
      ...item.tokens,
      item.filePath,
      item.symbol,
      item.reason,
    ].filter((value): value is string => Boolean(value)));
    const searchableText = [
      topic.name,
      topic.summary,
      ...topic.aliases,
      ...factText,
      ...evidenceTokens,
    ];
    return {
      topic,
      facts,
      evidence,
      searchableText,
      topicName: topic.name,
      aliases: topic.aliases,
      summary: topic.summary,
      factText,
      evidenceTokens,
    };
  });
}

function documentMatchesTokens(document: ProductIndexSearchDocument, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const combined = document.searchableText.join(" ").toLowerCase();
  return tokens.every((token) => combined.includes(token.toLowerCase()));
}

function collectMatchedText(document: ProductIndexSearchDocument, query: string): string[] {
  const tokens = tokenizeQuery(query);
  const matched = document.searchableText.filter((text) => {
    const lower = text.toLowerCase();
    return tokens.some((token) => lower.includes(token.toLowerCase()));
  });
  return Array.from(new Set(matched)).slice(0, 8);
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^(怎么|如何|为什么)/, "").replace(/[?？。！!呢吗]+$/u, ""))
    .filter(Boolean);
}
```

- [ ] **Step 4: 导出 core API**

Modify `understand-anything-plugin/packages/core/src/index.ts`:

```ts
export {
  ProductIndexSchema,
  ProductSignalSchema,
  validateProductIndex,
  searchProductIndex,
  type ProductIndex,
  type ProductTopic,
  type ProductFact,
  type ProductEvidence,
  type ProductSignal,
  type ProductIndexSearchResult,
  type ProductIndexValidationResult,
} from "./product-index.js";
```

Modify `understand-anything-plugin/packages/core/package.json` exports:

```json
"./product-index": {
  "types": "./dist/product-index.d.ts",
  "default": "./dist/product-index.js"
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/__tests__/product-index.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add understand-anything-plugin/packages/core/src/product-index.ts understand-anything-plugin/packages/core/src/index.ts understand-anything-plugin/packages/core/package.json understand-anything-plugin/packages/core/src/__tests__/product-index.test.ts
git commit -m "feat(core): add product index schema"
```

---

## Task 2: Product Index 持久化和路径安全

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/persistence/index.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-index-persistence.test.ts`

- [ ] **Step 1: 写失败测试**

Create `understand-anything-plugin/packages/core/src/__tests__/product-index-persistence.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProductIndex, saveProductIndex } from "../persistence/index.js";
import type { ProductIndex } from "../product-index.js";

const testRoot = join(tmpdir(), "ua-product-index-persist-test");

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
      id: "topic:player-page",
      kind: "surface",
      name: "播放页",
      aliases: ["PlayerActivity"],
      summary: "播放入口。",
      status: "indexed",
      entryEvidenceIds: ["ev:player-entry"],
      evidenceIds: ["ev:player-entry"],
      domainRefs: [],
    },
  ],
  facts: [],
  evidence: [
    {
      id: "ev:player-entry",
      role: "entry",
      filePath: "player/PlayerActivity.kt",
      symbol: "PlayerActivity",
      nodeId: "class:player/PlayerActivity.kt:PlayerActivity",
      signalTypes: ["entry"],
      tokens: ["player"],
      reason: "播放页 Activity 入口。",
      confidence: "confirmed",
    },
  ],
  coverage: {
    platformProfiles: ["android"],
    entryPoints: 1,
    indexedTopics: 1,
    confirmedEvidence: 1,
    generatedFacts: 0,
    warnings: [],
  },
};

describe("product index persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("saves and loads product-index.json", () => {
    saveProductIndex(testRoot, productIndex);
    const loaded = loadProductIndex(testRoot);
    expect(loaded?.topics[0].id).toBe("topic:player-page");
    expect(existsSync(join(testRoot, ".understand-anything", "product-index.json"))).toBe(true);
  });

  it("returns null when product-index.json does not exist", () => {
    expect(loadProductIndex(testRoot)).toBeNull();
  });

  it("sanitises absolute paths inside the project root", () => {
    const withAbsolutePath: ProductIndex = {
      ...productIndex,
      evidence: [
        {
          ...productIndex.evidence[0],
          filePath: join(testRoot, "src/player/PlayerActivity.kt"),
        },
      ],
    };
    saveProductIndex(testRoot, withAbsolutePath);
    const loaded = loadProductIndex(testRoot);
    expect(loaded?.evidence[0].filePath).toBe("src/player/PlayerActivity.kt");
  });

  it("rejects unsafe relative evidence paths without node fallback", () => {
    const unsafe: ProductIndex = {
      ...productIndex,
      evidence: [
        {
          ...productIndex.evidence[0],
          filePath: "../secret/PlayerActivity.kt",
          nodeId: undefined,
        },
      ],
    };
    expect(() => saveProductIndex(testRoot, unsafe)).toThrow(/Invalid product evidence filePath/);
  });

  it("drops unsafe filePath when nodeId is available", () => {
    const withNodeFallback: ProductIndex = {
      ...productIndex,
      evidence: [
        {
          ...productIndex.evidence[0],
          filePath: "C:/Users/alice/project/PlayerActivity.kt",
          nodeId: "class:player/PlayerActivity.kt:PlayerActivity",
        },
      ],
    };
    saveProductIndex(testRoot, withNodeFallback);
    const loaded = loadProductIndex(testRoot);
    expect(loaded?.evidence[0].filePath).toBeUndefined();
    expect(loaded?.evidence[0].nodeId).toBe("class:player/PlayerActivity.kt:PlayerActivity");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/__tests__/product-index-persistence.test.ts
```

Expected: FAIL，提示 `saveProductIndex` 或 `loadProductIndex` 不存在。

- [ ] **Step 3: 实现持久化**

Modify `understand-anything-plugin/packages/core/src/persistence/index.ts` imports:

```ts
import type { ProductIndex } from "../product-index.js";
import { validateProductIndex } from "../product-index.js";
```

Add constants near existing file constants:

```ts
const PRODUCT_INDEX_FILE = "product-index.json";
```

Add helpers:

```ts
function sanitiseEvidenceFilePath(
  filePath: string,
  projectRoot: string,
  hasNodeFallback: boolean,
): string | undefined {
  if (
    filePath.includes("\\") ||
    filePath.includes("\0") ||
    /^[A-Za-z]:/.test(filePath) ||
    filePath.startsWith("//")
  ) {
    if (hasNodeFallback) return undefined;
    throw new Error(`Invalid product evidence filePath: ${filePath}`);
  }

  if (!isAbsolute(filePath)) {
    const parts = filePath.split("/");
    if (parts.includes("..") || parts.includes("")) {
      if (hasNodeFallback) return undefined;
      throw new Error(`Invalid product evidence filePath: ${filePath}`);
    }
    return filePath;
  }

  const normalRoot = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;
  if (filePath.startsWith(normalRoot) || filePath === projectRoot) {
    return relative(projectRoot, filePath);
  }

  if (hasNodeFallback) return undefined;
  throw new Error(`Invalid product evidence filePath: ${filePath}`);
}

function sanitiseProductIndexFilePaths(index: ProductIndex, projectRoot: string): ProductIndex {
  return {
    ...index,
    evidence: index.evidence.map((evidence) => {
      if (!evidence.filePath) return evidence;
      const filePath = sanitiseEvidenceFilePath(
        evidence.filePath,
        projectRoot,
        Boolean(evidence.nodeId),
      );
      if (!filePath) {
        const { filePath: _filePath, ...rest } = evidence;
        return rest;
      }
      return { ...evidence, filePath };
    }),
  };
}
```

Add exported functions near `saveDomainGraph`/`loadDomainGraph`:

```ts
export function saveProductIndex(projectRoot: string, index: ProductIndex): void {
  const validation = validateProductIndex(index);
  if (!validation.success) {
    throw new Error(`Invalid product index: ${validation.error}`);
  }

  const dir = ensureDir(projectRoot);
  const sanitised = sanitiseProductIndexFilePaths(index, projectRoot);
  const secondValidation = validateProductIndex(sanitised);
  if (!secondValidation.success) {
    throw new Error(`Invalid product index after sanitising: ${secondValidation.error}`);
  }

  writeFileSync(
    join(dir, PRODUCT_INDEX_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadProductIndex(
  projectRoot: string,
  options?: { validate?: boolean },
): ProductIndex | null {
  const filePath = join(projectRoot, UA_DIR, PRODUCT_INDEX_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  if (options?.validate !== false) {
    const result = validateProductIndex(data);
    if (!result.success) {
      throw new Error(`Invalid product index: ${result.error}`);
    }
    return result.data;
  }

  return data as ProductIndex;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/__tests__/product-index-persistence.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add understand-anything-plugin/packages/core/src/persistence/index.ts understand-anything-plugin/packages/core/src/__tests__/product-index-persistence.test.ts
git commit -m "feat(core): persist product index"
```

---

## Task 3: 确定性 Product Index Builder

**Files:**
- Create: `understand-anything-plugin/packages/core/src/product-index-builder.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-index-builder.test.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试**

Create `understand-anything-plugin/packages/core/src/__tests__/product-index-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../types.js";
import {
  buildDeterministicProductIndex,
  buildProductSignals,
  enumerateProductEntrySeeds,
} from "../product-index-builder.js";

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
    {
      id: "class:player/PlayerActivity.kt:PlayerActivity",
      type: "class",
      name: "PlayerActivity",
      filePath: "player/PlayerActivity.kt",
      lineRange: [10, 80],
      summary: "播放页 Activity，包含投屏按钮入口。",
      tags: ["android", "activity", "player", "cast"],
      complexity: "moderate",
    },
    {
      id: "function:player/CastManager.kt:checkCastAvailable",
      type: "function",
      name: "checkCastAvailable",
      filePath: "player/CastManager.kt",
      lineRange: [40, 68],
      summary: "根据 castAllowed 字段和设备状态判断投屏是否可用。",
      tags: ["cast", "rule"],
      complexity: "moderate",
    },
    {
      id: "class:common/BaseActivity.kt:BaseActivity",
      type: "class",
      name: "BaseActivity",
      filePath: "common/BaseActivity.kt",
      summary: "Common base Activity.",
      tags: ["base"],
      complexity: "simple",
    },
  ],
  edges: [
    {
      source: "class:player/PlayerActivity.kt:PlayerActivity",
      target: "function:player/CastManager.kt:checkCastAvailable",
      type: "calls",
      direction: "forward",
      weight: 0.8,
    },
    {
      source: "class:player/PlayerActivity.kt:PlayerActivity",
      target: "class:common/BaseActivity.kt:BaseActivity",
      type: "inherits",
      direction: "forward",
      weight: 0.4,
    },
  ],
  layers: [],
  tour: [],
};

describe("product index builder", () => {
  it("enumerates Android entry seeds from Activity class nodes", () => {
    const seeds = enumerateProductEntrySeeds(graph, { platform: "android" });
    expect(seeds.map((seed) => seed.entryNodeId)).toContain(
      "class:player/PlayerActivity.kt:PlayerActivity",
    );
    expect(seeds[0].entryKind).toBe("activity");
  });

  it("builds deterministic product signals without LLM", () => {
    const signals = buildProductSignals(graph, { platform: "android" });
    expect(signals.some((signal) => signal.types.includes("entry"))).toBe(true);
    expect(signals.some((signal) => signal.tokens.includes("cast"))).toBe(true);
  });

  it("builds topics and evidence from entry-driven graph expansion", () => {
    const index = buildDeterministicProductIndex(graph, undefined, {
      platform: "android",
      analyzedAt: "2026-05-18T00:00:00.000Z",
      maxDepth: 4,
      maxNodesPerTopic: 20,
      maxFrontierPerDepth: 10,
      maxEvidencePerTopic: 10,
      hubDegreeThreshold: 20,
    });

    expect(index.kind).toBe("product-index");
    expect(index.topics.length).toBeGreaterThan(0);
    expect(index.evidence.map((evidence) => evidence.nodeId)).toContain(
      "class:player/PlayerActivity.kt:PlayerActivity",
    );
    expect(index.evidence.map((evidence) => evidence.nodeId)).toContain(
      "function:player/CastManager.kt:checkCastAvailable",
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/__tests__/product-index-builder.test.ts
```

Expected: FAIL，提示 `../product-index-builder.js` 不存在。

- [ ] **Step 3: 实现 builder**

Create `understand-anything-plugin/packages/core/src/product-index-builder.ts`:

```ts
import type { GraphEdge, GraphNode, KnowledgeGraph } from "./types.js";
import type {
  ProductEvidence,
  ProductEvidenceRole,
  ProductIndex,
  ProductSignal,
  ProductTopic,
} from "./product-index.js";

export interface ProductProfileOptions {
  platform: "android" | string;
  entryPatterns?: string[];
  analyzedAt?: string;
  maxDepth?: number;
  maxNodesPerTopic?: number;
  maxFrontierPerDepth?: number;
  maxEvidencePerTopic?: number;
  hubDegreeThreshold?: number;
}

export interface ProductEntrySeed {
  id: string;
  source: "entry-point";
  entryKind: string;
  nameCandidates: string[];
  entryNodeId: string;
  score: number;
}

const DEFAULT_ENTRY_PATTERNS = [
  /Activity$/,
  /Fragment$/,
  /DialogFragment$/,
  /ActivityProxy$/,
  /Router$/,
  /RouteTable$/,
  /Service$/,
  /Receiver$/,
  /Worker$/,
  /Job$/,
  /Scheduler$/,
  /Handler$/,
];

const SIGNAL_KEYWORDS: Array<{ role: ProductEvidenceRole; keywords: string[] }> = [
  { role: "entry", keywords: ["activity", "fragment", "router", "proxy", "service", "receiver", "worker"] },
  { role: "copy", keywords: ["string", "message", "text", "title", "subtitle", "label", "toast", "dialog"] },
  { role: "ui", keywords: ["show", "hide", "visible", "gone", "enabled", "disabled", "click", "button", "view"] },
  { role: "rule", keywords: ["allowed", "enable", "disable", "vip", "member", "permission", "policy", "guard"] },
  { role: "data", keywords: ["dto", "model", "response", "field", "enum", "config", "status", "type"] },
  { role: "lifecycle", keywords: ["start", "stop", "pause", "resume", "callback", "listener", "schedule"] },
  { role: "network", keywords: ["api", "request", "upload", "sync", "retry", "http"] },
  { role: "storage", keywords: ["cache", "store", "database", "dao", "queue", "record"] },
  { role: "analytics", keywords: ["track", "event", "exposure", "click", "analytics"] },
  { role: "integration", keywords: ["sdk", "cast", "dlna", "push", "payment", "bluetooth", "system"] },
];

const EDGE_WEIGHT: Record<string, number> = {
  calls: 1,
  contains: 1,
  routes: 0.9,
  reads_from: 0.9,
  writes_to: 0.9,
  defines_schema: 0.85,
  imports: 0.55,
  depends_on: 0.5,
  configures: 0.5,
  documents: 0.35,
  related: 0.2,
  similar_to: 0.2,
};

export function enumerateProductEntrySeeds(
  graph: KnowledgeGraph,
  options: ProductProfileOptions,
): ProductEntrySeed[] {
  const patterns = compileEntryPatterns(options.entryPatterns);
  const seeds: ProductEntrySeed[] = [];

  for (const node of graph.nodes) {
    const haystack = `${node.name} ${node.filePath ?? ""} ${node.summary} ${node.tags.join(" ")}`;
    if (!patterns.some((pattern) => pattern.test(node.name) || pattern.test(node.filePath ?? ""))) {
      continue;
    }

    const entryKind = inferEntryKind(node);
    seeds.push({
      id: `seed:${slugify(node.filePath ?? node.name)}:${slugify(node.name)}`,
      source: "entry-point",
      entryKind,
      nameCandidates: Array.from(new Set([node.name, ...(node.filePath ? [node.filePath] : [])])),
      entryNodeId: node.id,
      score: scoreTextForProductSignals(haystack),
    });
  }

  return seeds.sort((a, b) => b.score - a.score);
}

export function buildProductSignals(
  graph: KnowledgeGraph,
  options: ProductProfileOptions,
): ProductSignal[] {
  const signals: ProductSignal[] = [];
  const seen = new Set<string>();
  const entryNodeIds = new Set(enumerateProductEntrySeeds(graph, options).map((seed) => seed.entryNodeId));

  for (const node of graph.nodes) {
    const text = `${node.name} ${node.filePath ?? ""} ${node.summary} ${node.tags.join(" ")}`;
    const tokens = extractTokens(text);
    const roles = inferSignalRoles(text);
    if (entryNodeIds.has(node.id) && !roles.includes("entry")) roles.unshift("entry");
    if (roles.length === 0) continue;

    const score = Math.max(scoreTextForProductSignals(text), entryNodeIds.has(node.id) ? 0.8 : 0);
    if (score < 0.25) continue;

    const key = `${node.id}:${roles.join(",")}:${node.lineRange?.join("-") ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    signals.push({
      id: `sig:${signals.length + 1}`,
      nodeId: node.id,
      filePath: node.filePath,
      symbol: node.name,
      lineRange: node.lineRange,
      types: roles.slice(0, 5),
      tokens: tokens.slice(0, 12),
      score,
    });
  }

  return signals;
}

export function buildDeterministicProductIndex(
  graph: KnowledgeGraph,
  domainGraph: KnowledgeGraph | undefined,
  options: ProductProfileOptions,
): ProductIndex {
  const analyzedAt = options.analyzedAt ?? new Date().toISOString();
  const seeds = enumerateProductEntrySeeds(graph, options);
  const signals = buildProductSignals(graph, options);
  const signalByNodeId = groupSignalsByNodeId(signals);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesByNodeId = buildAdjacency(graph.edges);
  const degreeByNodeId = buildDegreeMap(graph.edges);
  const evidenceById = new Map<string, ProductEvidence>();
  const topics: ProductTopic[] = [];

  for (const seed of seeds) {
    const expandedNodeIds = expandFromSeed(seed, graph, edgesByNodeId, degreeByNodeId, options);
    const evidenceIds: string[] = [];
    const entryEvidenceIds: string[] = [];

    for (const nodeId of expandedNodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const nodeSignals = signalByNodeId.get(nodeId) ?? [];
      if (nodeSignals.length === 0 && nodeId !== seed.entryNodeId) continue;
      const evidence = buildEvidenceFromNode(node, nodeSignals, nodeId === seed.entryNodeId);
      if (!evidenceById.has(evidence.id)) evidenceById.set(evidence.id, evidence);
      evidenceIds.push(evidence.id);
      if (nodeId === seed.entryNodeId) entryEvidenceIds.push(evidence.id);
      if (evidenceIds.length >= (options.maxEvidencePerTopic ?? 50)) break;
    }

    if (evidenceIds.length === 0) continue;
    topics.push({
      id: `topic:${slugify(seed.nameCandidates[0])}`,
      kind: seed.entryKind === "activity" || seed.entryKind === "fragment" ? "surface" : "capability",
      name: seed.nameCandidates[0],
      aliases: seed.nameCandidates.slice(1, 6),
      summary: `${seed.nameCandidates[0]} 相关产品入口，已索引 ${evidenceIds.length} 条代码证据。`,
      status: evidenceIds.length > 1 ? "indexed" : "seeded",
      entryEvidenceIds,
      evidenceIds: Array.from(new Set(evidenceIds)),
      domainRefs: collectDomainRefs(domainGraph, seed.nameCandidates),
    });
  }

  const evidence = Array.from(evidenceById.values());
  return {
    version: "1.0.0",
    kind: "product-index",
    project: {
      name: graph.project.name,
      platforms: [options.platform],
      languages: graph.project.languages,
      frameworks: graph.project.frameworks,
      analyzedAt,
      gitCommitHash: graph.project.gitCommitHash,
    },
    sources: {
      knowledgeGraph: {
        path: ".understand-anything/knowledge-graph.json",
        gitCommitHash: graph.project.gitCommitHash,
        required: true,
      },
      domainGraph: domainGraph
        ? { path: ".understand-anything/domain-graph.json", available: true, required: false }
        : undefined,
      signals: {
        path: ".understand-anything/product-signals.jsonl",
        available: signals.length > 0,
        count: signals.length,
        indexedNodes: new Set(signals.map((signal) => signal.nodeId)).size,
        truncated: false,
      },
    },
    topics,
    facts: [],
    evidence,
    coverage: {
      platformProfiles: [options.platform],
      entryPoints: seeds.length,
      indexedTopics: topics.length,
      confirmedEvidence: evidence.filter((item) => item.confidence === "confirmed").length,
      generatedFacts: 0,
      warnings: [],
    },
  };
}

function compileEntryPatterns(patterns?: string[]): RegExp[] {
  if (!patterns || patterns.length === 0) return DEFAULT_ENTRY_PATTERNS;
  return patterns.map((pattern) => new RegExp(pattern.replace(/\*/g, ".*") + "$"));
}

function inferEntryKind(node: GraphNode): string {
  const text = `${node.name} ${node.filePath ?? ""}`.toLowerCase();
  if (text.includes("activity")) return "activity";
  if (text.includes("fragment")) return "fragment";
  if (text.includes("router") || text.includes("route")) return "router";
  if (text.includes("service")) return "service";
  if (text.includes("receiver")) return "receiver";
  if (text.includes("worker")) return "worker";
  return "entry";
}

function inferSignalRoles(text: string): ProductEvidenceRole[] {
  const lower = text.toLowerCase();
  return SIGNAL_KEYWORDS
    .filter(({ keywords }) => keywords.some((keyword) => lower.includes(keyword)))
    .map(({ role }) => role);
}

function scoreTextForProductSignals(text: string): number {
  const roles = inferSignalRoles(text);
  if (roles.length === 0) return 0;
  return Math.min(1, 0.2 + roles.length * 0.12);
}

function extractTokens(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/[^A-Za-z0-9_\u4e00-\u9fa5]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && token.length <= 40),
  ));
}

function buildAdjacency(edges: GraphEdge[]): Map<string, Array<{ nodeId: string; type: string; weight: number }>> {
  const adjacency = new Map<string, Array<{ nodeId: string; type: string; weight: number }>>();
  for (const edge of edges) {
    const weight = EDGE_WEIGHT[edge.type] ?? 0.1;
    const forward = adjacency.get(edge.source) ?? [];
    forward.push({ nodeId: edge.target, type: edge.type, weight });
    adjacency.set(edge.source, forward);

    const backward = adjacency.get(edge.target) ?? [];
    backward.push({ nodeId: edge.source, type: edge.type, weight: weight * 0.7 });
    adjacency.set(edge.target, backward);
  }
  return adjacency;
}

function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

function expandFromSeed(
  seed: ProductEntrySeed,
  graph: KnowledgeGraph,
  adjacency: Map<string, Array<{ nodeId: string; type: string; weight: number }>>,
  degree: Map<string, number>,
  options: ProductProfileOptions,
): string[] {
  const maxDepth = options.maxDepth ?? 8;
  const maxNodes = options.maxNodesPerTopic ?? 240;
  const maxFrontier = options.maxFrontierPerDepth ?? 40;
  const hubThreshold = options.hubDegreeThreshold ?? 80;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>([seed.entryNodeId]);
  const collected = [seed.entryNodeId];
  let frontier = [{ nodeId: seed.entryNodeId, score: 1 }];

  for (let depth = 1; depth <= maxDepth && collected.length < maxNodes; depth += 1) {
    const candidates: Array<{ nodeId: string; score: number }> = [];
    for (const item of frontier) {
      for (const edge of adjacency.get(item.nodeId) ?? []) {
        if (visited.has(edge.nodeId)) continue;
        const node = nodeById.get(edge.nodeId);
        if (!node) continue;
        const hubPenalty = (degree.get(edge.nodeId) ?? 0) > hubThreshold ? 0.3 : 1;
        const productScore = scoreTextForProductSignals(`${node.name} ${node.filePath ?? ""} ${node.summary} ${node.tags.join(" ")}`);
        const score = item.score * edge.weight * hubPenalty + productScore;
        candidates.push({ nodeId: edge.nodeId, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    frontier = candidates.slice(0, maxFrontier);
    if (frontier.length === 0) break;
    for (const item of frontier) {
      if (visited.has(item.nodeId)) continue;
      visited.add(item.nodeId);
      collected.push(item.nodeId);
      if (collected.length >= maxNodes) break;
    }
  }

  return collected;
}

function groupSignalsByNodeId(signals: ProductSignal[]): Map<string, ProductSignal[]> {
  const groups = new Map<string, ProductSignal[]>();
  for (const signal of signals) {
    const list = groups.get(signal.nodeId) ?? [];
    list.push(signal);
    groups.set(signal.nodeId, list);
  }
  return groups;
}

function buildEvidenceFromNode(node: GraphNode, signals: ProductSignal[], isEntry: boolean): ProductEvidence {
  const roles = Array.from(new Set(signals.flatMap((signal) => signal.types)));
  const role = isEntry ? "entry" : roles[0] ?? "data";
  const tokens = Array.from(new Set(signals.flatMap((signal) => signal.tokens)));
  return {
    id: `ev:${slugify(node.id)}`,
    role,
    filePath: node.filePath,
    symbol: node.name,
    lineRange: node.lineRange,
    nodeId: node.id,
    signalTypes: roles,
    tokens,
    reason: isEntry ? `${node.name} 是产品入口。` : `${node.name} 命中产品信号：${roles.join(", ")}。`,
    confidence: isEntry || signals.some((signal) => signal.score >= 0.5) ? "confirmed" : "inferred",
  };
}

function collectDomainRefs(domainGraph: KnowledgeGraph | undefined, candidates: string[]): string[] {
  if (!domainGraph) return [];
  const lowerCandidates = candidates.map((candidate) => candidate.toLowerCase());
  return domainGraph.nodes
    .filter((node) => node.type === "domain" || node.type === "flow")
    .filter((node) => lowerCandidates.some((candidate) =>
      node.name.toLowerCase().includes(candidate) || node.summary.toLowerCase().includes(candidate),
    ))
    .map((node) => node.id)
    .slice(0, 5);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}
```

- [ ] **Step 4: 导出 builder API**

Modify `understand-anything-plugin/packages/core/src/index.ts`:

```ts
export {
  enumerateProductEntrySeeds,
  buildProductSignals,
  buildDeterministicProductIndex,
  type ProductEntrySeed,
  type ProductProfileOptions,
} from "./product-index-builder.js";
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/__tests__/product-index-builder.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add understand-anything-plugin/packages/core/src/product-index-builder.ts understand-anything-plugin/packages/core/src/index.ts understand-anything-plugin/packages/core/src/__tests__/product-index-builder.test.ts
git commit -m "feat(core): build deterministic product index"
```

---

## Task 4: `/understand-product` CLI、Skill 和 Agent Prompt

**Files:**
- Create: `understand-anything-plugin/src/product-index-cli.ts`
- Modify: `understand-anything-plugin/src/index.ts`
- Create: `understand-anything-plugin/skills/understand-product/SKILL.md`
- Create: `understand-anything-plugin/agents/product-index-analyzer.md`
- Test: `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`

- [ ] **Step 1: 写 CLI 测试**

Create `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KnowledgeGraph } from "@understand-anything/core";
import { runProductIndexCli } from "../product-index-cli.js";

const testRoot = join(tmpdir(), "ua-product-index-cli-test");

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
      summary: "播放页 Activity，包含投屏入口。",
      tags: ["activity", "player", "cast"],
      complexity: "moderate",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("product-index CLI", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(join(testRoot, ".understand-anything"), { recursive: true });
    writeFileSync(
      join(testRoot, ".understand-anything", "knowledge-graph.json"),
      JSON.stringify(graph, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("builds product-index.json and product-signals.jsonl", async () => {
    const result = await runProductIndexCli([testRoot, "--platform", "android", "--fast"]);
    expect(result.productIndexPath.endsWith("product-index.json")).toBe(true);
    expect(existsSync(join(testRoot, ".understand-anything", "product-index.json"))).toBe(true);
    expect(existsSync(join(testRoot, ".understand-anything", "product-signals.jsonl"))).toBe(true);

    const raw = JSON.parse(readFileSync(join(testRoot, ".understand-anything", "product-index.json"), "utf-8"));
    expect(raw.topics.length).toBeGreaterThan(0);
  });

  it("throws a clear error when knowledge graph is missing", async () => {
    rmSync(join(testRoot, ".understand-anything", "knowledge-graph.json"));
    await expect(runProductIndexCli([testRoot, "--platform", "android", "--fast"]))
      .rejects.toThrow(/knowledge-graph\.json not found/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts
```

Expected: FAIL，提示 `../product-index-cli.js` 不存在。

- [ ] **Step 3: 实现 CLI**

Create `understand-anything-plugin/src/product-index-cli.ts`:

```ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDeterministicProductIndex,
  buildProductSignals,
  loadDomainGraph,
  loadGraph,
  saveProductIndex,
  type ProductProfileOptions,
} from "@understand-anything/core";

export interface ProductIndexCliResult {
  projectRoot: string;
  productIndexPath: string;
  productSignalsPath: string;
  topics: number;
  evidence: number;
  signals: number;
}

export async function runProductIndexCli(argv: string[]): Promise<ProductIndexCliResult> {
  const options = parseArgs(argv);
  const graphPath = join(options.projectRoot, ".understand-anything", "knowledge-graph.json");
  if (!existsSync(graphPath)) {
    throw new Error(".understand-anything/knowledge-graph.json not found. 请先运行 /understand。");
  }

  const graph = loadGraph(options.projectRoot);
  if (!graph) {
    throw new Error("Failed to load knowledge graph.");
  }
  const domainGraph = loadDomainGraph(options.projectRoot, { validate: false }) ?? undefined;

  const builderOptions: ProductProfileOptions = {
    platform: options.platform,
    entryPatterns: options.entryPatterns,
    analyzedAt: new Date().toISOString(),
    maxDepth: options.maxDepth,
    maxNodesPerTopic: options.maxNodesPerTopic,
    maxFrontierPerDepth: options.maxFrontierPerDepth,
    maxEvidencePerTopic: options.maxEvidencePerTopic,
    hubDegreeThreshold: options.hubDegreeThreshold,
  };

  const signals = buildProductSignals(graph, builderOptions);
  const index = buildDeterministicProductIndex(graph, domainGraph, builderOptions);

  const signalsPath = join(options.projectRoot, ".understand-anything", "product-signals.jsonl");
  writeFileSync(
    signalsPath,
    signals.map((signal) => JSON.stringify(signal)).join("\n") + (signals.length > 0 ? "\n" : ""),
    "utf-8",
  );

  saveProductIndex(options.projectRoot, index);

  return {
    projectRoot: options.projectRoot,
    productIndexPath: join(options.projectRoot, ".understand-anything", "product-index.json"),
    productSignalsPath: signalsPath,
    topics: index.topics.length,
    evidence: index.evidence.length,
    signals: signals.length,
  };
}

interface ParsedArgs {
  projectRoot: string;
  platform: string;
  fast: boolean;
  entryPatterns?: string[];
  maxDepth: number;
  maxNodesPerTopic: number;
  maxFrontierPerDepth: number;
  maxEvidencePerTopic: number;
  hubDegreeThreshold: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const projectRoot = argv[0];
  if (!projectRoot) {
    throw new Error("Usage: product-index-cli <project-root> [--platform android] [--fast]");
  }

  const getValue = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };

  const entryPatternsValue = getValue("--entry-patterns", "");
  return {
    projectRoot,
    platform: getValue("--platform", "android"),
    fast: argv.includes("--fast"),
    entryPatterns: entryPatternsValue ? entryPatternsValue.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
    maxDepth: Number(getValue("--max-depth", "8")),
    maxNodesPerTopic: Number(getValue("--max-nodes-per-topic", "240")),
    maxFrontierPerDepth: Number(getValue("--max-frontier-per-depth", "40")),
    maxEvidencePerTopic: Number(getValue("--max-evidence-per-topic", "50")),
    hubDegreeThreshold: Number(getValue("--hub-degree-threshold", "80")),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProductIndexCli(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
```

- [ ] **Step 4: 导出 CLI helper**

Modify `understand-anything-plugin/src/index.ts`:

```ts
export {
  runProductIndexCli,
  type ProductIndexCliResult,
} from "./product-index-cli.js";
```

- [ ] **Step 5: 创建 Skill**

Create `understand-anything-plugin/skills/understand-product/SKILL.md`:

```markdown
---
name: understand-product
description: Generate a product knowledge index for client product questions using an existing /understand knowledge graph.
argument-hint: [--platform android] [--fast] [--full] [--topic <name>]
---

# /understand-product

生成 `.understand-anything/product-index.json` 产品知识索引。第一版要求当前项目已经运行 `/understand` 并存在 `.understand-anything/knowledge-graph.json`。

## Phase 0: 准备路径

将 `PROJECT_ROOT` 设为当前工作目录。检查：

```bash
if [ ! -f "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" ]; then
  echo "Error: .understand-anything/knowledge-graph.json not found. 请先运行 /understand。"
  exit 1
fi
```

解析 `PLUGIN_ROOT` 时沿用 `/understand-domain` 的 plugin root 解析策略，优先使用运行时注入变量，然后尝试各平台常见安装路径。

## Phase 1: 确定性生成产品索引草稿

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --platform android --fast
```

该命令生成：

```text
$PROJECT_ROOT/.understand-anything/product-index.json
$PROJECT_ROOT/.understand-anything/product-signals.jsonl
```

## Phase 2: 可选 LLM 归纳

如果用户没有传 `--fast`，读取 `$PLUGIN_ROOT/agents/product-index-analyzer.md`，派发 subagent。subagent 只能基于已有 `product-index.json` 和 `product-signals.jsonl` 做 topic 命名、去重和高置信 fact 归纳，不允许重新全项目找证据。

subagent 将增强结果写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-index-enhanced.json
```

增强结果通过 CLI 或 core validator 校验成功后，覆盖 `.understand-anything/product-index.json`。

## Phase 3: 完成输出

输出中文摘要，包含：

- topics 数量
- evidence 数量
- facts 数量
- signals 数量
- 是否使用 LLM 增强
- 提示现在可以使用 `/understand-chat` 提问产品问题
```

- [ ] **Step 6: 创建 Agent Prompt**

Create `understand-anything-plugin/agents/product-index-analyzer.md`:

```markdown
---
name: product-index-analyzer
description: Normalize product index topics and summarize high-confidence facts from existing product evidence clusters.
model: inherit
---

# Product Index Analyzer

你是产品知识索引增强 agent。你只能基于输入的 `product-index.json` 和 `product-signals.jsonl` 做局部归纳。

## 输入

- `<project-root>/.understand-anything/product-index.json`
- `<project-root>/.understand-anything/product-signals.jsonl`
- 可选 `<project-root>/.understand-anything/domain-graph.json`

## 允许做的事

1. 合并明显重复的 topics。
2. 将代码入口名归一化为中文产品主题名。
3. 补充 topic aliases 和 summary。
4. 只对 evidence 足够集中的 topic 生成 facts。

## 禁止做的事

1. 不要全项目搜索新文件。
2. 不要生成没有 evidenceIds 的 fact。
3. 不要引入 evidence 中没有的业务结论。
4. 不要修改 evidence 的 filePath、nodeId、lineRange。
5. 不要把 BaseActivity、Utils、Logger 等通用实现角色当产品主题。

## 输出

写入：

```text
<project-root>/.understand-anything/intermediate/product-index-enhanced.json
```

输出必须保持 `ProductIndex` schema。所有新增或修改的 confirmed fact 必须引用 confirmed evidence。

完成后只回复中文统计摘要。
```

- [ ] **Step 7: 运行 CLI 测试**

Run:

```bash
pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-cli.test.ts
```

Expected: PASS。

- [ ] **Step 8: 构建 skill 包**

Run:

```bash
pnpm --filter @understand-anything/skill build
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add understand-anything-plugin/src/product-index-cli.ts understand-anything-plugin/src/index.ts understand-anything-plugin/src/__tests__/product-index-cli.test.ts understand-anything-plugin/skills/understand-product/SKILL.md understand-anything-plugin/agents/product-index-analyzer.md
git commit -m "feat(skill): add understand-product index command"
```

---

## Task 5: Product-aware Chat 检索和 Prompt

**Files:**
- Create: `understand-anything-plugin/src/product-index-context-builder.ts`
- Modify: `understand-anything-plugin/src/understand-chat.ts`
- Modify: `understand-anything-plugin/src/index.ts`
- Test: `understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts`
- Modify: `understand-anything-plugin/skills/understand-chat/SKILL.md`

- [ ] **Step 1: 写失败测试**

Create `understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import type { ProductIndex } from "@understand-anything/core/product-index";
import {
  buildProductIndexChatContext,
  formatProductIndexContextForPrompt,
} from "../product-index-context-builder.js";
import { buildProductAwareChatPrompt } from "../understand-chat.js";

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
      summary: "播放页 Activity。",
      tags: ["player"],
      complexity: "moderate",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
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
      conditions: [],
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
      query: "投屏在哪里",
    });
    expect(ctx.productResults.map((result) => result.topic.id)).toContain("topic:casting");
    expect(ctx.codeEvidenceNodes.map((node) => node.id)).toContain(
      "class:player/PlayerActivity.kt:PlayerActivity",
    );
  });

  it("formats product facts and evidence for prompt", () => {
    const ctx = buildProductIndexChatContext({
      graph,
      productIndex,
      query: "投屏在哪里",
    });
    const formatted = formatProductIndexContextForPrompt(ctx);
    expect(formatted).toContain("## Product Index");
    expect(formatted).toContain("投屏");
    expect(formatted).toContain("播放页提供投屏入口");
    expect(formatted).toContain("PlayerActivity.kt");
  });

  it("uses product-aware prompt when product index matches", () => {
    const prompt = buildProductAwareChatPrompt({
      graph,
      productIndex,
      query: "投屏在哪里",
    });
    expect(prompt).toContain("Product Index");
    expect(prompt).toContain("Structural Graph Context");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-context-builder.test.ts
```

Expected: FAIL，提示 context builder 不存在。

- [ ] **Step 3: 实现 product index chat context**

Create `understand-anything-plugin/src/product-index-context-builder.ts`:

```ts
import {
  searchProductIndex,
  type ProductEvidence,
  type ProductIndex,
  type ProductIndexSearchResult,
} from "@understand-anything/core/product-index";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

const MAX_PRODUCT_RESULTS = 5;
const MAX_FACTS_PER_TOPIC = 6;
const MAX_EVIDENCE_PER_TOPIC = 8;

export interface ProductIndexChatContextInput {
  graph: KnowledgeGraph;
  query: string;
  productIndex?: ProductIndex;
  domainGraph?: KnowledgeGraph;
}

export interface ProductIndexChatContext {
  query: string;
  projectName: string;
  productResults: ProductIndexSearchResult[];
  domainNodes: GraphNode[];
  codeEvidenceNodes: GraphNode[];
}

export function buildProductIndexChatContext(input: ProductIndexChatContextInput): ProductIndexChatContext {
  const productResults = input.productIndex
    ? searchProductIndex(input.productIndex, input.query, MAX_PRODUCT_RESULTS)
    : [];

  const domainIds = new Set<string>();
  const evidenceRefs: ProductEvidence[] = [];
  for (const result of productResults) {
    for (const domainRef of result.topic.domainRefs) domainIds.add(domainRef);
    evidenceRefs.push(...result.evidence);
  }

  return {
    query: input.query,
    projectName: input.graph.project.name,
    productResults,
    domainNodes: collectNodesById(input.domainGraph?.nodes ?? [], domainIds),
    codeEvidenceNodes: collectEvidenceNodes(input.graph.nodes, evidenceRefs),
  };
}

export function formatProductIndexContextForPrompt(ctx: ProductIndexChatContext): string {
  if (ctx.productResults.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Product Index");
  lines.push("");

  for (const result of ctx.productResults) {
    lines.push(`### ${result.topic.name}`);
    lines.push(`- **Topic ID:** ${result.topic.id}`);
    lines.push(`- **Kind:** ${result.topic.kind}`);
    lines.push(`- **Status:** ${result.topic.status}`);
    lines.push(`- **Summary:** ${result.topic.summary}`);
    if (result.topic.aliases.length > 0) {
      lines.push(`- **Aliases:** ${result.topic.aliases.join(", ")}`);
    }

    const facts = result.facts.slice(0, MAX_FACTS_PER_TOPIC);
    if (facts.length > 0) {
      lines.push("- **Facts:**");
      for (const fact of facts) {
        lines.push(`  - [${fact.type}/${fact.confidence}] ${fact.text}`);
        if (fact.conditions.length > 0) {
          lines.push(`    Conditions: ${fact.conditions.join(", ")}`);
        }
      }
    }

    const evidence = result.evidence.slice(0, MAX_EVIDENCE_PER_TOPIC);
    if (evidence.length > 0) {
      lines.push("- **Evidence:**");
      for (const item of evidence) {
        lines.push(`  - ${formatEvidenceLocation(item)}: ${item.reason}`);
      }
    }

    if (result.matchedText.length > 0) {
      lines.push(`- **Matched Text:** ${result.matchedText.join(" | ")}`);
    }
    lines.push("");
  }

  if (ctx.domainNodes.length > 0) {
    lines.push("## Domain Context");
    for (const node of ctx.domainNodes) {
      lines.push(`- ${node.name} (${node.id}): ${node.summary}`);
    }
    lines.push("");
  }

  if (ctx.codeEvidenceNodes.length > 0) {
    lines.push("## Code Evidence Nodes");
    for (const node of ctx.codeEvidenceNodes) {
      lines.push(`- ${node.name} (${node.id})${node.filePath ? ` - ${node.filePath}` : ""}: ${node.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function collectNodesById(nodes: GraphNode[], ids: Set<string>): GraphNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return Array.from(ids).map((id) => nodeMap.get(id)).filter((node): node is GraphNode => Boolean(node));
}

function collectEvidenceNodes(nodes: GraphNode[], evidenceRefs: ProductEvidence[]): GraphNode[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const collected = new Map<string, GraphNode>();
  for (const evidence of evidenceRefs) {
    const node = findEvidenceNode(evidence, nodes, nodesById);
    if (node) collected.set(node.id, node);
  }
  return Array.from(collected.values());
}

function findEvidenceNode(
  evidence: ProductEvidence,
  nodes: GraphNode[],
  nodesById: Map<string, GraphNode>,
): GraphNode | undefined {
  if (evidence.nodeId) {
    const node = nodesById.get(evidence.nodeId);
    if (node) return node;
  }
  if (!evidence.filePath) return undefined;
  if (evidence.symbol) {
    const symbolNode = nodes.find((node) =>
      node.filePath === evidence.filePath &&
      (node.name === evidence.symbol || node.id.includes(`:${evidence.symbol}`)),
    );
    if (symbolNode) return symbolNode;
  }
  return nodes.find((node) => node.filePath === evidence.filePath && node.type === "file");
}

function formatEvidenceLocation(evidence: ProductEvidence): string {
  return [
    evidence.filePath,
    evidence.symbol,
    evidence.lineRange ? `lines ${evidence.lineRange[0]}-${evidence.lineRange[1]}` : undefined,
    evidence.nodeId,
  ].filter(Boolean).join(" ");
}
```

- [ ] **Step 4: 修改 `understand-chat.ts`**

Modify `understand-anything-plugin/src/understand-chat.ts`:

```ts
import type { ProductIndex } from "@understand-anything/core/product-index";
import {
  buildProductIndexChatContext,
  formatProductIndexContextForPrompt,
} from "./product-index-context-builder.js";

export interface ProductAwareChatPromptInput {
  graph: KnowledgeGraph;
  query: string;
  productIndex?: ProductIndex;
  domainGraph?: KnowledgeGraph;
}

export function buildProductAwareChatPrompt(input: ProductAwareChatPromptInput): string {
  const productContext = buildProductIndexChatContext(input);
  const formattedProductContext = formatProductIndexContextForPrompt(productContext);

  if (!formattedProductContext) {
    return buildChatPrompt(input.graph, input.query);
  }

  const structuralContext = buildChatContext(input.graph, input.query);
  const formattedStructuralContext = formatContextForPrompt(structuralContext);

  return [
    "You are a product-aware assistant that answers questions about a software codebase.",
    "Use Product Index first for product topics, facts, and evidence.",
    "Then ground the answer in structural graph context and domain graph context when available.",
    "If evidence is weak or only indexed as a candidate, explicitly say that the index only located candidate code.",
    "",
    "---",
    "",
    formattedProductContext,
    "",
    "## Structural Graph Context",
    "",
    formattedStructuralContext,
    "---",
    "",
    `**User question:** ${input.query}`,
  ].join("\n");
}
```

- [ ] **Step 5: 导出 context builder**

Modify `understand-anything-plugin/src/index.ts`:

```ts
export {
  buildProductIndexChatContext,
  formatProductIndexContextForPrompt,
  type ProductIndexChatContext,
  type ProductIndexChatContextInput,
} from "./product-index-context-builder.js";
export { buildProductAwareChatPrompt, type ProductAwareChatPromptInput } from "./understand-chat.js";
```

- [ ] **Step 6: 更新 `/understand-chat` skill 说明**

Modify `understand-anything-plugin/skills/understand-chat/SKILL.md` to add at the start of Instructions:

```markdown
0. 如果 `.understand-anything/product-index.json` 存在，并且用户问题涉及页面、入口、按钮、标签、展示条件、业务规则、后台能力、投屏、同步、下载、Push、埋点、SDK 回调等产品问题，优先检索 product index。命中 product topic/fact 后，用 evidence 的 `nodeId` 或 `filePath` 反查 `knowledge-graph.json`，再回答。
```

- [ ] **Step 7: 运行测试确认通过**

Run:

```bash
pnpm --filter @understand-anything/skill test -- src/__tests__/product-index-context-builder.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add understand-anything-plugin/src/product-index-context-builder.ts understand-anything-plugin/src/understand-chat.ts understand-anything-plugin/src/index.ts understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts understand-anything-plugin/skills/understand-chat/SKILL.md
git commit -m "feat(chat): use product index context"
```

---

## Task 6: Dashboard 轻量 Product Index Panel

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/vite.config.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`
- Create: `understand-anything-plugin/packages/dashboard/src/components/ProductIndexPanel.tsx`

- [ ] **Step 1: 修改 dashboard store 类型**

Modify `understand-anything-plugin/packages/dashboard/src/store.ts` imports:

```ts
import type { ProductIndex } from "@understand-anything/core/product-index";
```

Add to `DashboardStore`:

```ts
productIndex: ProductIndex | null;
setProductIndex: (index: ProductIndex | null) => void;
```

Add to store initial state and actions:

```ts
productIndex: null,
setProductIndex: (index) => set({ productIndex: index }),
```

- [ ] **Step 2: 服务 product index 端点**

Modify `understand-anything-plugin/packages/dashboard/vite.config.ts` protected endpoint list:

```ts
pathname === "/product-index.json" ||
pathname === "/product-signals.jsonl" ||
```

Extend file selection:

```ts
const fileName =
  pathname === "/diff-overlay.json"
    ? "diff-overlay.json"
    : pathname === "/meta.json"
    ? "meta.json"
    : pathname === "/domain-graph.json"
    ? "domain-graph.json"
    : pathname === "/product-index.json"
    ? "product-index.json"
    : pathname === "/product-signals.jsonl"
    ? "product-signals.jsonl"
    : "knowledge-graph.json";
```

For `product-signals.jsonl`, serve text with `Content-Type: application/x-ndjson` and token protection. Do not parse or sanitize JSONL in this task; signals contain relative paths produced by core persistence and are optional for Dashboard first version.

- [ ] **Step 3: 加载 product index**

Modify `understand-anything-plugin/packages/dashboard/src/App.tsx` imports:

```ts
import { validateProductIndex } from "@understand-anything/core/product-index";
import ProductIndexPanel from "./components/ProductIndexPanel";
```

Add env URL mapping:

```ts
"product-index.json": import.meta.env.VITE_PRODUCT_INDEX_URL,
```

In `Dashboard`, add:

```ts
const setProductIndex = useDashboardStore((s) => s.setProductIndex);
```

Add effect:

```ts
useEffect(() => {
  fetch(dataUrl("product-index.json", accessToken))
    .then((res) => {
      if (!res.ok) return null;
      return res.json();
    })
    .then((data: unknown) => {
      if (!data) return;
      const result = validateProductIndex(data);
      if (result.success) {
        setProductIndex(result.data);
      } else {
        console.warn(`[product-index] validation failed: ${result.error}`);
      }
    })
    .catch(() => {});
}, [accessToken, setProductIndex]);
```

Render `<ProductIndexPanel />` inside the sidebar info area near ProjectOverview.

- [ ] **Step 4: 创建 ProductIndexPanel**

Create `understand-anything-plugin/packages/dashboard/src/components/ProductIndexPanel.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { ProductEvidence, ProductTopic } from "@understand-anything/core/product-index";
import { useDashboardStore } from "../store";

const RESULT_LIMIT = 12;

function collectTopicText(topic: ProductTopic): string {
  return [
    topic.name,
    topic.kind,
    topic.status,
    topic.summary,
    ...topic.aliases,
    ...topic.domainRefs,
  ].join(" ").toLowerCase();
}

function findEvidenceTarget(
  evidence: ProductEvidence[],
  graph: ReturnType<typeof useDashboardStore.getState>["graph"],
): string | null {
  if (!graph) return null;
  for (const item of evidence) {
    if (item.nodeId && graph.nodes.some((node) => node.id === item.nodeId)) {
      return item.nodeId;
    }
    if (item.filePath) {
      const node = graph.nodes.find((candidate) => candidate.filePath === item.filePath);
      if (node) return node.id;
    }
  }
  return null;
}

export default function ProductIndexPanel() {
  const productIndex = useDashboardStore((s) => s.productIndex);
  const graph = useDashboardStore((s) => s.graph);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const [query, setQuery] = useState("");

  const evidenceById = useMemo(() => {
    return new Map((productIndex?.evidence ?? []).map((evidence) => [evidence.id, evidence]));
  }, [productIndex]);

  const topics = useMemo(() => {
    if (!productIndex) return [];
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? productIndex.topics.filter((topic) => collectTopicText(topic).includes(normalized))
      : productIndex.topics;
    return matches.slice(0, RESULT_LIMIT);
  }, [productIndex, query]);

  if (!productIndex) return null;

  return (
    <section className="border-t border-border-subtle px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          Product Index
        </h3>
        <span className="font-mono text-[11px] text-text-muted">
          {productIndex.topics.length}
        </span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search product topics"
        className="mb-3 w-full rounded-md border border-border-subtle bg-elevated px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
      />

      {topics.length === 0 ? (
        <p className="text-xs text-text-muted">No product topics found.</p>
      ) : (
        <div className="space-y-3">
          {topics.map((topic) => {
            const topicEvidence = Array.from(new Set([...topic.entryEvidenceIds, ...topic.evidenceIds]))
              .map((id) => evidenceById.get(id))
              .filter((item): item is ProductEvidence => Boolean(item));
            const evidenceTarget = findEvidenceTarget(topicEvidence, graph);
            return (
              <article key={topic.id} className="rounded-lg border border-border-subtle bg-elevated/60 p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h4 className="text-sm font-medium leading-snug text-text-primary">{topic.name}</h4>
                  <span className="shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                    {topic.status}
                  </span>
                </div>
                <p className="mb-2 text-xs leading-relaxed text-text-secondary">{topic.summary}</p>
                {topic.aliases.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {topic.aliases.slice(0, 5).map((alias) => (
                      <span key={`${topic.id}-${alias}`} className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] text-text-secondary">
                        {alias}
                      </span>
                    ))}
                  </div>
                )}
                {evidenceTarget && (
                  <button
                    type="button"
                    onClick={() => openCodeViewer(evidenceTarget)}
                    className="text-[11px] font-medium text-accent transition-colors hover:text-accent-light"
                  >
                    View evidence
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: 构建 Dashboard**

Run:

```bash
pnpm --filter @understand-anything/dashboard build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add understand-anything-plugin/packages/dashboard/vite.config.ts understand-anything-plugin/packages/dashboard/src/App.tsx understand-anything-plugin/packages/dashboard/src/store.ts understand-anything-plugin/packages/dashboard/src/components/ProductIndexPanel.tsx
git commit -m "feat(dashboard): show product index topics"
```

---

## Task 7: 集成验证和文档更新

**Files:**
- Modify: `README.md`
- Modify: `READMEs/README.zh-CN.md`
- Modify: `understand-anything-plugin/package.json` only if a new executable script is added
- Test command only changes where needed

- [ ] **Step 1: 更新 README 命令列表**

Modify `README.md` quick-start command section to include:

```markdown
# Generate a product knowledge index for client product questions
/understand-product --platform android
```

Add concise description:

```markdown
`/understand-product` builds `.understand-anything/product-index.json`, a product knowledge index that maps product topics, candidate facts, and code evidence. It requires `/understand` to run first and does not change the default `/understand` pipeline.
```

- [ ] **Step 2: 更新中文 README**

Modify `READMEs/README.zh-CN.md` command section to include:

```markdown
# 生成客户端产品问题的产品知识索引
/understand-product --platform android
```

Add concise description:

```markdown
`/understand-product` 会生成 `.understand-anything/product-index.json`，用于把产品主题、候选事实和代码证据建立索引。它要求先运行 `/understand`，不会改变 `/understand` 默认流程。
```

- [ ] **Step 3: 运行 core 测试**

Run:

```bash
pnpm --filter @understand-anything/core test
```

Expected: PASS。

- [ ] **Step 4: 运行 skill 测试**

Run:

```bash
pnpm --filter @understand-anything/skill test
```

Expected: PASS。

- [ ] **Step 5: 构建 core、skill、dashboard**

Run:

```bash
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
pnpm --filter @understand-anything/dashboard build
```

Expected: all PASS。

- [ ] **Step 6: 生成一个最小本地 product index 样例验证**

Run from repo root after build:

```bash
node understand-anything-plugin/dist/product-index-cli.js /Users/liubin/work/workspace/ai/Understand-Anything --platform android --fast
```

Expected:

```text
.understand-anything/knowledge-graph.json not found
```

This repo may not have a generated graph. The expected result is a clear error, not an unhandled exception.

- [ ] **Step 7: 提交**

```bash
git add README.md READMEs/README.zh-CN.md understand-anything-plugin/package.json
git commit -m "docs: document understand-product command"
```

---

## 自审清单

- Spec coverage:
  - `product-index.json` schema：Task 1。
  - signals sidecar：Task 4。
  - entry-driven Android profile：Task 3。
  - weighted graph expansion：Task 3。
  - LLM 边界：Task 4 agent prompt。
  - chat 回答流程：Task 5。
  - dashboard 最小集成：Task 6。
  - validation and persistence：Task 2。
- Placeholder scan:
  - 本计划没有留下未定义实现空白。
  - 每个代码任务包含测试、实现路径、运行命令和预期结果。
- Type consistency:
  - `ProductIndex`、`ProductTopic`、`ProductFact`、`ProductEvidence`、`ProductSignal` 在 Task 1 定义，后续任务复用同名类型。
  - `buildDeterministicProductIndex()`、`buildProductSignals()`、`enumerateProductEntrySeeds()` 在 Task 3 定义，Task 4 CLI 复用。
  - `buildProductAwareChatPrompt()` 在 Task 5 定义并导出。
