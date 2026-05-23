# Knowledge Graph Slim Design

**Date:** 2026-05-23  
**Status:** Draft  
**Branch:** `codex/knowledge-graph-slim`  
**Goal:** Stop emitting `function` and `class` nodes in knowledge-graph output (sharded and non-sharded) to reduce file size and downstream token consumption.

---

## Context

The `/understand` pipeline currently produces symbol-level nodes for significant functions and classes via `file-analyzer` Phase 2 Step 2. On the plugin's own analyzed graph (97 nodes), 63 of 97 nodes are symbols (57 function + 6 class), and most symbol-related edges (`contains`, `exports`, `calls`) exist only because those nodes exist.

File-level dependency is already captured separately:

| Edge type | Current endpoints | After slim |
|---|---|---|
| `imports` | file → file | unchanged |
| `depends_on` | file → file | unchanged |
| `contains` | file → function/class | removed |
| `exports` | file → function/class | removed |
| `calls` | symbol → symbol | removed |
| `inherits` / `implements` | class → class | removed |

The dashboard already defaults to `detailLevel="file"`. Architecture analysis already uses file-level `imports`. Symbol nodes mainly add graph bulk and Phase 2 batch JSON output size without being the primary dependency backbone.

---

## Decisions (locked)

| Question | Decision |
|---|---|
| Default behavior | **Permanent file-only** — no `--with-symbols` flag |
| Symbol edges | **Drop all** — keep file nodes and file-level edges only |
| `businessSignals` | **File-level only** (and existing non-code sub-nodes like `endpoint`, `service`) |
| Old graphs | **Write-time enforcement only** — no read-time compat, no slim script; re-run `/understand --full` or `--update-diff` when needed |
| Structural extraction | **Keep Phase 1 unchanged** — `extract-structure.mjs` still runs for summaries and incremental fingerprints |

---

## Goals

1. New `knowledge-graph.json` and shard files contain no `function` or `class` nodes.
2. Preserve file-level structural edges, especially `imports`.
3. Apply the same rules in full build, non-sharded incremental, and sharded incremental modes.
4. Reduce Phase 2 batch JSON output size (fewer nodes, fewer symbol summaries/tags/signals).
5. Reduce persisted graph size (~65% fewer nodes on the plugin sample graph).

## Non-Goals

1. Do not add a `symbols: [{name, kind, lineRange}]` index on file nodes.
2. Do not migrate or slim existing graphs in place.
3. Do not add read-time symbol stripping in dashboard or skills.
4. Do not remove non-code sub-nodes (`service:`, `endpoint:`, `table:`, etc.).
5. Do not change `extract-structure.mjs` output or incremental fingerprint logic.
6. Do not trim Phase 1 structural payload to the LLM in this iteration (optional follow-up).

---

## Recommended Approach

**Source stop + merge safety net** (Approach 1 from brainstorming):

1. Change `file-analyzer.md` so Phase 2 no longer creates symbol nodes or symbol edges.
2. Add a deterministic filter in `merge-batch-graphs.py` to strip any symbol nodes/edges that slip through.
3. Update reviewer agents and downstream consumers to match file-only expectations.

Do **not** rely on merge-only stripping — that would waste Phase 2 LLM tokens.

---

## Graph Schema (write-time)

### Nodes emitted by `file-analyzer`

| Keep | Remove |
|---|---|
| `file`, `config`, `document`, `service`, `table`, `endpoint`, `pipeline`, `schema`, `resource` | `function`, `class` |

`function` and `class` remain valid in core `NodeType` for schema compatibility when reading legacy graphs, but new pipeline output must not contain them.

### Edges emitted by `file-analyzer`

**Code files — keep:**

- `imports` (file → file, 1:1 from `batchImportData`)
- `depends_on` (file → file)
- `tested_by` (production file → test file)

**Code files — remove:**

- `contains`, `exports`, `calls`, `inherits`, `implements`

**Non-code files — keep all existing edge types:**

- `configures`, `documents`, `deploys`, `migrates`, `triggers`, `defines_schema`, `serves`, `provisions`, `routes`, `related`, `depends_on`

### `businessSignals`

- Emit on file-level nodes and non-code sub-nodes (`endpoint`, `service`, etc.).
- Do not emit on `function` or `class` nodes (they will not exist).
- Product semantics previously assigned to symbols should be reflected in the owning file node's `summary` and/or `businessSignals`.

---

## Pipeline

```text
Phase 1 (unchanged)
  extract-structure.mjs → functions/classes/callGraph for summaries + fingerprints

Phase 2 (changed)
  file-analyzer → file-only nodes + file-level edges

merge-batch-graphs.py (changed)
  merge batches → strip symbol nodes/edges (safety net)

knowledge-graph.json / shards/<id>.json
  file-only graph
```

Sharded incremental (`sharded-update-workflow.mjs`) needs no schema change: `pruneGraphForChangedFiles` already removes all nodes by `filePath`; re-analyzed batches will no longer reintroduce symbols.

---

## `file-analyzer.md` Changes

The agent has two phases. Only **Phase 2** changes substantively.

### Phase 1 — Structural Extraction (no change)

| Step | Action |
|---|---|
| Step 1 | Prepare input JSON |
| Step 2 | Execute `extract-structure.mjs` |
| Step 3 | Read extraction results |

**Minor text fix:** Line ~128 currently references "Step 2 significance filter" for unsupported languages. Change to: use extracted function names only to enrich **Phase 2 Step 1** file summaries — do not create symbol nodes.

### Phase 2 — Semantic Analysis

#### Step 1 — Create File Node (keep, extend)

