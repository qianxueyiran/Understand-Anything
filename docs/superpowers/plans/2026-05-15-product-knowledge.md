# Product Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional product knowledge layer that generates `.understand-anything/product-knowledge.json` and lets `/understand-chat` and the dashboard explain product-facing concepts such as page labels, display rules, business meaning, data fields, and code evidence.

**Architecture:** Keep `/understand` and `/understand-domain` unchanged by default. Add a browser-safe core product knowledge model/search module, Node persistence helpers, a new `/understand-product` skill with a product analyzer agent, and optional consumers in chat/dashboard that gracefully no-op when `product-knowledge.json` is absent.

**Tech Stack:** TypeScript, Zod, Fuse.js, Vitest, Python 3 standard library, React, Zustand, Vite.

---

## File Structure

Create and modify files with these responsibilities:

- Create `understand-anything-plugin/packages/core/src/product-knowledge.ts`: browser-safe ProductKnowledge types, Zod validation, normalization, and keyword search.
- Modify `understand-anything-plugin/packages/core/src/index.ts`: export product knowledge APIs from the main package.
- Modify `understand-anything-plugin/packages/core/package.json`: add a browser-safe `./product-knowledge` subpath export.
- Modify `understand-anything-plugin/packages/core/src/persistence/index.ts`: add `saveProductKnowledge()` and `loadProductKnowledge()` for `.understand-anything/product-knowledge.json`.
- Create `understand-anything-plugin/packages/core/src/__tests__/product-knowledge.test.ts`: schema/search tests.
- Create `understand-anything-plugin/packages/core/src/__tests__/product-persistence.test.ts`: persistence tests.
- Create `understand-anything-plugin/src/product-context-builder.ts`: merge product search results with domain graph and code graph evidence for chat prompts.
- Modify `understand-anything-plugin/src/understand-chat.ts`: add a new product-aware prompt builder while preserving the existing `buildChatPrompt(graph, query)` API.
- Modify `understand-anything-plugin/src/index.ts`: export product chat helpers.
- Create `understand-anything-plugin/src/__tests__/product-context-builder.test.ts`: product chat context tests.
- Create `understand-anything-plugin/skills/understand-product/SKILL.md`: optional skill that generates product knowledge.
- Create `understand-anything-plugin/skills/understand-product/extract-product-context.py`: lightweight product context extractor.
- Create `understand-anything-plugin/agents/product-analyzer.md`: product analyzer agent prompt.
- Modify `understand-anything-plugin/skills/understand-chat/SKILL.md`: document product-first retrieval when product knowledge exists.
- Modify `understand-anything-plugin/packages/dashboard/src/store.ts`: store optional ProductKnowledge.
- Modify `understand-anything-plugin/packages/dashboard/src/App.tsx`: fetch `product-knowledge.json` if present.
- Create `understand-anything-plugin/packages/dashboard/src/components/ProductKnowledgePanel.tsx`: sidebar panel for product concepts and evidence.
- Modify `understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx`: surface product knowledge availability and concept count.
- Add or update locale strings in `understand-anything-plugin/packages/dashboard/src/locales/zh.ts` and `understand-anything-plugin/packages/dashboard/src/locales/en.ts` for the new panel labels.

Do not modify `/understand` phase ordering in `understand-anything-plugin/skills/understand/SKILL.md` for this first version.

---

### Task 1: Core Product Knowledge Model and Search

**Files:**
- Create: `understand-anything-plugin/packages/core/src/product-knowledge.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Modify: `understand-anything-plugin/packages/core/package.json`
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-knowledge.test.ts`

- [ ] **Step 1: Write failing schema and search tests**

Create `understand-anything-plugin/packages/core/src/__tests__/product-knowledge.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @understand-anything/core test -- --run src/__tests__/product-knowledge.test.ts
```

Expected: FAIL because `../product-knowledge.js` does not exist.

- [ ] **Step 3: Implement browser-safe product knowledge model and search**

Create `understand-anything-plugin/packages/core/src/product-knowledge.ts`:

```typescript
import Fuse, { type IFuseOptions } from "fuse.js";
import { z } from "zod";

export const EvidenceRefSchema = z.object({
  filePath: z.string().optional(),
  nodeId: z.string().optional(),
  symbol: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  reason: z.string().min(1),
});

export const DisplayRuleSchema = z.object({
  condition: z.string().min(1),
  result: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).optional(),
});

export const DataFieldRefSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["api", "model", "enum", "resource", "local-state", "unknown"]),
  meaning: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).optional(),
});

export const ProductAreaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  domainRefs: z.array(z.string()).optional(),
  codeRefs: z.array(EvidenceRefSchema).optional(),
});

export const ProductConceptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  areaId: z.string().optional(),
  meaning: z.string().min(1),
  userFacingTerms: z.array(z.string()),
  businessRules: z.array(z.string()),
  displayRules: z.array(DisplayRuleSchema),
  dataFields: z.array(DataFieldRefSchema),
  relatedConceptIds: z.array(z.string()),
  evidence: z.array(EvidenceRefSchema),
  confidence: z.enum(["confirmed", "inferred", "uncertain"]),
});

export const ProductKnowledgeSchema = z.object({
  version: z.string().min(1),
  project: z.object({
    name: z.string().min(1),
    analyzedAt: z.string().min(1),
    gitCommitHash: z.string(),
  }),
  productAreas: z.array(ProductAreaSchema),
  concepts: z.array(ProductConceptSchema),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type DisplayRule = z.infer<typeof DisplayRuleSchema>;
export type DataFieldRef = z.infer<typeof DataFieldRefSchema>;
export type ProductArea = z.infer<typeof ProductAreaSchema>;
export type ProductConcept = z.infer<typeof ProductConceptSchema>;
export type ProductKnowledge = z.infer<typeof ProductKnowledgeSchema>;

export interface ProductKnowledgeValidationResult {
  success: boolean;
  data?: ProductKnowledge;
  error?: string;
}

export interface ProductKnowledgeSearchResult {
  concept: ProductConcept;
  area?: ProductArea;
  score: number;
  matchedText: string[];
}

interface SearchableConcept {
  concept: ProductConcept;
  area?: ProductArea;
  searchable: string;
  matchedText: string[];
}

export function validateProductKnowledge(data: unknown): ProductKnowledgeValidationResult {
  const parsed = ProductKnowledgeSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const badConfirmed = parsed.data.concepts.find(
    (concept) => concept.confidence === "confirmed" && concept.evidence.length === 0,
  );
  if (badConfirmed) {
    return {
      success: false,
      error: `confirmed product concept "${badConfirmed.id}" must include at least one evidence item`,
    };
  }

  return { success: true, data: parsed.data };
}

function conceptText(concept: ProductConcept, area?: ProductArea): string[] {
  return [
    concept.name,
    concept.meaning,
    area?.name ?? "",
    area?.summary ?? "",
    ...concept.userFacingTerms,
    ...concept.businessRules,
    ...concept.displayRules.flatMap((rule) => [rule.condition, rule.result]),
    ...concept.dataFields.flatMap((field) => [field.name, field.meaning, field.source]),
  ].filter(Boolean);
}

const FUSE_OPTIONS: IFuseOptions<SearchableConcept> = {
  keys: [{ name: "searchable", weight: 1 }],
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
};

export function searchProductKnowledge(
  knowledge: ProductKnowledge,
  query: string,
  limit = 8,
): ProductKnowledgeSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const areasById = new Map(knowledge.productAreas.map((area) => [area.id, area]));
  const rows: SearchableConcept[] = knowledge.concepts.map((concept) => {
    const area = concept.areaId ? areasById.get(concept.areaId) : undefined;
    const matchedText = conceptText(concept, area);
    return { concept, area, searchable: matchedText.join("\n"), matchedText };
  });

  const fuse = new Fuse(rows, FUSE_OPTIONS);
  return fuse.search(trimmed).slice(0, limit).map((result) => ({
    concept: result.item.concept,
    area: result.item.area,
    score: result.score ?? 0,
    matchedText: result.item.matchedText,
  }));
}
```

- [ ] **Step 4: Export the product knowledge module**

Modify `understand-anything-plugin/packages/core/src/index.ts` and add:

```typescript
export {
  ProductKnowledgeSchema,
  ProductAreaSchema,
  ProductConceptSchema,
  DisplayRuleSchema,
  DataFieldRefSchema,
  EvidenceRefSchema,
  validateProductKnowledge,
  searchProductKnowledge,
  type ProductKnowledge,
  type ProductArea,
  type ProductConcept,
  type DisplayRule,
  type DataFieldRef,
  type EvidenceRef,
  type ProductKnowledgeSearchResult,
  type ProductKnowledgeValidationResult,
} from "./product-knowledge.js";
```

Modify `understand-anything-plugin/packages/core/package.json` exports:

```json
"./product-knowledge": {
  "types": "./dist/product-knowledge.d.ts",
  "default": "./dist/product-knowledge.js"
}
```

Place it alongside the existing `./search`, `./types`, and `./schema` subpath exports.

- [ ] **Step 5: Run core product knowledge tests**

Run:

```bash
pnpm --filter @understand-anything/core test -- --run src/__tests__/product-knowledge.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add understand-anything-plugin/packages/core/src/product-knowledge.ts \
  understand-anything-plugin/packages/core/src/index.ts \
  understand-anything-plugin/packages/core/package.json \
  understand-anything-plugin/packages/core/src/__tests__/product-knowledge.test.ts
git commit -m "feat(core): add product knowledge model"
```

---

### Task 2: Product Knowledge Persistence

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/persistence/index.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/product-persistence.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Create `understand-anything-plugin/packages/core/src/__tests__/product-persistence.test.ts`:

```typescript
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
      displayRules: [{ condition: "stream.label 存在", result: "展示标签" }],
      dataFields: [{ name: "stream.label", source: "api", meaning: "服务端下发标签" }],
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @understand-anything/core test -- --run src/__tests__/product-persistence.test.ts
```

Expected: FAIL because `saveProductKnowledge` and `loadProductKnowledge` are not exported.

- [ ] **Step 3: Implement product persistence**

Modify `understand-anything-plugin/packages/core/src/persistence/index.ts`:

```typescript
import type { ProductKnowledge } from "../product-knowledge.js";
import { validateProductKnowledge } from "../product-knowledge.js";
```

Add near the existing graph file constants:

```typescript
const PRODUCT_KNOWLEDGE_FILE = "product-knowledge.json";
```

Add after `loadDomainGraph()`:

