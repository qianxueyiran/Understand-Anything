# Grounded Product Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a grounded `/understand-product` pipeline where `/understand` emits lightweight `businessSignals`, and product topics, facts, and minimal evidence are generated from those signals through Topic Context Packs.

**Architecture:** Add `businessSignals` to knowledge-graph nodes during `file-analyzer`, preserve them through merge/validation, then replace the current evidence-heavy product-index builder with a prepare/extract/finalize pipeline. Code performs deterministic discovery, recall, packing, canonicalization, and validation; LLM only normalizes topics and extracts `Fact + EvidenceRefs` from bounded context packs.

**Tech Stack:** TypeScript strict mode, Zod, Vitest, pnpm workspaces, Python merge script tests, Codex skill orchestration.

---

## File Structure

Modify:

- `understand-anything-plugin/packages/core/src/types.ts` — add `BusinessSignal` and `businessSignals?: BusinessSignal[]` to `GraphNode`.
- `understand-anything-plugin/packages/core/src/schema.ts` — validate and sanitize graph node `businessSignals`.
- `understand-anything-plugin/packages/core/src/product-index.ts` — update product-index schema for grounded facts/evidence while preserving dashboard/chat compatibility.
- `understand-anything-plugin/packages/core/src/product-index-builder.ts` — replace current entry-expansion evidence path with grounded prepare/finalize functions, keeping keyword fallback isolated.
- `understand-anything-plugin/packages/core/src/index.ts` — export new grounded builder types/functions.
- `understand-anything-plugin/agents/file-analyzer.md` — instruct file analyzer to emit minimal `businessSignals`.
- `understand-anything-plugin/agents/product-index-analyzer.md` — change agent from post-hoc product-index enhancer to context-pack extractor.
- `understand-anything-plugin/skills/understand-product/SKILL.md` — orchestrate prepare, optional LLM extraction, finalize.
- `understand-anything-plugin/skills/understand/merge-batch-graphs.py` — preserve, dedupe, and cap `businessSignals`.
- `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py` — add merge tests for `businessSignals`.
- `understand-anything-plugin/src/product-index-cli.ts` — add `--prepare` and `--finalize` modes, keep `--fast` deterministic fallback.
- `understand-anything-plugin/src/product-index-context-builder.ts` — keep chat compatibility with grounded evidence/facts.

Create:

- `understand-anything-plugin/packages/core/src/__tests__/business-signals.test.ts` — schema and graph validation tests.
- `understand-anything-plugin/packages/core/src/__tests__/product-index-grounded-builder.test.ts` — boundary/context/finalization tests.
- `understand-anything-plugin/src/__tests__/product-index-grounded-cli.test.ts` — CLI orchestration tests.

Plan output files at runtime:

- `.understand-anything/intermediate/product-boundary-candidates.json`
- `.understand-anything/intermediate/product-context-packs.json`
- `.understand-anything/intermediate/product-index-extractions.json`
- `.understand-anything/product-index-trace.json`
- `.understand-anything/product-index.json`

---

### Task 1: Add Business Signals To Graph Types And Schema

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`
- Modify: `understand-anything-plugin/packages/core/src/schema.ts`
- Create: `understand-anything-plugin/packages/core/src/__tests__/business-signals.test.ts`

- [ ] **Step 1: Write failing tests for graph node businessSignals**

Create `understand-anything-plugin/packages/core/src/__tests__/business-signals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateGraph } from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

