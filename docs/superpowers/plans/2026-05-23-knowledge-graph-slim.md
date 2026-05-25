# Knowledge Graph Slim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop emitting `function` and `class` nodes (and symbol edges) in all new knowledge-graph output while preserving file nodes and file-level edges like `imports`.

**Architecture:** Change the pipeline at the source (`file-analyzer.md`) so Phase 2 no longer creates symbol nodes/edges; add a deterministic safety net in `merge-batch-graphs.py`; simplify dashboard and skill consumers to file-only expectations. Phase 1 (`extract-structure.mjs`) stays unchanged for summaries and incremental fingerprints.

**Tech Stack:** Python 3 (`merge-batch-graphs.py`, unittest), TypeScript strict + Vitest (`packages/core`, plugin `src/`), React dashboard, Markdown agent/skill definitions.

**Spec:** `docs/superpowers/specs/2026-05-23-knowledge-graph-slim-design.md`

**Worktree:** `/Users/liubin/work/workspace/ai/Understand-Anything/.worktrees/knowledge-graph-slim` on branch `codex/knowledge-graph-slim`

---

## File Structure

| File | Responsibility |
|---|---|
| `understand-anything-plugin/skills/understand/merge-batch-graphs.py` | Add `strip_symbol_graph()` safety net; trim `BUSINESS_SIGNAL_CAPS` |
| `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py` | Unit tests for symbol stripping |
| `understand-anything-plugin/agents/file-analyzer.md` | Phase 2 contract: file-only nodes + file-level edges |
| `understand-anything-plugin/agents/graph-reviewer.md` | Review expectations for file-only graphs |
| `understand-anything-plugin/skills/understand/frameworks/react.md` | Replace component `contains` guidance with `depends_on` |
| `understand-anything-plugin/skills/understand/frameworks/vue.md` | Same |
| `understand-anything-plugin/skills/understand/frameworks/nextjs.md` | Same for layout `contains` |
| `understand-anything-plugin/packages/dashboard/src/store.ts` | Remove class detail level state |
| `understand-anything-plugin/packages/dashboard/src/App.tsx` | Remove detail-level toolbar buttons |
| `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx` | Remove symbol expansion rendering |
| `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx` | Remove `contains` child list |
| `understand-anything-plugin/packages/dashboard/src/components/CodeViewer.tsx` | Remove symbol `lineRange` highlight path |
| `understand-anything-plugin/src/explain-builder.ts` | File-path explain only |
| `understand-anything-plugin/src/diff-analyzer.ts` | Drop `contains` child expansion |
| `understand-anything-plugin/src/__tests__/explain-builder.test.ts` | File-only fixtures |
| `understand-anything-plugin/src/__tests__/diff-analyzer.test.ts` | File-only fixtures |
| `understand-anything-plugin/skills/understand-explain/SKILL.md` | Document file-level only |
| `understand-anything-plugin/skills/understand-diff/SKILL.md` | Document file-level changed nodes |

---