```typescript
export function saveProductKnowledge(
  projectRoot: string,
  knowledge: ProductKnowledge,
  options?: { validate?: boolean },
): void {
  if (options?.validate !== false) {
    const result = validateProductKnowledge(knowledge);
    if (!result.success) {
      throw new Error(`Invalid product knowledge: ${result.error ?? "unknown error"}`);
    }
  }

  const dir = ensureDir(projectRoot);
  writeFileSync(
    join(dir, PRODUCT_KNOWLEDGE_FILE),
    JSON.stringify(knowledge, null, 2),
    "utf-8",
  );
}

export function loadProductKnowledge(
  projectRoot: string,
  options?: { validate?: boolean },
): ProductKnowledge | null {
  const filePath = join(projectRoot, UA_DIR, PRODUCT_KNOWLEDGE_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  if (options?.validate === false) return data as ProductKnowledge;

  const result = validateProductKnowledge(data);
  if (!result.success || !result.data) {
    throw new Error(`Invalid product knowledge: ${result.error ?? "unknown error"}`);
  }

  return result.data;
}
```

- [ ] **Step 4: Run persistence tests**

Run:

```bash
pnpm --filter @understand-anything/core test -- --run src/__tests__/product-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add understand-anything-plugin/packages/core/src/persistence/index.ts \
  understand-anything-plugin/packages/core/src/__tests__/product-persistence.test.ts
git commit -m "feat(core): persist product knowledge"
```

---

### Task 3: Product-Aware Chat Context

**Files:**
- Create: `understand-anything-plugin/src/product-context-builder.ts`
- Modify: `understand-anything-plugin/src/understand-chat.ts`
- Modify: `understand-anything-plugin/src/index.ts`
- Test: `understand-anything-plugin/src/__tests__/product-context-builder.test.ts`

- [ ] **Step 1: Write failing product chat context tests**

Create `understand-anything-plugin/src/__tests__/product-context-builder.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core";
import type { ProductKnowledge } from "@understand-anything/core/product-knowledge";
import { buildProductChatContext, formatProductContextForPrompt } from "../product-context-builder.js";
import { buildProductAwareChatPrompt } from "../understand-chat.js";

const graph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "video-app",
    languages: ["kotlin"],
    frameworks: ["Android"],
    description: "Video playback app",
    analyzedAt: "2026-05-15T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "file:player/PlayerViewModel.kt",
      type: "file",
      name: "PlayerViewModel.kt",
      filePath: "player/PlayerViewModel.kt",
      summary: "构建播放页状态和码流标签。",
      tags: ["android", "viewmodel", "playback"],
      complexity: "moderate",
    },
  ],
  edges: [],
  layers: [
    {
      id: "layer:presentation",
      name: "Presentation",
      description: "播放页 UI 状态与展示逻辑。",
      nodeIds: ["file:player/PlayerViewModel.kt"],
    },
  ],
  tour: [],
};

const domainGraph: KnowledgeGraph = {
  ...graph,
  nodes: [
    {
      id: "domain:playback",
      type: "domain",
      name: "播放业务",
      summary: "处理播放页展示、播放控制和清晰度选择。",
      tags: ["播放"],
      complexity: "moderate",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
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
      summary: "展示视频、清晰度和码流标签。",
      domainRefs: ["domain:playback"],
    },
  ],
  concepts: [
    {
      id: "concept:stream-quality-label",
      name: "码流标签",
      areaId: "area:playback-page",
      meaning: "表达当前内容可用清晰度、画质能力或权益限制。",
      userFacingTerms: ["高清", "蓝光"],
      businessRules: ["只有可展示码流才展示对应标签。"],
      displayRules: [{ condition: "stream.label 存在", result: "展示在清晰度入口" }],
      dataFields: [{ name: "stream.label", source: "api", meaning: "服务端下发标签" }],
      relatedConceptIds: [],
      evidence: [
        {
          filePath: "player/PlayerViewModel.kt",
          nodeId: "file:player/PlayerViewModel.kt",
          symbol: "buildStreamLabels",
          reason: "构建码流标签",
        },
      ],
      confidence: "confirmed",
    },
  ],
};

describe("product chat context", () => {
  it("retrieves product concepts before code evidence", () => {
    const ctx = buildProductChatContext({
      graph,
      domainGraph,
      productKnowledge,
      query: "播放页码流标签是什么意思",
    });
    expect(ctx.productResults[0].concept.id).toBe("concept:stream-quality-label");
    expect(ctx.codeEvidenceNodes.map((n) => n.id)).toContain("file:player/PlayerViewModel.kt");
    expect(ctx.domainNodes.map((n) => n.id)).toContain("domain:playback");
  });

  it("formats product meaning, display rules, data fields, and evidence", () => {
    const ctx = buildProductChatContext({ graph, domainGraph, productKnowledge, query: "码流标签" });
    const formatted = formatProductContextForPrompt(ctx);
    expect(formatted).toContain("## Product Knowledge");
    expect(formatted).toContain("码流标签");
    expect(formatted).toContain("stream.label");
    expect(formatted).toContain("PlayerViewModel.kt");
  });

  it("falls back to structural context when product knowledge is absent", () => {
    const prompt = buildProductAwareChatPrompt({ graph, query: "播放页 ViewModel" });
    expect(prompt).toContain("Code Components");
    expect(prompt).not.toContain("Product Knowledge");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @understand-anything/skill test -- --run src/__tests__/product-context-builder.test.ts
```

Expected: FAIL because `product-context-builder.js` and `buildProductAwareChatPrompt` do not exist.

- [ ] **Step 3: Implement product context builder**

