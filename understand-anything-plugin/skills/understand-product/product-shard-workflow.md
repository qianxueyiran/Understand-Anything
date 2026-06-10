# Product Shard Workflow

This file is a shared workflow fragment, not a skill. Do not invoke it as `/understand-product` and do not dispatch a subagent to execute the whole workflow. The main context reads this file and executes the phases inline.

## Inputs

- `PROJECT_ROOT` — absolute project root.
- `PLUGIN_ROOT` — absolute Understand Anything plugin root.
- `SHARD_ID` — validated shard id matching `^[A-Za-z0-9_-]+$`.
- `PRODUCT_ARGUMENTS` — product CLI arguments including `--shard <id>` and optional platform/tuning flags.
- `BUSINESS_GLOSSARY` — full content of `docs/business-glossary.md` when present; empty string otherwise.

## Outputs

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-index-extractions-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/product-shards/<id>.json
$PROJECT_ROOT/.understand-anything/product-shards/<id>.signals.jsonl
$PROJECT_ROOT/.understand-anything/product-traces/<id>.json
```

## Phase 1: Prepare Boundary Candidates

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --prepare-candidates $PRODUCT_ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/shards/<id>.json
$PROJECT_ROOT/.understand-anything/domain-shards/<id>.json
```

`domain-shards/<id>.json` 可选；缺失时跳过 domain context。

写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
```

阶段完成后必须检查该文件存在；缺失则停止。

## Phase 2: LLM Topic Normalization

派发 `$PLUGIN_ROOT/agents/product-topic-normalizer.md`，并在调度 prompt 中显式传入 `输入路径` 和 `输出路径`。agent 必须以调度 prompt 传入的路径为准。

输入路径：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
```

输出路径：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
```

调度 prompt 必须包含：

```text
输入路径: $PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
输出路径: $PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
必须以调度 prompt 传入的路径为准。

业务词汇表（项目专有词汇，Topic name 和 summary 中的业务术语必须优先使用表中的标准名称）：
$BUSINESS_GLOSSARY
（若为空，忽略此项。）
```

输出必须包含：

```text
{ topics, discardedCandidates, sourceReads, warnings }
```

Topic 必须是产品化主题，不是类名集合。agent 可以 keep、merge、drop candidates，但不能抽取 fact，不能选择 evidenceRefs，不能全项目搜索源码。

阶段完成后必须检查输出文件存在；缺失则停止。

## Phase 3: Build Context Packs

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --build-context-packs $PRODUCT_ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/shards/<id>.json
$PROJECT_ROOT/.understand-anything/domain-shards/<id>.json
```

`domain-shards/<id>.json` 可选；缺失时跳过 domain context。

写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json
```

`product-context-packs.json` 保留完整审查链路；`product-context-packs-by-topic/` 是后续 fact analyzer 的逐 topic 输入。

阶段完成后必须检查总文件和 per-topic 目录存在；缺失则停止。

## Phase 4: LLM Fact + Evidence Extraction

逐个 topic 派发 `$PLUGIN_ROOT/agents/product-index-analyzer.md`。每次只允许 agent 读取一个 per-topic context pack，不能把所有 topics 一次性传给同一个 agent。每次调度都必须显式传入该 topic 的 `输入路径` 和 `输出路径`，agent 必须以调度 prompt 传入的路径为准。

每个 agent 必须读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-index-extractions-by-topic/<topic-file>.json
```

每个 topic 的调度 prompt 必须包含：

```text
输入路径: $PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json
输出路径: $PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-index-extractions-by-topic/<topic-file>.json
必须以调度 prompt 传入的路径为准。

业务词汇表（项目专有词汇，facts[].text 中的业务术语必须优先使用表中的标准名称，确保与产品词汇对齐）：
$BUSINESS_GLOSSARY
（若为空，忽略此项。）
```

单个 topic 输出必须是 JSON 对象：

```text
{ topicId, sourceReads, usedFiles, ignoredFiles, facts, warnings }
```

facts 必须包含 `type/text/conditions/evidenceRefs/confidence`，且 `evidenceRefs` 只能引用当前 per-topic context pack 中已有的 anchorId。不要派发 agent 全项目搜索，不要要求 agent 新增文件或 anchor。

阶段完成后必须检查 `product-index-extractions-by-topic/` 下每个 topic 都有对应 JSON；缺失则停止。

## Phase 5: Finalize Product Index

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --finalize $PRODUCT_ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-index-extractions-by-topic/*.json
```

写入：

```text
$PROJECT_ROOT/.understand-anything/product-shards/<id>.json
$PROJECT_ROOT/.understand-anything/product-traces/<id>.json
```

完成 `--finalize --shard <id>` 后，CLI 会自动刷新 `.understand-anything/product-index.json` manifest，使新生成的 product shard 和 trace 被索引。

`--refresh-shards` 仍可用于重新扫描 `product-shards/`、`product-traces/` 和 `domain-shards/` 文件名，修复或重建 `.understand-anything/product-index.json` manifest。

## 完成输出

输出中文摘要，必须包含：

- topics 数量
- evidence 数量
- facts 数量
- signals 数量
- contextPacks 数量
- warnings 数量和主要类别
- 明确说明使用了 LLM strict pipeline
- 提示现在可以使用 `/understand-chat` 提问产品问题