function graphWithNode(node: Record<string, unknown>): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "video-app",
      languages: ["java"],
      frameworks: ["android"],
      description: "Video app",
      analyzedAt: "2026-05-19T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes: [
      {
        id: "function:BootBroadcastReceiver.java:onReceive",
        type: "function",
        name: "onReceive",
        filePath: "app/BootBroadcastReceiver.java",
        lineRange: [18, 21],
        summary: "Receives boot broadcasts.",
        tags: ["receiver"],
        complexity: "simple",
        ...node,
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

describe("businessSignals", () => {
  it("accepts minimal business signals on graph nodes", () => {
    const result = validateGraph(
      graphWithNode({
        businessSignals: [
          { type: "entry", text: "开机广播接收入口" },
          { type: "behavior", text: "接收开机广播并启动后续处理" },
        ],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.nodes[0].businessSignals).toEqual([
      { type: "entry", text: "开机广播接收入口" },
      { type: "behavior", text: "接收开机广播并启动后续处理" },
    ]);
  });

  it("drops malformed business signals during graph validation", () => {
    const result = validateGraph(
      graphWithNode({
        businessSignals: [
          { type: "display", text: "首页退出确认弹窗" },
          { type: "unknown", text: "错误类型" },
          { type: "data", text: "" },
          { type: "rule", text: "  " },
        ],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.nodes[0].businessSignals).toEqual([
      { type: "display", text: "首页退出确认弹窗" },
    ]);
    expect(result.issues.some((issue) => issue.category === "invalid-business-signal")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- business-signals
```

Expected: FAIL because `GraphNode` and schema do not preserve typed `businessSignals`.

- [ ] **Step 3: Add core types**

Modify `understand-anything-plugin/packages/core/src/types.ts`:

```ts
export type BusinessSignalType =
  | "entry"
  | "behavior"
  | "rule"
  | "display"
  | "data"
  | "integration";

export interface BusinessSignal {
  type: BusinessSignalType;
  text: string;
}
```

Then add the optional property to `GraphNode`:

```ts
  businessSignals?: BusinessSignal[];
```

- [ ] **Step 4: Add schema validation and safe sanitization**

Modify `understand-anything-plugin/packages/core/src/schema.ts` near `GraphNodeSchema`:

```ts
const BusinessSignalSchema = z.object({
  type: z.enum(["entry", "behavior", "rule", "display", "data", "integration"]),
  text: z.string().trim().min(1).max(80),
});
```

Add `businessSignals` to `GraphNodeSchema`:

```ts
  businessSignals: z.array(BusinessSignalSchema).optional(),
```

In the node validation loop that currently drops invalid nodes, preserve valid signals and drop invalid signal entries before parsing the node. Add this helper in `schema.ts`:

```ts
function sanitiseBusinessSignals(value: unknown, issues: GraphIssue[], nodeId: string): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({
      level: "auto-corrected",
      category: "invalid-business-signal",
      message: `node ${nodeId} businessSignals must be an array; dropped`,
    });
    return undefined;
  }

  const valid: Array<z.infer<typeof BusinessSignalSchema>> = [];
  for (const signal of value) {
    const parsed = BusinessSignalSchema.safeParse(signal);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      issues.push({
        level: "auto-corrected",
        category: "invalid-business-signal",
        message: `node ${nodeId} has malformed businessSignal; dropped`,
      });
    }
  }

  return valid.length > 0 ? valid : undefined;
}
```

Call the helper before `GraphNodeSchema.safeParse(node)` in the node loop:

```ts
const nodeRecord = typeof node === "object" && node !== null ? { ...(node as Record<string, unknown>) } : node;
if (typeof nodeRecord === "object" && nodeRecord !== null) {
  const nodeId = typeof nodeRecord.id === "string" ? nodeRecord.id : `node[${i}]`;
  const businessSignals = sanitiseBusinessSignals(nodeRecord.businessSignals, issues, nodeId);
  if (businessSignals === undefined) {
    delete nodeRecord.businessSignals;
  } else {
    nodeRecord.businessSignals = businessSignals;
  }
}
const result = GraphNodeSchema.safeParse(nodeRecord);
```

- [ ] **Step 5: Run the test**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- business-signals
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add understand-anything-plugin/packages/core/src/types.ts \
  understand-anything-plugin/packages/core/src/schema.ts \
  understand-anything-plugin/packages/core/src/__tests__/business-signals.test.ts
git commit -m "feat(graph): add business signals to nodes"
```

---

### Task 2: Preserve Business Signals Through /understand Merge And Prompt Output

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py`
- Modify: `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`
- Modify: `understand-anything-plugin/agents/file-analyzer.md`

- [ ] **Step 1: Add merge tests for signal dedupe and caps**

Append to `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`:

```python
class BusinessSignalMergeTests(unittest.TestCase):
    def test_dedupes_and_caps_business_signals(self):
        node = {
            "id": "file:src/HomeActivity.kt",
            "type": "file",
            "name": "HomeActivity.kt",
            "filePath": "src/HomeActivity.kt",
            "summary": "Home entry.",
            "tags": [],
            "complexity": "simple",
            "businessSignals": [
                {"type": "entry", "text": "标准首页入口"},
                {"type": "entry", "text": "标准首页入口"},
                {"type": "display", "text": "首页退出确认弹窗"},
                {"type": "bad", "text": "错误类型"},
                {"type": "data", "text": ""},
                {"type": "behavior", "text": "首页初始化"},
                {"type": "rule", "text": "退出拦截策略"},
                {"type": "integration", "text": "外部路由调起"},
                {"type": "data", "text": "首页数据请求"},
                {"type": "display", "text": "首页顶部导航展示"},
                {"type": "behavior", "text": "首页推荐内容加载"},
            ],
        }

        assembled, report = mbg.merge_and_normalize([{"nodes": [node], "edges": []}])
        merged = assembled["nodes"][0]

        self.assertEqual(len(merged["businessSignals"]), 8)
        self.assertEqual(
            merged["businessSignals"][0],
            {"type": "entry", "text": "标准首页入口"},
        )
        self.assertEqual(
            len({(s["type"], s["text"]) for s in merged["businessSignals"]}),
            len(merged["businessSignals"]),
        )
        self.assertTrue(any("businessSignals" in line for line in report))
```

- [ ] **Step 2: Run the failing merge test**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py BusinessSignalMergeTests
```

Expected: FAIL because merge does not sanitize or report `businessSignals`.

- [ ] **Step 3: Add signal normalization helpers to merge script**

Add near other normalization helpers in `merge-batch-graphs.py`:

```python
BUSINESS_SIGNAL_TYPES = {"entry", "behavior", "rule", "display", "data", "integration"}
BUSINESS_SIGNAL_CAPS = {
    "file": 8,
    "class": 3,
    "function": 1,
}


def normalize_business_signals(node: dict[str, Any]) -> tuple[list[dict[str, str]], int]:
    raw = node.get("businessSignals")
    if not isinstance(raw, list):
        return [], 0

    cap = BUSINESS_SIGNAL_CAPS.get(str(node.get("type", "")), 3)
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    dropped = 0

    for item in raw:
        if not isinstance(item, dict):
            dropped += 1
            continue
        signal_type = item.get("type")
        text = item.get("text")
        if signal_type not in BUSINESS_SIGNAL_TYPES or not isinstance(text, str) or not text.strip():
            dropped += 1
            continue
        key = (signal_type, text.strip())
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        normalized.append({"type": signal_type, "text": text.strip()[:80]})
        if len(normalized) >= cap:
            break

    if len(raw) > len(normalized) + dropped:
        dropped += len(raw) - len(normalized) - dropped
    return normalized, dropped
```

In `merge_and_normalize`, after complexity normalization, normalize node signals:

```python
business_signal_dropped = 0
business_signal_nodes = 0
for node in nodes_with_ids:
    signals, dropped = normalize_business_signals(node)
    business_signal_dropped += dropped
    if signals:
        node["businessSignals"] = signals
        business_signal_nodes += 1
    elif "businessSignals" in node:
        del node["businessSignals"]
```

Add report lines before output summary:

```python
if business_signal_nodes:
    report.append(f"  {business_signal_nodes:>4} × nodes with businessSignals preserved")
if business_signal_dropped:
    report.append(f"  {business_signal_dropped:>4} × malformed/duplicate businessSignals dropped")
```

- [ ] **Step 4: Run the merge test**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py BusinessSignalMergeTests
```

Expected: PASS.

- [ ] **Step 5: Update file-analyzer prompt**

In `understand-anything-plugin/agents/file-analyzer.md`, after the node summary/tags guidance and before edge guidance, add:

```markdown
### Business Signals

When a file, class, function, method, endpoint, service, receiver, route, task, or resource clearly carries product-facing or business behavior, add a `businessSignals` array to that node.

Signal schema:

```json
{"type": "entry|behavior|rule|display|data|integration", "text": "short product phrase"}
```

Rules:

- `businessSignals` is optional. Omit it when the node has no clear product meaning.
- Do not include anchors, file paths, line ranges, conditions, or long explanations inside a signal. The node itself provides location.
- File node signals describe what business the file carries as a whole.
- Class/function/method node signals describe the concrete business behavior at that symbol.
- Each function/method node may have at most 1 signal.
- Each class node may have at most 3 signals.
- Each file node may have at most 8 signals.
- `text` must be a short product phrase, not a sentence-length code explanation.
- Do not emit signals for ViewBinding initialization, inheritance, dependency injection, logging, generic utilities, observer registration, or base framework boilerplate.

Examples:

```json
{"type": "entry", "text": "开机广播接收入口"}
{"type": "display", "text": "首页退出确认弹窗"}
{"type": "data", "text": "播放记录后台同步"}
{"type": "integration", "text": "投屏设备发现与连接"}
```
```

Also update the output JSON description to say `GraphNode` may include optional `businessSignals`.

- [ ] **Step 6: Run prompt-adjacent tests**

Run:

```bash
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py
corepack pnpm --filter @understand-anything/core test -- business-signals
```

Expected: both PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add understand-anything-plugin/skills/understand/merge-batch-graphs.py \
  understand-anything-plugin/skills/understand/test_merge_batch_graphs.py \
  understand-anything-plugin/agents/file-analyzer.md
git commit -m "feat(understand): preserve business signals"
```

---

### Task 3: Update Product Index Schema For Grounded Output

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/product-index.ts`
- Modify: `understand-anything-plugin/packages/core/src/__tests__/product-index.test.ts`
- Modify: `understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts`

- [ ] **Step 1: Add tests for grounded topic/fact/evidence shape**

Add to `understand-anything-plugin/packages/core/src/__tests__/product-index.test.ts`:

```ts
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
        sourceCandidateIds: ["candidate:BootBroadcastReceiver"],
        factIds: ["fact:boot-receiver-entry"],
        entryEvidenceIds: ["evidence:BootBroadcastReceiver.onReceive"],
        evidenceIds: ["evidence:BootBroadcastReceiver.onReceive"],
        domainRefs: [],
      },
    ],
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
      warnings: [],
    },
    quality: {
      groundedFacts: 1,
      ignoredFiles: 0,
      overflowFiles: 0,
    },
  });

  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run the failing schema test**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- product-index
```

Expected: FAIL because `sourceCandidateIds`, `factIds`, `quality`, `nodeIds`, `summary`, and expanded fact/evidence enums are not fully supported.

- [ ] **Step 3: Extend schemas while preserving compatibility**

Modify `understand-anything-plugin/packages/core/src/product-index.ts`:

```ts
export const ProductTopicKindSchema = z.enum([
  "capability",
  "surface",
  "element",
  "data",
  "integration",
]);

export const ProductFactTypeSchema = z.enum([
  "behavior",
  "rule",
  "display",
  "data",
  "integration",
  "mapping",
  "lifecycle",
]);
```

Add optional grounded fields:

```ts
export const ProductEvidenceSchema = z
  .object({
    id: z.string().min(1),
    role: ProductEvidenceRoleSchema,
    filePath: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
    lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    nodeId: z.string().min(1).optional(),
    nodeIds: z.array(z.string().min(1)).default([]),
    signalTypes: z.array(ProductSignalTypeSchema).default([]),
    tokens: z.array(z.string().min(1)).default([]),
    reason: z.string().min(1),
    summary: z.string().min(1).optional(),
    confidence: ProductConfidenceSchema,
  })
```

Add fields to `ProductTopicSchema`:

```ts
  sourceCandidateIds: z.array(z.string().min(1)).default([]),
  factIds: z.array(z.string().min(1)).default([]),
```

Add `quality` to `ProductIndexSchema`:

```ts
const ProductQualitySchema = z.object({
  groundedFacts: z.number().int().nonnegative().default(0),
  ignoredFiles: z.number().int().nonnegative().default(0),
  overflowFiles: z.number().int().nonnegative().default(0),
}).passthrough();
```

Then:

```ts
    quality: ProductQualitySchema.optional(),
```

In superRefine, verify topic `factIds`:

```ts
const factIds = new Set(index.facts.map((fact) => fact.id));
for (const topic of index.topics) {
  for (const factId of topic.factIds) {
    if (!factIds.has(factId)) {
      ctx.addIssue({
        code: "custom",
        message: `topic ${topic.id} references unknown fact id ${factId}`,
        path: ["topics"],
      });
    }
  }
}
```

- [ ] **Step 4: Run product-index schema tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- product-index
```

Expected: PASS.

- [ ] **Step 5: Run chat context tests**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- product-index-context-builder
```

Expected: PASS. If a test fails because it assumes topic-level evidence is broad, update assertions to use fact evidence while keeping existing product-aware prompt behavior.

- [ ] **Step 6: Commit Task 3**

```bash
git add understand-anything-plugin/packages/core/src/product-index.ts \
  understand-anything-plugin/packages/core/src/__tests__/product-index.test.ts \
  understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts
git commit -m "feat(product): support grounded index schema"
```

---

### Task 4: Build Grounded Boundary Discovery And Context Packs

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/product-index-builder.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Create: `understand-anything-plugin/packages/core/src/__tests__/product-index-grounded-builder.test.ts`

- [ ] **Step 1: Write failing tests for boundary discovery and context packs**

Create `understand-anything-plugin/packages/core/src/__tests__/product-index-grounded-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";
import {
  buildProductBoundaryCandidates,
  buildTopicContextPacks,
  normaliseProductTopics,
} from "../product-index-builder.js";

function node(overrides: Partial<GraphNode> & { id: string; name: string }): GraphNode {
  return {
    type: "class",
    summary: "",
    tags: [],
    complexity: "simple",
    ...overrides,
  };
}

function edge(overrides: Partial<GraphEdge> & { source: string; target: string }): GraphEdge {
  return {
    type: "calls",
    direction: "forward",
    weight: 0.8,
    ...overrides,
  };
}

function graph(nodes: GraphNode[], edges: GraphEdge[] = []): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "video-app",
      languages: ["java"],
      frameworks: ["Android"],
      description: "Video app",
      analyzedAt: "2026-05-19T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes,
    edges,
    layers: [],
    tour: [],
  };
}

