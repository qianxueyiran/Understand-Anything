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
- `nodes[]` — each has {id, type, name, filePath, summary, tags[], complexity, languageNotes?, businessSignals?}
  - Primary node types: `file`, `config`, `document`, `service`, `table`, `endpoint`, `pipeline`, `schema`, `resource`
  - IDs: `file:<relative-path>`, `config:<path>`, etc.
  - Code files are **file-level only** — no `function`/`class` symbol nodes in new graphs
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: `imports`, `depends_on`, `tested_by`, plus non-code edges (`configures`, `deploys`, …)
- `layers[]` / `tour[]` — optional; omitted in current pipeline output

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow `imports` and `depends_on` for dependency chains

## Sharded Artifact Handling

If `.understand-anything/knowledge-graph.json` has top-level `kind: "codebase-sharded"`, it is only a lightweight manifest. Do not search it as a complete graph.

For sharded graphs:

1. Read only the manifest metadata and `shards[].path` list.
2. Search with `rg` under `.understand-anything/shards/` by `nodeId`, `filePath`, `"summary"`, `"tags"`, and semantic keywords.
3. Read only matching shard files. If an edge points to a node outside the matching shard, search that raw edge `source` or `target` id with `rg` under `.understand-anything/shards/` and read only the shard that contains the referenced node.
4. Keep edge `source` and `target` values unchanged. They are stable addresses across shards.
5. Read the source file from the node's project-relative `filePath`, not from a path relative to the shard.

## Instructions

1. Check that `.understand-anything/knowledge-graph.json` exists. If not, tell the user to run `/understand` first.

2. **Inspect graph mode** — read the top-level `kind` first. If it is `codebase-sharded`, follow the sharded graph handling rules above and use `.understand-anything/shards/` as the graph search root. Otherwise use `.understand-anything/knowledge-graph.json`.

3. **Search the graph** for the user's query:
   - For `codebase-sharded`, use `rg` under `.understand-anything/shards/` by `nodeId`, `filePath`, `"summary"`, `"tags"`, `"businessSignals"`, and semantic keywords. Read only matching shards.
   - For ordinary graphs, Grep within `knowledge-graph.json` for relevant node names, summaries, tags, and file paths.

4. **Expand context** — for matched nodes, follow 1-hop edges (`imports`, `depends_on`, etc.) to gather neighboring file nodes.

5. **Read source files** when needed — use matched nodes' `filePath` to Read the actual source for detailed answers.

6. **Answer** using graph context plus source evidence:
   - Reference specific files and relationships from the graph
   - Cite summaries and tags from matched nodes
   - Do not invent paths or components not in the graph or source
