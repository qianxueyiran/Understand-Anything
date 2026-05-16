---
name: understand-chat
description: Use when you need to ask questions about a codebase or understand code using a knowledge graph
argument-hint: [query]
---

# /understand-chat

Answer questions about this codebase using the knowledge graph at `.understand-anything/knowledge-graph.json`.

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

## Instructions

0. **优先检查产品知识** — 检查当前项目根目录是否存在 `.understand-anything/product-knowledge.json`。
   - 如果存在，且用户问题涉及产品含义、页面元素、标签、展示规则、状态含义、业务含义、数据字段，或“为什么/怎么展示”，先检索产品知识。
   - 检索范围包括：`productAreas[].name`、`productAreas[].summary`、`concepts[].name`、`concepts[].meaning`、`concepts[].userFacingTerms`、`concepts[].businessRules`、`concepts[].displayRules`、`concepts[].dataFields`。
   - 命中后，使用 product evidence 中的 `filePath`、`nodeId`、`symbol`、`lineRange` 从 `.understand-anything/knowledge-graph.json` 拉取匹配代码上下文。
   - 如果 `.understand-anything/domain-graph.json` 存在，使用 matching `domainRefs`，或用产品区域、概念名称匹配业务域内容，补充业务流背景。
   - 如果 product knowledge 没有命中，继续下面现有的 knowledge graph retrieval path。

1. Check that `.understand-anything/knowledge-graph.json` exists in the current project root. If not, tell the user to run `/understand` first.

2. **Read project metadata only** — use Grep or Read with a line limit to extract just the `"project"` section from the top of the file for context (name, description, languages, frameworks).

3. **Search for relevant nodes** — use Grep to search the knowledge graph file for the user's query keywords: "$ARGUMENTS"
   - Search `"name"` fields: `grep -i "query_keyword"` in the graph file
   - Search `"summary"` fields for semantic matches
   - Search `"tags"` arrays for topic matches
   - Note the `id` values of all matching nodes

4. **Find connected edges** — for each matched node ID, Grep for that ID in the `edges` section to find:
   - What it imports or depends on (downstream)
   - What calls or imports it (upstream)
   - This gives you the 1-hop subgraph around the query

5. **Read layer context** — Grep for `"layers"` to understand which architectural layers the matched nodes belong to.

6. **Answer the query** using only the relevant subgraph:
   - Reference specific files, functions, and relationships from the graph
   - Explain which layer(s) are relevant and why
   - Be concise but thorough — link concepts to actual code locations
   - If the query doesn't match any nodes, say so and suggest related terms from the graph
   - 产品问题按顺序回答：产品含义、用户可见标签或术语、展示规则和条件、数据字段或 enum/source 映射、代码证据、证据弱时的不确定性