Create `understand-anything-plugin/src/product-context-builder.ts`:

```typescript
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core";
import {
  searchProductKnowledge,
  type ProductKnowledge,
  type ProductKnowledgeSearchResult,
} from "@understand-anything/core/product-knowledge";

export interface ProductChatContextInput {
  graph: KnowledgeGraph;
  query: string;
  productKnowledge?: ProductKnowledge | null;
  domainGraph?: KnowledgeGraph | null;
}

export interface ProductChatContext {
  query: string;
  projectName: string;
  productResults: ProductKnowledgeSearchResult[];
  domainNodes: GraphNode[];
  codeEvidenceNodes: GraphNode[];
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

export function buildProductChatContext(input: ProductChatContextInput): ProductChatContext {
  const productResults = input.productKnowledge
    ? searchProductKnowledge(input.productKnowledge, input.query, 6)
    : [];

  const domainRefs = new Set<string>();
  const evidenceNodeIds = new Set<string>();
  const evidencePaths = new Set<string>();

  for (const result of productResults) {
    for (const ref of result.area?.domainRefs ?? []) domainRefs.add(ref);
    for (const ref of result.area?.codeRefs ?? []) {
      if (ref.nodeId) evidenceNodeIds.add(ref.nodeId);
      if (ref.filePath) evidencePaths.add(ref.filePath);
    }
    for (const ref of result.concept.evidence) {
      if (ref.nodeId) evidenceNodeIds.add(ref.nodeId);
      if (ref.filePath) evidencePaths.add(ref.filePath);
    }
    for (const rule of result.concept.displayRules) {
      for (const ref of rule.evidence ?? []) {
        if (ref.nodeId) evidenceNodeIds.add(ref.nodeId);
        if (ref.filePath) evidencePaths.add(ref.filePath);
      }
    }
    for (const field of result.concept.dataFields) {
      for (const ref of field.evidence ?? []) {
        if (ref.nodeId) evidenceNodeIds.add(ref.nodeId);
        if (ref.filePath) evidencePaths.add(ref.filePath);
      }
    }
  }

  const domainNodes = uniqueNodes(
    (input.domainGraph?.nodes ?? []).filter((node) => domainRefs.has(node.id)),
  );

  const codeEvidenceNodes = uniqueNodes(
    input.graph.nodes.filter(
      (node) =>
        evidenceNodeIds.has(node.id) ||
        (typeof node.filePath === "string" && evidencePaths.has(node.filePath)),
    ),
  );

  return {
    query: input.query,
    projectName: input.graph.project.name,
    productResults,
    domainNodes,
    codeEvidenceNodes,
  };
}

export function formatProductContextForPrompt(ctx: ProductChatContext): string {
  if (ctx.productResults.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Product Knowledge");
  lines.push("");

  for (const result of ctx.productResults) {
    const concept = result.concept;
    lines.push(`### ${concept.name}`);
    if (result.area) lines.push(`- **Area:** ${result.area.name}`);
    lines.push(`- **Meaning:** ${concept.meaning}`);
    lines.push(`- **Confidence:** ${concept.confidence}`);
    if (concept.userFacingTerms.length > 0) {
      lines.push(`- **User-facing terms:** ${concept.userFacingTerms.join(", ")}`);
    }
    if (concept.businessRules.length > 0) {
      lines.push("- **Business rules:**");
      for (const rule of concept.businessRules) lines.push(`  - ${rule}`);
    }
    if (concept.displayRules.length > 0) {
      lines.push("- **Display rules:**");
      for (const rule of concept.displayRules) {
        lines.push(`  - If ${rule.condition}, then ${rule.result}`);
      }
    }
    if (concept.dataFields.length > 0) {
      lines.push("- **Data fields:**");
      for (const field of concept.dataFields) {
        lines.push(`  - ${field.name} (${field.source}): ${field.meaning}`);
      }
    }
    if (concept.evidence.length > 0) {
      lines.push("- **Evidence:**");
      for (const evidence of concept.evidence) {
        const where = [evidence.filePath, evidence.symbol].filter(Boolean).join(" ");
        lines.push(`  - ${where || evidence.nodeId || "unknown"}: ${evidence.reason}`);
      }
    }
    lines.push("");
  }

  if (ctx.domainNodes.length > 0) {
    lines.push("## Domain Context");
    for (const node of ctx.domainNodes) lines.push(`- ${node.name}: ${node.summary}`);
    lines.push("");
  }

  if (ctx.codeEvidenceNodes.length > 0) {
    lines.push("## Code Evidence");
    for (const node of ctx.codeEvidenceNodes) {
      lines.push(`- ${node.name}${node.filePath ? ` (${node.filePath})` : ""}: ${node.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Add product-aware prompt builder without breaking existing API**

Modify `understand-anything-plugin/src/understand-chat.ts`:

```typescript
import type { KnowledgeGraph } from "@understand-anything/core";
import type { ProductKnowledge } from "@understand-anything/core/product-knowledge";
import { buildChatContext, formatContextForPrompt } from "./context-builder.js";
import { buildProductChatContext, formatProductContextForPrompt } from "./product-context-builder.js";
```

Keep existing `buildChatPrompt(graph, query)` unchanged. Add:

```typescript
export interface ProductAwareChatPromptInput {
  graph: KnowledgeGraph;
  query: string;
  productKnowledge?: ProductKnowledge | null;
  domainGraph?: KnowledgeGraph | null;
}

export function buildProductAwareChatPrompt(input: ProductAwareChatPromptInput): string {
  const productContext = buildProductChatContext(input);
  const productPrompt = formatProductContextForPrompt(productContext);

  if (!productPrompt) {
    return buildChatPrompt(input.graph, input.query);
  }

  const structuralContext = buildChatContext(input.graph, input.query);
  const formattedStructural = formatContextForPrompt(structuralContext);

  return [
    "You are a product-oriented assistant that answers questions about a software codebase.",
    "Prioritize product meaning, display rules, user-facing terms, data fields, and evidence.",
    "Use code evidence to ground the answer. If evidence is weak, say so explicitly.",
    "",
    "---",
    "",
    productPrompt,
    "---",
    "",
    formattedStructural,
    "---",
    "",
    `**User question:** ${input.query}`,
  ].join("\n");
}
```

Modify `understand-anything-plugin/src/index.ts`:

```typescript
export {
  buildProductChatContext,
  formatProductContextForPrompt,
  type ProductChatContext,
  type ProductChatContextInput,
} from "./product-context-builder.js";
export {
  buildProductAwareChatPrompt,
  type ProductAwareChatPromptInput,
} from "./understand-chat.js";
```

If duplicate export conflicts with the existing `export { buildChatPrompt }`, combine the `understand-chat.js` exports into one export block.

- [ ] **Step 5: Run product chat tests**

Run:

```bash
pnpm --filter @understand-anything/skill test -- --run src/__tests__/product-context-builder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add understand-anything-plugin/src/product-context-builder.ts \
  understand-anything-plugin/src/understand-chat.ts \
  understand-anything-plugin/src/index.ts \
  understand-anything-plugin/src/__tests__/product-context-builder.test.ts
git commit -m "feat(skill): add product-aware chat context"
```

---

### Task 4: Product Knowledge Skill and Agent

**Files:**
- Create: `understand-anything-plugin/skills/understand-product/SKILL.md`
- Create: `understand-anything-plugin/skills/understand-product/extract-product-context.py`
- Create: `understand-anything-plugin/agents/product-analyzer.md`
- Modify: plugin manifest files if this repository requires explicit skill registration after adding a skill directory.

- [ ] **Step 1: Create the `/understand-product` skill**

Create `understand-anything-plugin/skills/understand-product/SKILL.md`:

```markdown
---
name: understand-product
description: Extract product-facing knowledge from a codebase using an existing /understand knowledge graph, including product areas, concepts, display rules, data fields, and code evidence.
argument-hint: [--full]
---

# /understand-product

Generate `.understand-anything/product-knowledge.json` for product managers and product-facing codebase questions.

## Preconditions

1. Resolve `PROJECT_ROOT` to the current working directory.
2. Require `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.
3. If the knowledge graph is missing, stop and tell the user to run `/understand` first.
4. If `$PROJECT_ROOT/.understand-anything/domain-graph.json` exists, use it as optional business-flow context.

## Plugin Root

Resolve `PLUGIN_ROOT` using the same strategy as `/understand-domain`: runtime plugin root first, then skill symlink resolution, then common install paths.

## Phase 1: Extract Product Context

Run:

```bash
python "$PLUGIN_ROOT/skills/understand-product/extract-product-context.py" "$PROJECT_ROOT"
```

The script writes:

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-context.json
```

## Phase 2: Product Analysis

Read:

1. `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`
2. `$PROJECT_ROOT/.understand-anything/domain-graph.json` if present
3. `$PROJECT_ROOT/.understand-anything/intermediate/product-context.json`
4. `$PLUGIN_ROOT/agents/product-analyzer.md`

Dispatch a subagent with the product analyzer prompt and the three context sources. The subagent must write:

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-knowledge.json
```

## Phase 3: Validate and Save

1. Validate that the output has `version`, `project`, `productAreas`, and `concepts`.
2. Confirm every `confirmed` concept has at least one evidence item.
3. If validation fails, do not overwrite the existing product knowledge file.
4. Save valid output to:

```text
$PROJECT_ROOT/.understand-anything/product-knowledge.json
```

## Phase 4: Cleanup

Remove only:

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-context.json
$PROJECT_ROOT/.understand-anything/intermediate/product-knowledge.json
```

Do not remove other intermediate files.

## Output

Report the number of product areas, concepts, display rules, and confirmed concepts. Tell the user they can now ask `/understand-chat` product questions.
```

- [ ] **Step 2: Create the product analyzer prompt**

Create `understand-anything-plugin/agents/product-analyzer.md`:

```markdown
---
name: product-analyzer
description: Extracts product-facing knowledge from codebase context, including product areas, user-facing concepts, display rules, data fields, business rules, and code evidence.
model: inherit
---

# Product Analyzer Agent

You identify product knowledge that a product manager can use without reading code.

## Input

You receive:

1. A structural `knowledge-graph.json`.
2. An optional `domain-graph.json`.
3. A `product-context.json` file containing high-signal page, resource, field, enum, and rule clues.

## Output

Write a JSON object to `<project-root>/.understand-anything/intermediate/product-knowledge.json`:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<project name>",
    "analyzedAt": "<ISO timestamp>",
    "gitCommitHash": "<git commit hash>"
  },
  "productAreas": [
    {
      "id": "area:<kebab-case-name>",
      "name": "<Chinese product area name>",
      "summary": "<what the area does for users>",
      "domainRefs": ["domain:<id>"],
      "codeRefs": [
        {
          "filePath": "<relative path>",
          "nodeId": "file:<relative path>",
          "symbol": "<optional symbol>",
          "lineRange": [1, 10],
          "reason": "<why this file is evidence>"
        }
      ]
    }
  ],
  "concepts": [
    {
      "id": "concept:<kebab-case-name>",
      "name": "<Chinese user-facing concept>",
      "areaId": "area:<kebab-case-name>",
      "meaning": "<business meaning for product managers>",
      "userFacingTerms": ["<visible label or wording>"],
      "businessRules": ["<business rule>"],
      "displayRules": [
        {
          "condition": "<condition found or inferred from code>",
          "result": "<user-visible display result>",
          "evidence": [
            {
              "filePath": "<relative path>",
              "symbol": "<optional symbol>",
              "lineRange": [1, 10],
              "reason": "<why this proves the rule>"
            }
          ]
        }
      ],
      "dataFields": [
        {
          "name": "<field or enum name>",
          "source": "api",
          "meaning": "<business meaning>",
          "evidence": [
            {
              "filePath": "<relative path>",
              "symbol": "<optional symbol>",
              "lineRange": [1, 10],
              "reason": "<why this proves the field meaning>"
            }
          ]
        }
      ],
      "relatedConceptIds": [],
      "evidence": [
        {
          "filePath": "<relative path>",
          "symbol": "<optional symbol>",
          "lineRange": [1, 10],
          "reason": "<why this proves the concept>"
        }
      ],
      "confidence": "confirmed"
    }
  ]
}
```

## Rules

1. Write natural Chinese for all summaries, meanings, rules, and evidence reasons.
2. Keep code identifiers, file paths, fields, enum values, and API names unchanged.
3. Do not turn `Presenter`, `Repository`, `Adapter`, `Manager`, `ViewModel`, or `Activity` into product concepts by themselves. They are implementation evidence.
4. A `confirmed` concept must have at least one evidence item.
5. Use `inferred` when the meaning is likely but evidence is indirect.
6. Use `uncertain` when the code clue is weak or ambiguous.
7. Prefer user-facing terms from resources, labels, API fields, enum names, analytics names, and page names.
8. Do not invent concepts that are not supported by the provided context.
9. Keep the first version focused: product areas, concepts, display rules, data fields, and evidence.

Respond with only a short summary after writing the JSON.
```

- [ ] **Step 3: Create the lightweight product context extractor**

Create `understand-anything-plugin/skills/understand-product/extract-product-context.py`:

```python
#!/usr/bin/env python3
"""Extract high-signal product context for /understand-product."""

import json
import re
import sys
from pathlib import Path
from typing import Any

MAX_FILES = 160
MAX_PREVIEW_CHARS = 1200

PRODUCT_FILE_RE = re.compile(
    r"(activity|fragment|viewmodel|presenter|contract|adapter|screen|page|player|playback|quality|stream|label|vip|rights|benefit|membership)",
    re.IGNORECASE,
)

FIELD_RE = re.compile(r"\b(?:val|var|String|Int|Boolean|Long|Double)\s+([A-Za-z_][A-Za-z0-9_]*)")
RESOURCE_RE = re.compile(r'<string\s+name="([^"]+)">([^<]+)</string>')
DISPLAY_RULE_RE = re.compile(r"\b(if|when|switch)\b")

SKIP_PARTS = {
    ".git",
    ".understand-anything",
    "node_modules",
    "dist",
    "build",
    ".gradle",
    "Pods",
}


def should_skip(path: Path) -> bool:
    return any(part in SKIP_PARTS for part in path.parts)


def read_text(path: Path) -> str:
    try:
      return path.read_text(errors="replace")
    except OSError:
      return ""


def collect_candidates(root: Path) -> list[dict[str, Any]]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or should_skip(path):
            continue
        rel = path.relative_to(root)
        suffix = path.suffix.lower()
        rel_text = str(rel)
        if suffix in {".kt", ".java", ".xml", ".json", ".graphql", ".proto"} and PRODUCT_FILE_RE.search(rel_text):
            files.append(path)
        elif rel.name == "strings.xml":
            files.append(path)

    result: list[dict[str, Any]] = []
    for path in files[:MAX_FILES]:
        rel = str(path.relative_to(root))
        text = read_text(path)
        if not text:
            continue

        strings = []
        if path.name == "strings.xml":
            strings = [{"name": m.group(1), "value": m.group(2)} for m in RESOURCE_RE.finditer(text)]

        fields = [{"name": m.group(1)} for m in FIELD_RE.finditer(text[:MAX_PREVIEW_CHARS])]
        has_display_logic = bool(DISPLAY_RULE_RE.search(text[:MAX_PREVIEW_CHARS]))

        result.append({
            "path": rel,
            "kind": path.suffix.lower().lstrip(".") or path.name,
            "strings": strings[:30],
            "fields": fields[:30],
            "hasDisplayLogic": has_display_logic,
            "preview": text[:MAX_PREVIEW_CHARS],
        })

    return result


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: extract-product-context.py <project-root>", file=sys.stderr)
        sys.exit(1)

    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    out_dir = root / ".understand-anything" / "intermediate"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "product-context.json"

    context = {
        "projectRoot": str(root),
        "candidateFiles": collect_candidates(root),
    }
    out_path.write_text(json.dumps(context, ensure_ascii=False, indent=2))
    print(f"Wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

Fix the indentation in `read_text()` to use four spaces before committing:

```python
def read_text(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""
```

- [ ] **Step 4: Validate the extractor syntax**

Run:

```bash
python3 -m py_compile understand-anything-plugin/skills/understand-product/extract-product-context.py
```

Expected: command exits 0.

- [ ] **Step 5: Commit Task 4**

```bash
git add understand-anything-plugin/skills/understand-product/SKILL.md \
  understand-anything-plugin/skills/understand-product/extract-product-context.py \
  understand-anything-plugin/agents/product-analyzer.md
git commit -m "feat(skill): add understand-product"
```

---

### Task 5: Product-First Chat Skill Instructions

**Files:**
- Modify: `understand-anything-plugin/skills/understand-chat/SKILL.md`

- [ ] **Step 1: Update `/understand-chat` instructions**

Modify `understand-anything-plugin/skills/understand-chat/SKILL.md` so the `## Instructions` section starts with:

```markdown
0. Check whether `.understand-anything/product-knowledge.json` exists.
   - If it exists and the query asks about product meaning, page elements, labels, display rules, status meaning, business meaning, data fields, or "why/how something is shown", search product knowledge first.
   - Search `productAreas[].name`, `productAreas[].summary`, `concepts[].name`, `concepts[].meaning`, `concepts[].userFacingTerms`, `concepts[].businessRules`, `concepts[].displayRules`, and `concepts[].dataFields`.
   - Use product evidence (`filePath`, `nodeId`, `symbol`, `lineRange`) to pull matching code context from `knowledge-graph.json`.
   - If `domain-graph.json` exists, use matching `domainRefs` or product area/concept names to add business-flow background.
   - If product knowledge does not match, continue with the existing knowledge graph retrieval path.
```

Also update the answer guidance to prefer this order for product questions:

```markdown
For product-facing questions, answer in this order:
1. Product meaning
2. User-facing labels or terms
3. Display rules and conditions
4. Data fields or enum/source mapping
5. Code evidence
6. Uncertainty, if evidence is weak
```

- [ ] **Step 2: Run the skill language/prompt tests**

Run:

```bash
pnpm --filter @understand-anything/skill test -- --run src/__tests__/understand-skill-language.test.ts
```

Expected: PASS. If this test is not available on the current branch, run:

```bash
pnpm --filter @understand-anything/skill test -- --run src/__tests__/context-builder.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit Task 5**

```bash
git add understand-anything-plugin/skills/understand-chat/SKILL.md
git commit -m "docs(skill): document product-first chat retrieval"
```

---

### Task 6: Dashboard Product Knowledge Loading and Panel

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/components/ProductKnowledgePanel.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/locales/zh.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/locales/en.ts`

- [ ] **Step 1: Add product knowledge to dashboard store**

In `understand-anything-plugin/packages/dashboard/src/store.ts`, import:

```typescript
import type { ProductKnowledge } from "@understand-anything/core/product-knowledge";
```

Add to `DashboardStore`:

```typescript
productKnowledge: ProductKnowledge | null;
setProductKnowledge: (knowledge: ProductKnowledge) => void;
```

Add to the store initial state and actions:

```typescript
productKnowledge: null,
setProductKnowledge: (knowledge) => {
  set({ productKnowledge: knowledge });
},
```

- [ ] **Step 2: Fetch product knowledge in App**

In `understand-anything-plugin/packages/dashboard/src/App.tsx`, import:

```typescript
import { validateProductKnowledge } from "@understand-anything/core/product-knowledge";
```

Update `dataUrl()` demo env map:

```typescript
"product-knowledge.json": import.meta.env.VITE_PRODUCT_KNOWLEDGE_URL,
```

In `Dashboard`, add:

```typescript
const setProductKnowledge = useDashboardStore((s) => s.setProductKnowledge);
```

Add an effect after the domain graph loading effect:

```typescript
useEffect(() => {
  fetch(dataUrl("product-knowledge.json", accessToken))
    .then((res) => {
      if (!res.ok) return null;
      return res.json();
    })
    .then((data: unknown) => {
      if (!data) return;
      const result = validateProductKnowledge(data);
      if (result.success && result.data) {
        setProductKnowledge(result.data);
      } else {
        console.warn(`[product-knowledge] validation failed: ${result.error ?? "unknown error"}`);
      }
    })
    .catch(() => {});
}, [accessToken, setProductKnowledge]);
```

- [ ] **Step 3: Create product knowledge panel**

Create `understand-anything-plugin/packages/dashboard/src/components/ProductKnowledgePanel.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";

export default function ProductKnowledgePanel() {
  const productKnowledge = useDashboardStore((s) => s.productKnowledge);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const graph = useDashboardStore((s) => s.graph);
  const [query, setQuery] = useState("");

  const concepts = useMemo(() => {
    const all = productKnowledge?.concepts ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 12);
    return all.filter((concept) => {
      const text = [
        concept.name,
        concept.meaning,
        ...concept.userFacingTerms,
        ...concept.businessRules,
        ...concept.displayRules.flatMap((rule) => [rule.condition, rule.result]),
        ...concept.dataFields.flatMap((field) => [field.name, field.meaning]),
      ].join(" ").toLowerCase();
      return text.includes(q);
    }).slice(0, 12);
  }, [productKnowledge, query]);

  if (!productKnowledge) return null;

  function openEvidence(nodeId: string | undefined, filePath: string | undefined) {
    if (nodeId) {
      openCodeViewer(nodeId);
      return;
    }
    const node = graph?.nodes.find((n) => n.filePath === filePath);
    if (node) openCodeViewer(node.id);
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-heading text-sm text-text-primary">产品知识</h3>
        <p className="text-[11px] text-text-muted mt-1">
          {productKnowledge.productAreas.length} 个产品区域，{productKnowledge.concepts.length} 个产品概念
        </p>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索页面、标签、字段或展示规则"
        className="w-full rounded-lg bg-elevated border border-border-subtle px-3 py-2 text-xs text-text-primary outline-none focus:border-accent"
      />
      <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
        {concepts.map((concept) => (
          <div key={concept.id} className="rounded-lg border border-border-subtle bg-elevated p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-medium text-text-primary">{concept.name}</div>
              <span className="text-[9px] uppercase text-accent">{concept.confidence}</span>
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed mt-1">{concept.meaning}</p>
            {concept.userFacingTerms.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {concept.userFacingTerms.map((term) => (
                  <span key={term} className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary">
                    {term}
                  </span>
                ))}
              </div>
            )}
            {concept.displayRules.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">展示规则</div>
                {concept.displayRules.slice(0, 2).map((rule, index) => (
                  <p key={index} className="text-[11px] text-text-secondary mt-1">
                    {rule.condition} → {rule.result}
                  </p>
                ))}
              </div>
            )}
            {concept.evidence.length > 0 && (
              <button
                type="button"
                onClick={() => openEvidence(concept.evidence[0].nodeId, concept.evidence[0].filePath)}
                className="text-[11px] text-accent hover:text-accent-bright mt-2"
              >
                查看证据
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Surface product knowledge in ProjectOverview**

In `understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx`, read store state:

```typescript
const productKnowledge = useDashboardStore((s) => s.productKnowledge);
```

Add a compact stats row near existing project stats:

```tsx
{productKnowledge && (
  <div className="rounded-lg border border-border-subtle bg-elevated p-3">
    <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">产品知识</div>
    <div className="text-sm text-text-primary">
      {productKnowledge.productAreas.length} 个产品区域 · {productKnowledge.concepts.length} 个产品概念
    </div>
  </div>
)}
```

- [ ] **Step 5: Make the panel reachable**

In `understand-anything-plugin/packages/dashboard/src/App.tsx`, import:

```typescript
import ProductKnowledgePanel from "./components/ProductKnowledgePanel";
```

Where the sidebar renders `ProjectOverview` as the default info panel, render product panel below it when product knowledge exists:

```tsx
<>
  <ProjectOverview />
  <ProductKnowledgePanel />
</>
```

Keep `NodeInfo` behavior unchanged when a node is selected.

- [ ] **Step 6: Run dashboard build**

Run:

```bash
pnpm --filter @understand-anything/dashboard build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add understand-anything-plugin/packages/dashboard/src/store.ts \
  understand-anything-plugin/packages/dashboard/src/App.tsx \
  understand-anything-plugin/packages/dashboard/src/components/ProductKnowledgePanel.tsx \
  understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx \
  understand-anything-plugin/packages/dashboard/src/locales/zh.ts \
  understand-anything-plugin/packages/dashboard/src/locales/en.ts
git commit -m "feat(dashboard): display product knowledge"
```

---

### Task 7: End-to-End Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: localized README files only if this repository already keeps command lists synchronized in the current release workflow.

- [ ] **Step 1: Document `/understand-product` in the root README**

In `README.md`, add the command near `/understand-domain`:

```markdown
# Extract product-facing knowledge for PM questions
/understand-product
```

Add a short feature note:

```markdown
### Explain product knowledge

Generate product-facing knowledge such as page elements, labels, display rules, data fields, and code evidence. This is useful for questions like "How does the playback page show stream quality labels, and what do those labels mean?"
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @understand-anything/core test -- --run src/__tests__/product-knowledge.test.ts src/__tests__/product-persistence.test.ts
pnpm --filter @understand-anything/skill test -- --run src/__tests__/product-context-builder.test.ts
pnpm --filter @understand-anything/dashboard build
python3 -m py_compile understand-anything-plugin/skills/understand-product/extract-product-context.py
```

Expected: all commands pass.

- [ ] **Step 3: Run package builds**

Run:

```bash
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
pnpm --filter @understand-anything/dashboard build
```

Expected: all commands pass.

- [ ] **Step 4: Check git diff for accidental main-flow changes**

Run:

```bash
git diff --stat HEAD
git diff -- understand-anything-plugin/skills/understand/SKILL.md
```

Expected:

- Product knowledge files and explicitly planned consumers changed.
- No `/understand` phase ordering changes.
- No unrelated formatting churn.

- [ ] **Step 5: Commit Task 7**

```bash
git add README.md
git commit -m "docs: document product knowledge command"
```

---

## Final Verification Checklist

- [ ] `product-knowledge.json` is optional and absent files do not break `/understand-chat` or Dashboard.
- [ ] `/understand` default flow is unchanged.
- [ ] `/understand-domain` default flow is unchanged.
- [ ] Product concepts with `confidence: "confirmed"` require evidence.
- [ ] Product chat context includes product meaning, display rules, data fields, and code evidence before structural context.
- [ ] Dashboard loads invalid product knowledge as a warning, not a fatal app error.
- [ ] All new descriptive docs and skill text are Chinese-friendly and keep code identifiers unchanged.