### Task 1: Merge safety net — strip symbol nodes and edges

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py`
- Modify: `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`

- [ ] **Step 1: Write failing test**

Add near the bottom of `test_merge_batch_graphs.py`:

```python
class StripSymbolGraphTests(unittest.TestCase):
    """File-only graph: remove function/class nodes and symbol edges."""

    def test_strips_function_class_nodes_and_symbol_edges(self) -> None:
        nodes = [
            _file_node("src/a.ts"),
            _file_node("src/b.ts"),
            {
                "id": "function:src/a.ts:run",
                "type": "function",
                "name": "run",
                "filePath": "src/a.ts",
                "summary": "Runs",
                "tags": ["core"],
                "complexity": "simple",
            },
            {
                "id": "class:src/b.ts:Worker",
                "type": "class",
                "name": "Worker",
                "filePath": "src/b.ts",
                "summary": "Worker",
                "tags": ["core"],
                "complexity": "moderate",
            },
        ]
        edges = [
            {"source": "file:src/a.ts", "target": "file:src/b.ts", "type": "imports", "direction": "forward", "weight": 0.7},
            {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains", "direction": "forward", "weight": 1.0},
            {"source": "file:src/b.ts", "target": "class:src/b.ts:Worker", "type": "exports", "direction": "forward", "weight": 0.8},
            {"source": "function:src/a.ts:run", "target": "function:src/b.ts:Worker", "type": "calls", "direction": "forward", "weight": 0.8},
        ]

        stripped_nodes, stripped_edges, stats = mbg.strip_symbol_graph(nodes, edges)

        self.assertEqual({n["type"] for n in stripped_nodes}, {"file"})
        self.assertEqual(len(stripped_nodes), 2)
        self.assertEqual(len(stripped_edges), 1)
        self.assertEqual(stripped_edges[0]["type"], "imports")
        self.assertEqual(stats["nodes_removed"], 2)
        self.assertEqual(stats["edges_removed"], 3)

    def test_merge_and_normalize_applies_symbol_strip(self) -> None:
        batches = [{
            "nodes": [
                _file_node("src/a.ts"),
                {
                    "id": "function:src/a.ts:run",
                    "type": "function",
                    "name": "run",
                    "filePath": "src/a.ts",
                    "summary": "Runs",
                    "tags": ["core"],
                    "complexity": "simple",
                },
            ],
            "edges": [
                {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains", "direction": "forward", "weight": 1.0},
            ],
        }]

        assembled, report = mbg.merge_and_normalize(batches)
        types = {n["type"] for n in assembled["nodes"]}
        self.assertEqual(types, {"file"})
        self.assertEqual(assembled["edges"], [])
        joined = "\n".join(report)
        self.assertIn("Symbol slim", joined)
```

- [ ] **Step 2: Run test to verify RED**

```bash
cd understand-anything-plugin/skills/understand
python3 -m unittest test_merge_batch_graphs.StripSymbolGraphTests -v
```

Expected: FAIL — `strip_symbol_graph` attribute missing.

- [ ] **Step 3: Implement `strip_symbol_graph` and wire into merge**

In `merge-batch-graphs.py`, after `BUSINESS_SIGNAL_CAPS` (~line 83), add:

```python
SYMBOL_NODE_TYPES = frozenset({"function", "class"})
SYMBOL_EDGE_TYPES = frozenset({"contains", "exports", "calls", "inherits", "implements"})
```

Change caps line to:

```python
BUSINESS_SIGNAL_CAPS = {"file": 8}
```

Add function (before `merge_and_normalize`):

```python
def strip_symbol_graph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    """Remove function/class nodes and edges that depend on symbol endpoints."""
    symbol_ids = {
        node["id"]
        for node in nodes
        if node.get("type") in SYMBOL_NODE_TYPES and isinstance(node.get("id"), str)
    }
    kept_nodes = [node for node in nodes if node.get("type") not in SYMBOL_NODE_TYPES]
    kept_edges = [
        edge
        for edge in edges
        if edge.get("type") not in SYMBOL_EDGE_TYPES
        and edge.get("source") not in symbol_ids
        and edge.get("target") not in symbol_ids
    ]
    stats = {
        "nodes_removed": len(nodes) - len(kept_nodes),
        "edges_removed": len(edges) - len(kept_edges),
    }
    return kept_nodes, kept_edges, stats
```

Inside `merge_and_normalize`, just before `# ── Build report ──` (~line 913), insert:

```python
    stripped_nodes, stripped_edges, symbol_stats = strip_symbol_graph(
        list(nodes_by_id.values()),
        list(edges_by_key.values()),
    )
    nodes_by_id = {node["id"]: node for node in stripped_nodes}
    edges_by_key = {
        (e["source"], e["target"], e.get("type", ""), e.get("direction", "forward")): e
        for e in stripped_edges
    }
    symbol_strip_lines: list[str] = []
    if symbol_stats["nodes_removed"] or symbol_stats["edges_removed"]:
        symbol_strip_lines.append("Symbol slim:")
        symbol_strip_lines.append(f"  {symbol_stats['nodes_removed']:>4} × function/class nodes removed")
        symbol_strip_lines.append(f"  {symbol_stats['edges_removed']:>4} × symbol edges removed")
```

Append `symbol_strip_lines` to `report` after the business signals section (~line 960).

- [ ] **Step 4: Run tests to verify GREEN**

```bash
cd understand-anything-plugin/skills/understand
python3 -m unittest test_merge_batch_graphs.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/merge-batch-graphs.py \
        understand-anything-plugin/skills/understand/test_merge_batch_graphs.py
git commit -m "feat(understand): strip function/class nodes during graph merge"
```

---

### Task 2: Update `file-analyzer.md` to file-only Phase 2 contract

**Files:**
- Modify: `understand-anything-plugin/agents/file-analyzer.md`

- [ ] **Step 1: Update frontmatter and Task overview**

Change description (~line 4-6) to emphasize file-level graph output for code files.

In Task section (~line 16), add after the two-phase sentence:

```markdown
Code files produce **one file node each** — do not emit `function:` or `class:` nodes. Use Phase 1 structural data only to enrich file summaries, tags, and `businessSignals`.
```

- [ ] **Step 2: Fix Phase 1 Step 3 cross-reference (~line 128)**

Replace:

```markdown
Treat these the same as tree-sitter-derived functions for node creation (Step 2 significance filter still applies — only emit `function:` nodes for those exceeding the threshold).
```

With:

```markdown
Use these extracted names only to enrich **Phase 2 Step 1** file summaries and tags. Do **not** create `function:` or `class:` nodes from them.
```

- [ ] **Step 3: Extend Phase 2 Step 1 with businessSignals**

After the Tags section (~line 220), insert a `#### Business Signals` subsection moved from old Step 2:

- Keep file-level MUST/omit rules and examples
- Remove class/function per-symbol caps
- Add: "Product behavior previously assigned to Activity/ViewModel/UseCase symbols belongs on the **file node** for that source file."

- [ ] **Step 4: Replace Phase 2 Step 2**

Delete the entire `### Step 2 -- **Create Function and Class Nodes**` section (lines ~238-294) and replace with:

```markdown
### Step 2 -- No Function or Class Nodes

Do **not** create `function:` or `class:` nodes. Phase 1 `functions`, `classes`, `exports`, and `metrics` are inputs for Step 1 file node content only.
```

- [ ] **Step 5: Trim Phase 2 Step 3 code-file edge table**

Remove rows: `contains`, `exports`, `calls`, `inherits`, `implements`.

Keep rows: `imports`, `depends_on`, `tested_by`.

Update Edge Signal Quick Reference (~lines 509-514):

| Pattern | Edge |
|---|---|
| React/Vue parent renders child component file | `depends_on` parent file → child file |
| Component/hook calls custom hook file | `depends_on` consumer file → hook file |
| Context provider / consumer | `depends_on` file → file |

- [ ] **Step 6: Clean supporting sections**

- Remove Function/Class rows from Node Types table (~lines 365-366)
- Remove `function:...` node and `contains` edge from Output Format example (~lines 431-456)
- Remove `lineRange` requirement for function/class from Required fields (~line 492)
- Update allowed `type` list in Required fields (~line 484) to exclude `function`, `class`
- Critical Constraints (~lines 525-530): remove class/function from businessSignals pre-write check; delete "MUST create function/class nodes" bullet (~line 530)

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/agents/file-analyzer.md
git commit -m "docs(agents): make file-analyzer output file-only graphs"
```

---

### Task 3: Framework addenda + graph reviewer

**Files:**
- Modify: `understand-anything-plugin/skills/understand/frameworks/react.md`
- Modify: `understand-anything-plugin/skills/understand/frameworks/vue.md`
- Modify: `understand-anything-plugin/skills/understand/frameworks/nextjs.md`
- Modify: `understand-anything-plugin/agents/graph-reviewer.md`

- [ ] **Step 1: Update React framework guidance**

In `react.md`, replace component `contains` edge instructions with:

```markdown
**Component composition** — When a parent component file renders a child component from another project file, create a `depends_on` edge from the parent file to the child file. Do not create component symbol nodes.
```

- [ ] **Step 2: Update Vue framework guidance**

Same pattern in `vue.md` for parent-child component files → `depends_on`.

- [ ] **Step 3: Update Next.js framework guidance**

In `nextjs.md`, replace layout/page `contains` instructions with file-level `depends_on` between layout and page files.

- [ ] **Step 4: Update graph-reviewer expectations**

In `graph-reviewer.md`:

- Change validation focus: code files should have file nodes, not function/class nodes
- Remove examples mentioning "3 function nodes have no edges"
- Update sample inventory JSON to file-only counts (no `function`/`class` keys)
- Add check: flag any `function` or `class` node as **error** (pipeline regression)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/frameworks/react.md \
        understand-anything-plugin/skills/understand/frameworks/vue.md \
        understand-anything-plugin/skills/understand/frameworks/nextjs.md \
        understand-anything-plugin/agents/graph-reviewer.md
git commit -m "docs(agents): align reviewers and frameworks with file-only graphs"
```

---

### Task 4: Simplify dashboard for file-only graphs

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CodeViewer.tsx`

- [ ] **Step 1: Remove detail level from store**

In `store.ts`:

- Delete `DetailLevel` type and `detailLevel` / `setDetailLevel` / `showFunctionsInClassView` / `toggleShowFunctionsInClassView` from state interface and initial state
- Remove any imports/usages of `DetailLevel`

- [ ] **Step 2: Remove toolbar controls from App.tsx**

Delete the detail-level button group (~lines 564-598) that toggles Files/Classes/Fn.

- [ ] **Step 3: Simplify GraphView rendering**

In `GraphView.tsx`:

- Remove `detailLevel` and `showFunctionsInClassView` selectors
- Delete the block that expands `contains` children when `detailLevel !== "file"` (~lines 413-424)
- Keep persona-based filtering if it hides function/class — optional cleanup to delete dead branches for function/class types
- Ensure visible nodes are all graph nodes (file-level graphs have no symbols to filter)

- [ ] **Step 4: Remove symbol children from NodeInfo**

In `NodeInfo.tsx`, delete:

- `childEdges` / `childNodes` resolution (~lines 297-308)
- UI section that renders child symbol list (search for `childNodes.map`)

- [ ] **Step 5: Simplify CodeViewer highlight**

In `CodeViewer.tsx`, remove logic that uses symbol node `lineRange` for highlight; highlight only when explicitly passed a line range from file-level context (or drop highlight-on-symbol-click entirely).

- [ ] **Step 6: Build dashboard**

```bash
corepack pnpm --filter @understand-anything/dashboard build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/store.ts \
        understand-anything-plugin/packages/dashboard/src/App.tsx \
        understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx \
        understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx \
        understand-anything-plugin/packages/dashboard/src/components/CodeViewer.tsx
git commit -m "refactor(dashboard): remove class/function graph detail level"
```

---

### Task 5: Update explain and diff builders + tests

**Files:**
- Modify: `understand-anything-plugin/src/explain-builder.ts`
- Modify: `understand-anything-plugin/src/diff-analyzer.ts`
- Modify: `understand-anything-plugin/src/__tests__/explain-builder.test.ts`
- Modify: `understand-anything-plugin/src/__tests__/diff-analyzer.test.ts`

- [ ] **Step 1: Write failing explain-builder test**

Replace symbol-heavy fixture with file-only graph. Add test:

```typescript
it("resolves file path only (no path:function notation)", () => {
  const graph: KnowledgeGraph = {
    version: "1.0.0",
    project: { name: "demo", description: "", languages: [], frameworks: [] },
    nodes: [
      { id: "file:src/auth.ts", type: "file", name: "auth.ts", filePath: "src/auth.ts", summary: "Auth", tags: ["auth"], complexity: "moderate" },
    ],
    edges: [],
  };

  const byFile = buildExplainContext(graph, "src/auth.ts");
  expect(byFile.targetNode?.id).toBe("file:src/auth.ts");
  expect(byFile.childNodes).toEqual([]);

  const bySymbol = buildExplainContext(graph, "src/auth.ts:login");
  expect(bySymbol.targetNode?.id).toBe("file:src/auth.ts");
  expect(bySymbol.childNodes).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify RED (if behavior differs)**

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/explain-builder.test.ts
```

- [ ] **Step 3: Simplify explain-builder**

In `explain-builder.ts`:

- Update docstring: file paths only
- Remove path:function parsing block (~lines 30-39); resolve by `filePath` or `file:` id only
- Remove `childNodes` contains expansion (~lines 58-66); return `childNodes: []`
- Apply same changes in `buildExplainContextFromGraphs` if it duplicates contains logic (~line 207)

- [ ] **Step 4: Simplify diff-analyzer**

In `diff-analyzer.ts`, delete the contains-child expansion block (~lines 44-49):

```typescript
  // Also include "contains" children of changed file nodes
  for (const edge of edges) {
    if (edge.type === "contains" && changedNodeIds.has(edge.source)) {
      changedNodeIds.add(edge.target);
    }
  }
```

Update `diff-analyzer.test.ts` fixture to file-only; change assertion from expecting `function:src/service.ts:process` to only file node ids.

- [ ] **Step 5: Run skill tests**

```bash
corepack pnpm --filter @understand-anything/skill test -- src/__tests__/explain-builder.test.ts src/__tests__/diff-analyzer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/src/explain-builder.ts \
        understand-anything-plugin/src/diff-analyzer.ts \
        understand-anything-plugin/src/__tests__/explain-builder.test.ts \
        understand-anything-plugin/src/__tests__/diff-analyzer.test.ts
git commit -m "refactor(skill): limit explain and diff context to file nodes"
```

---

### Task 6: Update skill docs

**Files:**
- Modify: `understand-anything-plugin/skills/understand-explain/SKILL.md`
- Modify: `understand-anything-plugin/skills/understand-diff/SKILL.md`

- [ ] **Step 1: Update understand-explain SKILL**

- Description: file-level deep dives only
- Remove `function:path:name` ID convention from docs
- Replace sharded search bullet about function/method names with file path + summary/tags search
- Remove "Internal structure (functions, classes from contains edges)" bullet

- [ ] **Step 2: Update understand-diff SKILL**

Replace bullet (~line 42):

```markdown
   - This finds file nodes for the changed paths (function/class symbol nodes are no longer emitted)
```

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-explain/SKILL.md \
        understand-anything-plugin/skills/understand-diff/SKILL.md
git commit -m "docs(skills): document file-only explain and diff behavior"
```

---

### Task 7: Verification pass

**Files:** (none — commands only)

- [ ] **Step 1: Run merge tests**

```bash
cd understand-anything-plugin/skills/understand && python3 -m unittest test_merge_batch_graphs.py -v
```

- [ ] **Step 2: Run core + skill tests**

```bash
corepack pnpm --filter @understand-anything/core test
corepack pnpm --filter @understand-anything/skill test
```

Note: core build may have pre-existing errors on this branch (`layers`/`tour` optional + duplicate export). Fix only errors introduced by this work; file-only schema tests should pass.

- [ ] **Step 3: Build dashboard**

```bash
corepack pnpm --filter @understand-anything/dashboard build
```

- [ ] **Step 4: Lint**

```bash
corepack pnpm lint
```

Fix any lint issues in touched files.

- [ ] **Step 5: Final commit (if lint fixes needed)**

```bash
git add -A
git commit -m "chore: verification fixes for knowledge-graph slim"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|---|---|
| No function/class nodes in output | Task 1 (safety net), Task 2 (source) |
| Preserve `imports` and file-level edges | Task 1 test, Task 2 Step 5 |
| Phase 1 unchanged | No task (explicit non-change) |
| Sharded + non-sharded same rules | Task 1 applies to all merge paths |
| `businessSignals` file-level only | Task 2 Step 3 |
| graph-reviewer updated | Task 3 |
| Dashboard simplified | Task 4 |
| explain/diff file-only | Task 5, Task 6 |
| Old graphs not migrated | Documented in spec only |
| Tests | Tasks 1, 5, 7 |

## Out of Scope (do not implement in this plan)

- Regenerating `packages/dashboard/public/knowledge-graph.json`
- Phase 2 LLM input trimming (function name lists only)
- Read-time legacy graph symbol stripping
- `product-index-builder` code changes (already works file-first; symbol nodes simply won't exist)
