---
name: understand-chat
description: Use when you need to ask questions about a codebase or understand code using a knowledge graph
argument-hint: [query]
---

# /understand-chat

Answer questions about this codebase using the artifacts under `.understand-anything/`.

## Graph Structure Reference

The knowledge graph JSON has this structure:
- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath, summary, tags[], complexity, languageNotes?}
  - Node types: file, function, class, module, concept
  - IDs: `file:path`, `function:path:name`, `class:path:name`
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — each has {order, title, description, nodeIds[]}

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

## Sharded Artifact Handling

Some artifacts are lightweight manifests that point to shard files. If the top-level `kind` indicates a sharded artifact, do not treat the manifest as the complete dataset.

- `.understand-anything/product-index.json`
  - If top-level `kind` is `product-sharded`, read only the manifest metadata and `shards[].path` list.
  - Search user-question keywords with `rg` under `.understand-anything/product-shards/`.
  - Read only shards that match the relevant product topic, fact, entry, UI label, business rule, backend capability, or evidence keyword.
  - If `kind` is not `product-sharded`, use the legacy complete product index flow.
- `.understand-anything/domain-graph.json`
  - If top-level `kind` is `domain-sharded`, do not read it as a full domain graph.
  - Search domain, topic, flow, capability, actor, or business-term keywords with `rg` under `.understand-anything/domain-shards/`.
  - Read only matching domain shards before answering or before linking back to code evidence.
  - If `kind` is not `domain-sharded`, use the legacy complete domain graph flow when relevant.
- `.understand-anything/knowledge-graph.json`
  - If top-level `kind` is `codebase-sharded`, do not read it as a full graph.
  - Search with `rg` under `.understand-anything/shards/` by `nodeId`, `filePath`, class name, function/method name, concept name, tag, and summary keywords.
  - Edge `source` and `target` values keep their original addresses. For cross-shard reverse lookup, search those raw `source` / `target` node IDs with `rg` under `.understand-anything/shards/`.
  - **Cross-scope import edges:** In the shard you are reading, find outbound `imports` edges with `"external": true` (source is in-shard; target is `file:<path>` with no target node). Use `rg` on that `file:` path under `.understand-anything/shards/` to locate the owning shard, then read that shard for the file node and its 1-hop edges. Do not treat external targets as errors or missing nodes.
  - Read only the shard files needed for the matched nodes and their 1-hop edges.
  - If `kind` is not `codebase-sharded`, use the legacy complete knowledge graph flow below.

## Instructions

1. Check that `.understand-anything/knowledge-graph.json` exists in the current project root. If not, tell the user to run `/understand` first.

2. **Read project metadata only** — first inspect the top-level `kind` and project metadata. If `.understand-anything/knowledge-graph.json` is `codebase-sharded`, read only the manifest metadata and shard list; do not read it as the full graph. Otherwise, use Grep or Read with a line limit to extract just the `"project"` section from the top of the file for context (name, description, languages, frameworks).

3. **Search for relevant nodes** — use Grep to search the knowledge graph file for the user's query keywords: "$ARGUMENTS"
   - For `codebase-sharded`, use `rg` under `.understand-anything/shards/` by `nodeId`, `filePath`, class name, method/function name, `"name"`, `"summary"`, `"tags"`, `"businessSignals"`,and semantic keywords. Read only matching shards.
   - For a complete graph, search `"name"` fields: `grep -i "query_keyword"` in the graph file
   - For a complete graph, search `"summary"` fields for semantic matches
   - For a complete graph, search `"tags"` arrays for topic matches
   - For a complete graph, search `"businessSignals"` arrays for business matches
   - Note the `id` values of all matching nodes

4. **Find connected edges** — for each matched node ID, Grep for that ID in the `edges` section to find:
   - What it imports or depends on (downstream)
   - What calls or imports it (upstream)
   - This gives you the 1-hop subgraph around the query
   - For `codebase-sharded`, keep edge `source` / `target` values as raw node IDs and use `rg` under `.understand-anything/shards/` for cross-shard reverse lookup
   - For outbound `external: true` `imports` edges, follow the target `file:` path into other shards as above instead of stopping at the path string

5. **Read layer context** — Grep for `"layers"` to understand which architectural layers the matched nodes belong to. For `codebase-sharded`, search layer IDs, layer names, or matched node IDs under `.understand-anything/shards/` instead of reading the full graph.

6. **Answer the query** using only the relevant subgraph:
   - Reference specific files, functions, and relationships from the graph
   - Explain which layer(s) are relevant and why
   - Be concise but thorough — link concepts to actual code locations
   - If the query doesn't match any nodes, say so and suggest related terms from the graph