- Unchanged: create one node per file using `fileCategory` → type mapping.
- Unchanged: non-code sub-nodes (`service:`, `endpoint:`, etc.) still created when script populates those arrays.
- **Add:** When writing `summary`, `tags`, and `businessSignals`, use script `functions`, `classes`, `exports`, and `metrics` as context.
- **Add:** Product-facing signals that would have lived on Activity/ViewModel/UseCase symbols should appear on the file node instead.

#### Step 2 — Create Function and Class Nodes (delete entire section)

Replace with a short prohibition:

> Do not create `function:` or `class:` nodes. Structural data from Phase 1 is input for Step 1 file node content only.

Remove from this section:

- Significance filter rules
- Symbol node creation instructions
- Symbol-level `businessSignals` rules (function ≤1, class ≤3)

Move file-level `businessSignals` guidance into Step 1 (or a shared subsection referenced by Step 1).

#### Step 3 — Create Edges (trim symbol edges)

**Code file edge table — delete rows:**

- `contains`, `exports`, `calls`, `inherits`, `implements`

**Code file edge table — keep rows:**

- `imports`, `depends_on`, `tested_by`

**Non-code edge table:** unchanged.

**Import 1:1 rule (lines ~331–343):** unchanged.

**Edge Signal Quick Reference — update:**

| Old pattern | New pattern |
|---|---|
| React parent `contains` child | `depends_on` file → file, or describe in file summary |
| Context provider `exports` context | `depends_on` file → file |
| All `imports` / `deploys` / etc. | unchanged |

### Other sections in `file-analyzer.md`

| Section | Change |
|---|---|
| Frontmatter `description` | Remove emphasis on producing function/class graph nodes |
| `Task` overview | State output is file-only for code files |
| `Node Types and ID Conventions` | Remove Function and Class rows |
| `Output Format` example | Remove `function:...` node and `contains` edge |
| Required fields | Remove `lineRange` requirement for function/class |
| `Critical Constraints` | Remove "MUST create function/class nodes" rule; update businessSignals pre-write check to file/endpoint/service only |

---

## `merge-batch-graphs.py` Safety Net

After merge/dedupe, before write:

```python
SYMBOL_NODE_TYPES = {"function", "class"}
SYMBOL_EDGE_TYPES = {"contains", "exports", "calls", "inherits", "implements"}

nodes = [n for n in nodes if n.get("type") not in SYMBOL_NODE_TYPES]
symbol_ids = {n["id"] for n in original_nodes if n.get("type") in SYMBOL_NODE_TYPES}
edges = [
    e for e in edges
    if e.get("type") not in SYMBOL_EDGE_TYPES
    and e.get("source") not in symbol_ids
    and e.get("target") not in symbol_ids
]
```

Log stripped counts in merge summary for observability.

Also remove or zero out `businessSignals` caps keyed on `function`/`class` in merge normalization if present.

---

## Reviewer Agents

| Agent | Change |
|---|---|
| `graph-reviewer.md` | Stop requiring/checking function/class nodes; validate file-only structural graph |
| `assemble-reviewer.md` | No change (already focuses on file-level `imports` recovery) |

---

## Downstream Consumers

| Component | Change |
|---|---|
| **Dashboard `GraphView`** | Remove `detailLevel="class"` and `showFunctionsInClassView`; render file-level nodes only |
| **Dashboard `NodeInfo`** | Remove symbol children expansion via `contains` edges |
| **Dashboard `CodeViewer`** | Open on file node click only; remove symbol `lineRange` highlight path |
| **Dashboard `store.ts`** | Remove `DetailLevel = "class"` and related state |
| **`/understand-explain`** | Document file-level only; drop `path:functionName` resolution |
| **`/understand-diff`** | Limit diff context to file nodes |
| **`/understand-chat`** | No code change required (search naturally excludes symbols) |
| **`/understand-onboard`** | No change (already file-only) |
| **`product-index-builder`** | Aggregate `businessSignals` from file-level nodes only |

Legacy graphs with symbols are unsupported without re-generation (per decision B).

---

## Expected Impact

Plugin sample graph (`packages/dashboard/public/knowledge-graph.json`):

| Metric | Before | After (est.) |
|---|---|---|
| Nodes | 97 | ~34 |
| `contains` edges | 63 | 0 |
| `exports` edges | 46 | 0 |
| `calls` edges | 19 | 0 |
| `imports` edges | 45 | 45 |

500-file project (from token-reduction spec): ~1,500 nodes → ~500 nodes.

Phase 2 savings: batch JSON no longer includes symbol nodes with summaries, tags, and businessSignals.

---

## Testing

1. **`merge-batch-graphs.py`:** Feed batch JSON containing symbol nodes → output has zero function/class nodes and zero symbol edges.
2. **Core schema tests:** File-only graph passes validation; document that legacy symbol graphs are out of scope for new writes.
3. **Sharded incremental:** Changed file re-analysis produces file-only shard; `commit` succeeds.
4. **Dashboard:** Graph renders without class detail toggle; NodeInfo shows no symbol children.
5. **Regression:** `imports` edge count still matches `batchImportData` sum after slim.

---

## Implementation Order

1. `merge-batch-graphs.py` safety net + unit test
2. `file-analyzer.md` Phase 2 edits (Step 2 delete, Step 3 trim, supporting sections)
3. `graph-reviewer.md`
4. Dashboard simplification
5. Skill source updates (`explain`, `diff`) and `product-index-builder` if needed
6. Regenerate plugin sample `knowledge-graph.json` (optional, for dashboard demo)

---

## Open Follow-Ups (out of scope)

- **Phase 2 input trimming:** Send function/class name lists + counts to LLM instead of full structural arrays to save input tokens.
- **Sample graph regeneration:** Update committed demo graph after implementation lands.