describe("grounded product index builder", () => {
  const receiver = node({
    id: "class:BootBroadcastReceiver.java:BootBroadcastReceiver",
    name: "BootBroadcastReceiver",
    filePath: "app/BootBroadcastReceiver.java",
    businessSignals: [{ type: "entry", text: "开机广播接收入口" }],
  });
  const onReceive = node({
    id: "function:BootBroadcastReceiver.java:onReceive",
    type: "function",
    name: "onReceive",
    filePath: "app/BootBroadcastReceiver.java",
    lineRange: [18, 21],
    businessSignals: [{ type: "behavior", text: "接收开机广播并启动后续处理" }],
  });
  const homeTask = node({
    id: "function:HomeBootTask.java:startHomeDataRequest",
    type: "function",
    name: "startHomeDataRequest",
    filePath: "app/HomeBootTask.java",
    lineRange: [31, 65],
    businessSignals: [{ type: "data", text: "开机后首页数据请求" }],
  });
  const base = node({
    id: "class:BaseReceiver.java:BaseReceiver",
    name: "BaseReceiver",
    filePath: "common/BaseReceiver.java",
    summary: "Common base receiver.",
    tags: ["base"],
  });

  it("discovers product boundary candidates from graph businessSignals", () => {
    const candidates = buildProductBoundaryCandidates(graph([receiver, onReceive, base]));

    expect(candidates.map((candidate) => candidate.rootNodeId)).toContain(receiver.id);
    expect(candidates[0].businessSignals.map((signal) => signal.text)).toContain("开机广播接收入口");
  });

  it("builds compact topic context packs and keeps symbol anchors", () => {
    const kg = graph(
      [receiver, onReceive, homeTask, base],
      [
        edge({ source: receiver.id, target: onReceive.id, type: "contains" }),
        edge({ source: onReceive.id, target: homeTask.id, type: "calls" }),
        edge({ source: receiver.id, target: base.id, type: "inherits", weight: 0.2 }),
      ],
    );
    const topic = normaliseProductTopics([
      {
        id: "candidate:BootBroadcastReceiver",
        rootNodeId: receiver.id,
        name: "BootBroadcastReceiver",
        entryKind: "receiver",
        filePath: receiver.filePath,
        businessSignals: receiver.businessSignals ?? [],
        neighborNodeIds: [onReceive.id],
        domainRefs: [],
      },
    ])[0];

    const packs = buildTopicContextPacks(kg, [topic], { maxFilesPerTopic: 8, maxAnchorsPerFile: 4 });

    expect(packs).toHaveLength(1);
    expect(packs[0].candidateFiles.map((file) => file.filePath)).toContain("app/BootBroadcastReceiver.java");
    expect(packs[0].candidateFiles.flatMap((file) => file.anchors).map((anchor) => anchor.anchorId)).toContain(
      "anchor:function:BootBroadcastReceiver.java:onReceive",
    );
    expect(packs[0].candidateFiles.map((file) => file.filePath)).not.toContain("common/BaseReceiver.java");
  });
});
```

- [ ] **Step 2: Run the failing builder tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- product-index-grounded-builder
```

