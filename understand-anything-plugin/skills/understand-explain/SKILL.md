---
name: understand-explain
description: Use when you need a file-level deep dive on a specific source file in the codebase
argument-hint: [file-path]
---

# /understand-explain

Provide a thorough, in-depth explanation of a specific file (file-level deep dives only).

## Graph Structure Reference

The knowledge graph JSON has this structure:
- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath, summary, tags[], complexity, languageNotes?}
  - Node types: file, module, concept
  - IDs: `file:path`
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — each has {order, title, description, nodeIds[]}

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

## Sharded Graph Handling

If `.understand-anything/knowledge-graph.json` has top-level `kind: "codebase-sharded"`, it is only a lightweight manifest. Do not search it as a complete graph.

For sharded graphs:

1. Read only the manifest metadata and `shards[].path` list.
2. Search the target `"$ARGUMENTS"` with `rg` under `.understand-anything/shards/` by `filePath`, node id, `"summary"`, and tags.
3. Read only matching shard files. If an edge points to a node outside the matching shard, search that raw edge `source` or `target` id with `rg` under `.understand-anything/shards/` and read only the shard that contains the referenced node.
4. Keep edge `source` and `target` values unchanged. They are stable addresses across shards.
5. Read the source file from the node's project-relative `filePath`, not from a path relative to the shard.

## Instructions

1. Check that `.understand-anything/knowledge-graph.json` exists. If not, tell the user to run `/understand` first.

2. **Inspect graph mode** — read the top-level `kind` first. If it is `codebase-sharded`, follow the sharded graph handling rules above and use `.understand-anything/shards/` as the graph search root. Otherwise use `.understand-anything/knowledge-graph.json`.

3. **Find the target file node** — use Grep to search the selected graph file(s) for the file: "$ARGUMENTS"
   - Search for matching `"filePath"` values (e.g., `src/auth/login.ts`)
   - If the path is ambiguous, narrow matches using `"summary"` and `"tags"`
   - Note the exact node `id`, `type`, `summary`, `tags`, and `complexity`

4. **Find all connected edges** — Grep for the target node's ID in the edges section:
   - `"source"` matches → things this node calls/imports/depends on (outgoing)
   - `"target"` matches → things that call/import/depend on this node (incoming)
   - In sharded mode, search the raw connected node IDs under `.understand-anything/shards/` when they are not present in the current shard.
   - Note the connected node IDs and edge types

5. **Read connected nodes** — for each connected node ID from step 4, Grep for those IDs in the nodes section to get their `name`, `summary`, and `type`. This builds the component's neighborhood.

6. **Identify the layer** — Grep for the target node's ID in the `"layers"` section to find which architectural layer it belongs to and that layer's description.

7. **Read the actual source file** — Read the source file at the node's `filePath` for the deep-dive analysis.

8. **Explain the file in context**:
   - Its role in the architecture (which layer, why it exists)
   - External connections (what it imports, what calls it, what it depends on — from edges)
   - Data flow (inputs → processing → outputs — from source code)
   - Explain clearly, assuming the reader may not know the programming language
   - Highlight any patterns, idioms, or complexity worth understanding