Expected: FAIL because the exported functions do not exist.

- [ ] **Step 3: Add grounded builder interfaces**

In `understand-anything-plugin/packages/core/src/product-index-builder.ts`, add:

```ts
export interface ProductBoundaryCandidate {
  id: string;
  rootNodeId: string;
  name: string;
  entryKind: string;
  filePath?: string;
  businessSignals: NonNullable<GraphNode["businessSignals"]>;
  neighborNodeIds: string[];
  domainRefs: string[];
}

export interface NormalizedProductTopic {
  id: string;
  name: string;
  summary: string;
  kind: ProductTopicKind;
  sourceCandidateIds: string[];
  rootNodeIds: string[];
  domainRefs: string[];
}

export interface ProductContextAnchor {
  anchorId: string;
  nodeId: string;
  type: "entry" | "behavior" | "rule" | "display" | "data" | "integration";
  text: string;
  symbol?: string;
  lineRange?: [number, number];
  snippetSummary: string;
}

export interface ProductContextFile {
  fileId: string;
  filePath: string;
  nodeSummaries: string[];
  businessSignals: Array<{ type: string; text: string; nodeId: string }>;
  structuralReasons: string[];
  anchors: ProductContextAnchor[];
}

export interface TopicContextPack {
  topic: NormalizedProductTopic;
  roots: string[];
  candidateFiles: ProductContextFile[];
  overflowFiles: string[];
}
```

- [ ] **Step 4: Implement deterministic boundary discovery**

Add:

```ts
export function buildProductBoundaryCandidates(
  graph: KnowledgeGraph,
  domainGraph?: KnowledgeGraph,
  options: ProductProfileOptions = { platform: "android" },
): ProductBoundaryCandidate[] {
  const patterns = compileEntryPatterns(options.entryPatterns);
  const adjacency = buildAdjacency(graph.edges);
  const domainRefsByToken = buildDomainRefsByToken(domainGraph);

  return graph.nodes
    .filter((node) => isEntryCandidate(node, patterns) || hasBoundarySignal(node))
    .map((node) => ({
      id: `candidate:${node.id}`,
      rootNodeId: node.id,
      name: node.name,
      entryKind: inferEntryKind(node),
      ...(node.filePath ? { filePath: node.filePath } : {}),
      businessSignals: node.businessSignals ?? [],
      neighborNodeIds: uniqueStrings((adjacency.get(node.id) ?? []).map((neighbor) => neighbor.nodeId)).slice(0, 16),
      domainRefs: collectDomainRefsFromTokens(domainRefsByToken, [
        node.name,
        node.filePath ?? "",
        ...(node.businessSignals ?? []).map((signal) => signal.text),
      ]),
    }))
    .filter((candidate) => candidate.businessSignals.length > 0 || candidate.entryKind !== "entry")
    .sort((a, b) => a.id.localeCompare(b.id));
}

function hasBoundarySignal(node: GraphNode): boolean {
  return (node.businessSignals ?? []).some((signal) =>
    signal.type === "entry" || signal.type === "display" || signal.type === "rule" || signal.type === "data" || signal.type === "integration",
  );
}
```

Add helper functions `buildDomainRefsByToken` and `collectDomainRefsFromTokens` using existing `meaningfulBusinessTokens`.

- [ ] **Step 5: Implement deterministic topic normalization fallback**

Add:

```ts
export function normaliseProductTopics(candidates: ProductBoundaryCandidate[]): NormalizedProductTopic[] {
  return candidates.map((candidate) => {
    const signalName = candidate.businessSignals[0]?.text;
    const name = signalName ?? candidate.name;
    return {
      id: stableTopicId(name, candidate.rootNodeId),
      name,
      summary: `${name} 相关产品主题。`,
      kind: topicKindForEntry(candidate.entryKind),
      sourceCandidateIds: [candidate.id],
      rootNodeIds: [candidate.rootNodeId],
      domainRefs: candidate.domainRefs,
    };
  });
}

function stableTopicId(name: string, fallback: string): string {
  const slug = extractTokens(name).join("-").toLowerCase() || fallback.replace(/[^A-Za-z0-9_\u4e00-\u9fa5]+/gu, "-");
  return `topic:${slug}`.replace(/-+/gu, "-").replace(/-$/u, "");
}
```

- [ ] **Step 6: Implement topic context pack builder**

Add:

```ts
export interface TopicContextPackOptions {
  maxFilesPerTopic?: number;
  maxAnchorsPerFile?: number;
}

export function buildTopicContextPacks(
  graph: KnowledgeGraph,
  topics: NormalizedProductTopic[],
  options: TopicContextPackOptions = {},
): TopicContextPack[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(graph.edges);
  const maxFiles = options.maxFilesPerTopic ?? 30;
  const maxAnchors = options.maxAnchorsPerFile ?? 5;

  return topics.map((topic) => {
    const candidateNodeIds = recallTopicNodeIds(topic, adjacency, nodeById);
    const files = buildContextFiles(candidateNodeIds, nodeById, maxAnchors);
    return {
      topic,
      roots: topic.rootNodeIds,
      candidateFiles: files.slice(0, maxFiles),
      overflowFiles: files.slice(maxFiles).map((file) => file.filePath),
    };
  });
}
```

Implement `recallTopicNodeIds` to include root node ids, direct neighbors, and second-hop nodes only when the node has `businessSignals`. Implement `buildContextFiles` so it groups by `filePath`, excludes common infrastructure paths with `isHardFilteredFile`, creates anchors only from nodes with `businessSignals`, and prefers symbol nodes over file nodes when both exist for the same file.

- [ ] **Step 7: Export new functions**

Modify `understand-anything-plugin/packages/core/src/index.ts`:

```ts
export {
  buildProductBoundaryCandidates,
  buildTopicContextPacks,
  normaliseProductTopics,
  type NormalizedProductTopic,
  type ProductBoundaryCandidate,
  type ProductContextAnchor,
  type ProductContextFile,
  type TopicContextPack,
} from "./product-index-builder.js";
```

- [ ] **Step 8: Run builder tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- product-index-grounded-builder
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add understand-anything-plugin/packages/core/src/product-index-builder.ts \
  understand-anything-plugin/packages/core/src/index.ts \
  understand-anything-plugin/packages/core/src/__tests__/product-index-grounded-builder.test.ts
git commit -m "feat(product): build grounded context packs"
```

---

### Task 5: Finalize Product Index From LLM Extractions

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/product-index-builder.ts`
- Modify: `understand-anything-plugin/packages/core/src/__tests__/product-index-grounded-builder.test.ts`

- [ ] **Step 1: Add tests for fact/evidence finalization**

Append to `product-index-grounded-builder.test.ts`:

```ts
import { finalizeGroundedProductIndex } from "../product-index-builder.js";
import { validateProductIndex } from "../product-index.js";

it("finalizes facts and only promotes referenced anchors to evidence", () => {
  const kg = graph([
    {
      id: "function:BootBroadcastReceiver.java:onReceive",
      type: "function",
      name: "onReceive",
      filePath: "app/BootBroadcastReceiver.java",
      lineRange: [18, 21],
      summary: "Receives boot broadcasts.",
      tags: ["receiver"],
      complexity: "simple",
      businessSignals: [{ type: "behavior", text: "接收开机广播并启动后续处理" }],
    },
  ]);
  const topic = {
    id: "topic:boot-receiver",
    name: "开机广播调起",
    summary: "开机广播触发首页初始化相关业务。",
    kind: "capability" as const,
    sourceCandidateIds: ["candidate:BootBroadcastReceiver"],
    rootNodeIds: ["function:BootBroadcastReceiver.java:onReceive"],
    domainRefs: [],
  };
  const packs = buildTopicContextPacks(kg, [topic]);

  const index = finalizeGroundedProductIndex({
    graph: kg,
    topics: [topic],
    contextPacks: packs,
    extractions: [
      {
        topicId: "topic:boot-receiver",
        usedFiles: [{ fileId: "file:app/BootBroadcastReceiver.java", reason: "承载开机广播接收" }],
        ignoredFiles: [],
        facts: [
          {
            type: "behavior",
            text: "应用接收开机广播后会启动后续首页初始化处理。",
            conditions: ["系统发出开机广播"],
            evidenceRefs: ["anchor:function:BootBroadcastReceiver.java:onReceive"],
            confidence: "confirmed",
          },
        ],
      },
    ],
    options: { platform: "android", analyzedAt: "2026-05-19T00:00:00.000Z" },
  });

  expect(index.topics).toHaveLength(1);
  expect(index.facts).toHaveLength(1);
  expect(index.evidence).toHaveLength(1);
  expect(index.topics[0].factIds).toEqual([index.facts[0].id]);
  expect(index.facts[0].evidenceIds).toEqual([index.evidence[0].id]);
  expect(index.evidence[0].lineRange).toEqual([18, 21]);
  expect(validateProductIndex(index).success).toBe(true);
});

it("drops facts without valid evidence refs and removes empty topics", () => {
  const kg = graph([]);
  const topic = {
    id: "topic:empty",
    name: "空主题",
    summary: "没有有效证据。",
    kind: "capability" as const,
    sourceCandidateIds: ["candidate:empty"],
    rootNodeIds: [],
    domainRefs: [],
  };

  const index = finalizeGroundedProductIndex({
    graph: kg,
    topics: [topic],
    contextPacks: [{ topic, roots: [], candidateFiles: [], overflowFiles: [] }],
    extractions: [
      {
        topicId: "topic:empty",
        usedFiles: [],
        ignoredFiles: [],
        facts: [
          {
            type: "behavior",
            text: "这条事实没有证据。",
            conditions: [],
            evidenceRefs: [],
            confidence: "confirmed",
          },
        ],
      },
    ],
    options: { platform: "android", analyzedAt: "2026-05-19T00:00:00.000Z" },
  });

  expect(index.topics).toHaveLength(0);
  expect(index.facts).toHaveLength(0);
  expect(index.evidence).toHaveLength(0);
  expect(index.coverage.warnings.some((warning) => warning.code === "fact-without-evidence")).toBe(true);
});
```

- [ ] **Step 2: Run failing finalization tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- product-index-grounded-builder
```

Expected: FAIL because `finalizeGroundedProductIndex` does not exist.

- [ ] **Step 3: Add extraction interfaces**

In `product-index-builder.ts`:

```ts
export interface ProductExtractionFact {
  type: "behavior" | "rule" | "display" | "data" | "integration" | "mapping" | "lifecycle";
  text: string;
  conditions: string[];
  evidenceRefs: string[];
  confidence: "confirmed" | "inferred" | "uncertain";
}

export interface ProductTopicExtraction {
  topicId: string;
  usedFiles: Array<{ fileId: string; reason: string }>;
  ignoredFiles: Array<{ fileId: string; reason: string }>;
  facts: ProductExtractionFact[];
}

export interface FinalizeGroundedProductIndexInput {
  graph: KnowledgeGraph;
  topics: NormalizedProductTopic[];
  contextPacks: TopicContextPack[];
  extractions: ProductTopicExtraction[];
  options: ProductProfileOptions;
}
```

- [ ] **Step 4: Implement finalizer**

Add:

```ts
export function finalizeGroundedProductIndex(input: FinalizeGroundedProductIndexInput): ProductIndex {
  const evidenceById = new Map<string, ProductEvidence>();
  const facts: ProductFact[] = [];
  const warnings: ProductCoverageWarning[] = [];
  const packByTopicId = new Map(input.contextPacks.map((pack) => [pack.topic.id, pack]));
  const extractionByTopicId = new Map(input.extractions.map((extraction) => [extraction.topicId, extraction]));
  const topicFactIds = new Map<string, string[]>();

  for (const topic of input.topics) {
    const pack = packByTopicId.get(topic.id);
    const extraction = extractionByTopicId.get(topic.id);
    if (!pack || !extraction) {
      warnings.push({ code: "missing-topic-extraction", message: `No extraction for ${topic.id}`, topicId: topic.id });
      continue;
    }

    const anchorById = buildAnchorIndex(pack);
    for (const factInput of extraction.facts) {
      const selectedAnchors = uniqueStrings(factInput.evidenceRefs)
        .map((ref) => anchorById.get(ref))
        .filter((anchor): anchor is ProductContextAnchor => Boolean(anchor))
        .slice(0, 3);

      if (selectedAnchors.length === 0) {
        warnings.push({ code: "fact-without-evidence", message: `Dropped fact without evidence: ${factInput.text}`, topicId: topic.id });
        continue;
      }

      const evidenceIds = selectedAnchors.map((anchor) => {
        const evidence = buildEvidenceFromAnchor(anchor, input.graph);
        evidenceById.set(evidence.id, evidence);
        return evidence.id;
      });
      const factId = stableFactId(topic.id, factInput.text);
      facts.push({
        id: factId,
        topicIds: [topic.id],
        type: factInput.type,
        text: factInput.text,
        conditions: factInput.conditions,
        evidenceIds,
        confidence: factInput.confidence,
        maturity: "indexed",
      });
      topicFactIds.set(topic.id, [...(topicFactIds.get(topic.id) ?? []), factId]);
    }
  }

  const evidence = Array.from(evidenceById.values());
  const topics: ProductTopic[] = input.topics
    .map((topic) => {
      const factIds = topicFactIds.get(topic.id) ?? [];
      const evidenceIds = uniqueStrings(
        facts.filter((fact) => fact.topicIds.includes(topic.id)).flatMap((fact) => fact.evidenceIds),
      );
      return {
        id: topic.id,
        kind: topic.kind,
        name: topic.name,
        aliases: [],
        summary: topic.summary,
        status: "indexed" as const,
        sourceCandidateIds: topic.sourceCandidateIds,
        factIds,
        entryEvidenceIds: evidence.filter((item) => evidenceIds.includes(item.id) && item.role === "entry").map((item) => item.id),
        evidenceIds,
        domainRefs: topic.domainRefs,
      };
    })
    .filter((topic) => topic.factIds.length > 0);

  return {
    version: "1.0.0",
    kind: "product-index",
    project: {
      name: input.graph.project.name,
      platforms: [input.options.platform],
      languages: input.graph.project.languages,
      frameworks: input.graph.project.frameworks,
      analyzedAt: input.options.analyzedAt ?? input.graph.project.analyzedAt,
      gitCommitHash: input.graph.project.gitCommitHash,
    },
    sources: {
      knowledgeGraph: {
        path: ".understand-anything/knowledge-graph.json",
        gitCommitHash: input.graph.project.gitCommitHash,
        required: true,
      },
    },
    topics,
    facts: facts.filter((fact) => topics.some((topic) => fact.topicIds.includes(topic.id))),
    evidence: evidence.filter((item) => topics.some((topic) => topic.evidenceIds.includes(item.id))),
    coverage: {
      platformProfiles: [input.options.platform],
      entryPoints: input.topics.length,
      indexedTopics: topics.length,
      confirmedEvidence: evidence.filter((item) => item.confidence === "confirmed").length,
      generatedFacts: facts.length,
      warnings,
    },
    quality: {
      groundedFacts: facts.length,
      ignoredFiles: input.extractions.reduce((total, extraction) => total + extraction.ignoredFiles.length, 0),
      overflowFiles: input.contextPacks.reduce((total, pack) => total + pack.overflowFiles.length, 0),
    },
  };
}
```

Implement `buildAnchorIndex`, `buildEvidenceFromAnchor`, `stableFactId`, and reuse existing `uniqueStrings`.

- [ ] **Step 5: Run finalization tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test -- product-index-grounded-builder
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add understand-anything-plugin/packages/core/src/product-index-builder.ts \
  understand-anything-plugin/packages/core/src/__tests__/product-index-grounded-builder.test.ts
git commit -m "feat(product): finalize grounded product index"
```

---

### Task 6: Add CLI Prepare/Finalize Modes And Skill Orchestration

**Files:**
- Modify: `understand-anything-plugin/src/product-index-cli.ts`
- Create: `understand-anything-plugin/src/__tests__/product-index-grounded-cli.test.ts`
- Modify: `understand-anything-plugin/skills/understand-product/SKILL.md`
- Modify: `understand-anything-plugin/agents/product-index-analyzer.md`

- [ ] **Step 1: Write CLI tests**

Create `understand-anything-plugin/src/__tests__/product-index-grounded-cli.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { runProductIndexCli } from "../product-index-cli.js";

function writeGraph(projectRoot: string): void {
  const dir = join(projectRoot, ".understand-anything");
  mkdirSync(dir, { recursive: true });
  const graph: KnowledgeGraph = {
    version: "1.0.0",
    project: {
      name: "video-app",
      languages: ["java"],
      frameworks: ["Android"],
      description: "Video app",
      analyzedAt: "2026-05-19T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes: [
      {
        id: "function:BootBroadcastReceiver.java:onReceive",
        type: "function",
        name: "onReceive",
        filePath: "app/BootBroadcastReceiver.java",
        lineRange: [18, 21],
        summary: "Receives boot broadcasts.",
        tags: ["receiver"],
        complexity: "simple",
        businessSignals: [{ type: "behavior", text: "接收开机广播并启动后续处理" }],
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
  writeFileSync(join(dir, "knowledge-graph.json"), JSON.stringify(graph, null, 2), "utf-8");
}

describe("grounded product index cli", () => {
  it("prepares context packs without writing final facts", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-prepare-"));
    writeGraph(projectRoot);

    const result = await runProductIndexCli([projectRoot, "--prepare", "--platform", "android"]);

    expect(result.contextPacks).toBeGreaterThan(0);
    expect(existsSync(join(projectRoot, ".understand-anything/intermediate/product-context-packs.json"))).toBe(true);
  });

  it("finalizes product index from extraction file", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-finalize-"));
    writeGraph(projectRoot);
    await runProductIndexCli([projectRoot, "--prepare", "--platform", "android"]);

    const packs = JSON.parse(
      readFileSync(join(projectRoot, ".understand-anything/intermediate/product-context-packs.json"), "utf-8"),
    );
    writeFileSync(
      join(projectRoot, ".understand-anything/intermediate/product-index-extractions.json"),
      JSON.stringify(
        [
          {
            topicId: packs[0].topic.id,
            usedFiles: [{ fileId: packs[0].candidateFiles[0].fileId, reason: "承载开机广播处理" }],
            ignoredFiles: [],
            facts: [
              {
                type: "behavior",
                text: "应用接收开机广播后会启动后续首页初始化处理。",
                conditions: ["系统发出开机广播"],
                evidenceRefs: [packs[0].candidateFiles[0].anchors[0].anchorId],
                confidence: "confirmed",
              },
            ],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    const result = await runProductIndexCli([projectRoot, "--finalize", "--platform", "android"]);

    expect(result.topics).toBe(1);
    expect(result.facts).toBe(1);
    expect(result.evidence).toBe(1);
    expect(existsSync(join(projectRoot, ".understand-anything/product-index.json"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing CLI tests**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- product-index-grounded-cli
```

Expected: FAIL because `--prepare`, `--finalize`, `contextPacks`, and `facts` result fields are not implemented.

- [ ] **Step 3: Extend CLI result and arguments**

Modify `ProductIndexCliResult`:

```ts
export interface ProductIndexCliResult {
  projectRoot: string;
  productIndexPath: string;
  productSignalsPath?: string;
  contextPacksPath?: string;
  tracePath?: string;
  topics: number;
  facts: number;
  evidence: number;
  signals: number;
  contextPacks: number;
}
```

Add boolean flags:

```ts
const BOOLEAN_FLAGS = new Set(["--fast", "--prepare", "--finalize"]);
```

Add to `ParsedArgs`:

```ts
prepare: boolean;
finalize: boolean;
```

Set:

```ts
prepare: booleans.has("--prepare"),
finalize: booleans.has("--finalize"),
```

Reject simultaneous prepare/finalize:

```ts
if (booleans.has("--prepare") && booleans.has("--finalize")) {
  throw new Error("--prepare and --finalize cannot be used together");
}
```

- [ ] **Step 4: Implement prepare mode**

In `runProductIndexCli`, after graph/domain load:

```ts
if (options.prepare) {
  const candidates = buildProductBoundaryCandidates(graph, domainGraph, builderOptions);
  const topics = normaliseProductTopics(candidates);
  const contextPacks = buildTopicContextPacks(graph, topics);
  const intermediateDir = join(options.projectRoot, ".understand-anything", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
  const candidatesPath = join(intermediateDir, "product-boundary-candidates.json");
  const packsPath = join(intermediateDir, "product-context-packs.json");
  writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2), "utf-8");
  writeFileSync(packsPath, JSON.stringify(contextPacks, null, 2), "utf-8");

  return {
    projectRoot: options.projectRoot,
    productIndexPath: join(options.projectRoot, ".understand-anything", "product-index.json"),
    contextPacksPath: packsPath,
    topics: topics.length,
    facts: 0,
    evidence: 0,
    signals: countGraphBusinessSignals(graph),
    contextPacks: contextPacks.length,
  };
}
```

- [ ] **Step 5: Implement finalize mode**

Add:

```ts
if (options.finalize) {
  const intermediateDir = join(options.projectRoot, ".understand-anything", "intermediate");
  const packsPath = join(intermediateDir, "product-context-packs.json");
  const extractionsPath = join(intermediateDir, "product-index-extractions.json");
  const contextPacks = JSON.parse(readFileSync(packsPath, "utf-8"));
  const extractions = JSON.parse(readFileSync(extractionsPath, "utf-8"));
  const topics = contextPacks.map((pack: TopicContextPack) => pack.topic);
  const index = finalizeGroundedProductIndex({
    graph,
    topics,
    contextPacks,
    extractions,
    options: builderOptions,
  });
  saveProductIndex(options.projectRoot, index);
  writeFileSync(
    join(options.projectRoot, ".understand-anything", "product-index-trace.json"),
    JSON.stringify({ contextPacks, extractions, warnings: index.coverage.warnings }, null, 2),
    "utf-8",
  );

  return {
    projectRoot: options.projectRoot,
    productIndexPath: join(options.projectRoot, ".understand-anything", "product-index.json"),
    contextPacksPath: packsPath,
    tracePath: join(options.projectRoot, ".understand-anything", "product-index-trace.json"),
    topics: index.topics.length,
    facts: index.facts.length,
    evidence: index.evidence.length,
    signals: countGraphBusinessSignals(graph),
    contextPacks: contextPacks.length,
  };
}
```

Add imports `readFileSync` and `mkdirSync`, plus new core functions/types.

- [ ] **Step 6: Keep --fast deterministic fallback**

For no `--prepare` and no `--finalize`, preserve existing behavior for compatibility, but change it to call prepare + a minimal fallback extraction:

```ts
const candidates = buildProductBoundaryCandidates(graph, domainGraph, builderOptions);
const topics = normaliseProductTopics(candidates);
const contextPacks = buildTopicContextPacks(graph, topics);
const fallbackExtractions = buildFallbackProductExtractions(contextPacks);
const index = finalizeGroundedProductIndex({
  graph,
  topics,
  contextPacks,
  extractions: fallbackExtractions,
  options: builderOptions,
});
saveProductIndex(options.projectRoot, index);
```

`buildFallbackProductExtractions` should create at most one `inferred` fact per topic from the first symbol-level anchor:

```ts
{
  type: anchor.type === "entry" ? "behavior" : anchor.type,
  text: `${pack.topic.name} 包含 ${anchor.text}。`,
  conditions: [],
  evidenceRefs: [anchor.anchorId],
  confidence: "inferred"
}
```

- [ ] **Step 7: Update product-index analyzer agent**

Replace `understand-anything-plugin/agents/product-index-analyzer.md` content with:

```markdown
---
name: product-index-analyzer
description: 基于 Topic Context Pack 抽取产品事实和最小证据引用。
model: inherit
---

# Product Index Analyzer

你是产品知识索引抽取 agent。你只能基于输入的 Topic Context Pack 生成产品事实和 evidenceRefs。

## 输入

- `<project-root>/.understand-anything/intermediate/product-context-packs.json`

## 输出

写入：

```text
<project-root>/.understand-anything/intermediate/product-index-extractions.json
```

输出 JSON 必须是数组。每个元素对应一个 topic：

```json
{
  "topicId": "topic:standard-home",
  "usedFiles": [{"fileId": "file:xxx/HomeActivity.kt", "reason": "承载首页退出交互"}],
  "ignoredFiles": [{"fileId": "file:xxx/BaseActivity.kt", "reason": "通用基础类"}],
  "facts": [
    {
      "type": "display",
      "text": "用户在标准首页触发退出时，系统会展示退出确认弹窗。",
      "conditions": ["用户触发首页退出"],
      "evidenceRefs": ["anchor:function:HomeActivity.kt:showExitDialog"],
      "confidence": "confirmed"
    }
  ]
}
```

## 规则

- 只能使用 Context Pack 中已有的 `fileId` 和 `anchorId`。
- 不能新增文件。
- 不能新增 anchor。
- 每个 fact 必须有 1 到 3 个 `evidenceRefs`。
- 没有 evidenceRefs 的 fact 不要输出。
- `ignoredFiles` 表示你判断与当前 topic 产品事实无关的文件。
- 不要输出“继承 BaseActivity”“调用 initView”“初始化变量”这类代码解释。
- Fact 必须是产品事实，描述业务行为、规则、展示、数据或集成。
- 完成后只回复中文统计摘要。
```

- [ ] **Step 8: Update understand-product skill orchestration**

Modify `understand-anything-plugin/skills/understand-product/SKILL.md`:

```markdown
## Phase 1: 准备 Topic Context Packs

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --prepare $ARGUMENTS
```

该命令生成：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs.json
```

## Phase 2: LLM 抽取 Fact + EvidenceRefs

如果用户没有传 `--fast`，派发 `agents/product-index-analyzer.md`。Agent 读取 `product-context-packs.json`，写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-index-extractions.json
```

## Phase 3: Finalize product-index

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --finalize $ARGUMENTS
```

如果用户传 `--fast`，跳过 Phase 2，直接运行不带 `--prepare/--finalize` 的 deterministic fallback：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --fast $ARGUMENTS
```
```

- [ ] **Step 9: Run CLI tests**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- product-index-grounded-cli
```

Expected: PASS.

- [ ] **Step 10: Commit Task 6**

```bash
git add understand-anything-plugin/src/product-index-cli.ts \
  understand-anything-plugin/src/__tests__/product-index-grounded-cli.test.ts \
  understand-anything-plugin/skills/understand-product/SKILL.md \
  understand-anything-plugin/agents/product-index-analyzer.md
git commit -m "feat(product): orchestrate grounded extraction"
```

---

### Task 7: Keep Chat And Dashboard Compatible With Grounded Evidence

**Files:**
- Modify: `understand-anything-plugin/src/product-index-context-builder.ts`
- Modify: `understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/ProductIndexPanel.tsx`

- [ ] **Step 1: Add chat context regression test**

Append to `product-index-context-builder.test.ts`:

```ts
it("uses grounded fact evidence even when topic evidence is minimal", () => {
  const groundedIndex: ProductIndex = {
    ...productIndex,
    topics: [
      {
        ...productIndex.topics[0],
        factIds: ["fact:casting-entry"],
        evidenceIds: ["ev:player-entry"],
      },
    ],
    facts: [
      {
        ...productIndex.facts[0],
        evidenceIds: ["ev:player-entry"],
      },
    ],
  };

  const ctx = buildProductIndexChatContext({
    graph,
    productIndex: groundedIndex,
    query: "投屏入口在哪里",
  });

  expect(ctx.productResults[0].facts[0].text).toContain("播放页提供投屏入口");
  expect(ctx.codeEvidenceNodes.map((node) => node.id)).toContain(
    "class:player/PlayerActivity.kt:PlayerActivity",
  );
});
```

- [ ] **Step 2: Run failing/passing context test**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test -- product-index-context-builder
```

Expected: PASS if current code already follows fact evidence; if FAIL, implement Step 3.

- [ ] **Step 3: Prefer fact evidence when expanding product context**

In `product-index-context-builder.ts`, when collecting evidence IDs for matched topics, derive them from matched facts first:

```ts
const evidenceRefs = new Set<string>();
for (const fact of facts) {
  for (const evidenceId of fact.evidenceIds) {
    evidenceRefs.add(evidenceId);
  }
}
for (const topic of topics) {
  for (const evidenceId of topic.entryEvidenceIds) {
    evidenceRefs.add(evidenceId);
  }
}
```

Only include `topic.evidenceIds` as a fallback when no fact evidence exists:

```ts
if (evidenceRefs.size === 0) {
  for (const topic of topics) {
    for (const evidenceId of topic.evidenceIds) {
      evidenceRefs.add(evidenceId);
    }
  }
}
```

- [ ] **Step 4: Update dashboard display copy**

In `ProductIndexPanel.tsx`, ensure count labels and detail sections do not imply topic evidence is broad related code. Use:

```tsx
<span>{topic.factIds?.length ?? facts.length} facts</span>
<span>{topic.evidenceIds.length} evidence refs</span>
```

In the evidence section title, use:

```tsx
<h4>Fact Evidence</h4>
```

- [ ] **Step 5: Run dashboard build**

Run:

```bash
corepack pnpm --filter @understand-anything/dashboard build
```

Expected: PASS. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 6: Commit Task 7**

```bash
git add understand-anything-plugin/src/product-index-context-builder.ts \
  understand-anything-plugin/src/__tests__/product-index-context-builder.test.ts \
  understand-anything-plugin/packages/dashboard/src/components/ProductIndexPanel.tsx
git commit -m "fix(product): prefer grounded fact evidence"
```

---

### Task 8: Full Verification And Documentation Updates

**Files:**
- Modify: `understand-anything-plugin/skills/understand-product/SKILL.md`
- Modify: `README.md`
- Modify: `READMEs/README.zh-CN.md`

- [ ] **Step 1: Update user-facing docs**

In `README.md` and `READMEs/README.zh-CN.md`, update `/understand-product` description:

```markdown
`/understand-product` builds a product knowledge index from an existing knowledge graph. It uses business signals generated during `/understand`, constructs bounded Topic Context Packs, then extracts product facts with minimal code evidence.
```

Chinese README:

```markdown
`/understand-product` 基于已有 knowledge graph 生成产品知识索引。它优先消费 `/understand` 阶段沉淀的 businessSignals，构建有界的 Topic Context Pack，再生成产品事实和最小代码证据。
```

- [ ] **Step 2: Run core tests**

Run:

```bash
corepack pnpm --filter @understand-anything/core test
```

Expected: PASS.

- [ ] **Step 3: Run skill tests**

Run:

```bash
corepack pnpm --filter @understand-anything/skill test
```

Expected: PASS.

- [ ] **Step 4: Run builds**

Run:

```bash
corepack pnpm --filter @understand-anything/core build
corepack pnpm --filter @understand-anything/skill build
corepack pnpm --filter @understand-anything/dashboard build
```

Expected: all PASS. Existing dashboard chunk-size warnings are acceptable.

- [ ] **Step 5: Run targeted smoke with generated graph fixture**

Create a temporary fixture directory through a test or shell temp directory, write a small `.understand-anything/knowledge-graph.json` with:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "video-app",
    "languages": ["java"],
    "frameworks": ["Android"],
    "description": "Video app",
    "analyzedAt": "2026-05-19T00:00:00.000Z",
    "gitCommitHash": "abc123"
  },
  "nodes": [
    {
      "id": "function:BootBroadcastReceiver.java:onReceive",
      "type": "function",
      "name": "onReceive",
      "filePath": "app/BootBroadcastReceiver.java",
      "lineRange": [18, 21],
      "summary": "Receives boot broadcasts.",
      "tags": ["receiver"],
      "complexity": "simple",
      "businessSignals": [{"type": "behavior", "text": "接收开机广播并启动后续处理"}]
    }
  ],
  "edges": [],
  "layers": [],
  "tour": []
}
```

Run:

```bash
node understand-anything-plugin/dist/product-index-cli.js "$FIXTURE_ROOT" --prepare --platform android
node understand-anything-plugin/dist/product-index-cli.js "$FIXTURE_ROOT" --fast --platform android
```

Expected:

- `intermediate/product-context-packs.json` exists after `--prepare`.
- `product-index.json` exists after `--fast`.
- `product-index.json` has `topics.length >= 1`.
- `product-index.json` has `facts.length >= 1`.
- every fact has non-empty `evidenceIds`.

- [ ] **Step 6: Commit docs and verification adjustments**

```bash
git add README.md READMEs/README.zh-CN.md understand-anything-plugin/skills/understand-product/SKILL.md
git commit -m "docs(product): explain grounded product index"
```

---

## Self-Review Checklist

- [ ] Spec coverage: Tasks 1-2 implement knowledge-graph `businessSignals`; Tasks 4-6 implement `/understand-product`; Task 7 preserves answering/dashboard; Task 8 verifies and documents.
- [ ] No placeholder steps: every task has exact files, commands, and expected output.
- [ ] Type consistency: `BusinessSignal`, `ProductBoundaryCandidate`, `TopicContextPack`, `ProductTopicExtraction`, and final product-index fields are introduced before use.
- [ ] Evidence rule: only anchors referenced by extracted facts become final evidence.
- [ ] Fast mode: deterministic fallback remains available and still produces grounded inferred facts.
