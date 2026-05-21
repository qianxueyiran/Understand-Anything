---
name: understand-product
description: 基于已有 /understand 知识图谱生成严格 grounded 的产品知识索引，用于回答客户端产品问题。
argument-hint: [--platform android] [--entry-patterns <patterns>] [--shard <id>] [--refresh-shards]
---

# /understand-product

生成 `.understand-anything/product-index.json` 产品知识索引。当前项目必须已经运行 `/understand`，并且存在 `.understand-anything/knowledge-graph.json`。

正式流程必须严格经过 LLM Topic Normalization 和 LLM Fact + Evidence Extraction。不要使用 `--fast`，不要运行不带阶段参数的 CLI，也不要用确定性 fallback 生成正式 `product-index.json`。

## Phase 0: 准备路径

将 `PROJECT_ROOT` 设为当前工作目录。先检查：

```bash
if [ ! -f "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" ]; then
  echo "Error: .understand-anything/knowledge-graph.json not found. 请先运行 /understand。"
  exit 1
fi
```

解析 `PLUGIN_ROOT` 时沿用 `/understand-domain` 的插件根目录解析策略：优先使用运行时注入变量，然后尝试各平台常见安装路径。

支持的参数会透传给 CLI：

- `--platform <name>`，默认 `android`
- `--entry-patterns <comma-separated patterns>`
- `--max-depth <positive integer>`
- `--max-nodes-per-topic <positive integer>`
- `--max-frontier-per-depth <positive integer>`
- `--max-evidence-per-topic <positive integer>`
- `--hub-degree-threshold <positive integer>`
- `--shard <id>`，只处理 `.understand-anything/shards/<id>.json` 对应分片
- `--refresh-shards`，只刷新 `.understand-anything/product-index.json` manifest

## Phase 0.5: 分片模式

当传入 `--shard <id>` 时，只基于 `$PROJECT_ROOT/.understand-anything/shards/<id>.json` 生成一个 product shard，不默认加载所有 shards。`<id>` 必须匹配 `^[A-Za-z0-9_-]+$`；不匹配时停止并提示用户传入合法 shard id。

当传入 `--refresh-shards` 时，只刷新 `$PROJECT_ROOT/.understand-anything/product-index.json` manifest，不运行 LLM，不执行 Phase 1-5。直接运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --refresh-shards
```

运行完成后停止，并用中文说明已刷新 product shard manifest。

如果项目存在 `.understand-anything/shards/`，但用户未传 `--shard <id>` 或 `--refresh-shards`，必须提示用户使用 `--shard <id>` 生成单个 product shard，或使用 `--refresh-shards` 刷新 manifest；不要默认加载所有 shards。

分片模式仍按 Phase 1-5 执行，并且每个 CLI 阶段命令必须继续透传 `$ARGUMENTS`，使 `--shard <id>` 能传入 CLI。分片模式阶段文件路径为：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-index-extractions-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/product-shards/<id>.json
$PROJECT_ROOT/.understand-anything/product-traces/<id>.json
```

如果 `$PROJECT_ROOT/.understand-anything/domain-shards/<id>.json` 缺失，product shard 生成不阻塞，只跳过 domain context；不要因此停止分片流程。

## Phase 1: Prepare Boundary Candidates

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --prepare-candidates $ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/knowledge-graph.json
$PROJECT_ROOT/.understand-anything/domain-graph.json
```

分片模式改为读取 `.understand-anything/shards/<id>.json`；如果存在 `.understand-anything/domain-shards/<id>.json` 则读取并加入 domain context，缺失时跳过 domain context。

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-boundary-candidates.json
```

阶段完成后必须检查文件存在。缺失则停止。

## Phase 2: LLM Topic Normalization

派发 `$PLUGIN_ROOT/agents/product-topic-normalizer.md`。

agent 必须读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-boundary-candidates.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-topic-normalization.json
```

输出必须包含：

```text
{ topics, discardedCandidates, sourceReads, warnings }
```

Topic 必须是产品化主题，不是类名集合。agent 可以 keep、merge、drop candidates，但不能抽取 fact，不能选择 evidenceRefs，不能全项目搜索源码。

阶段完成后必须检查 `product-topic-normalization.json` 存在。缺失则停止。

## Phase 3: Build Context Packs

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --build-context-packs $ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/knowledge-graph.json
$PROJECT_ROOT/.understand-anything/domain-graph.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs-by-topic/<topic-file>.json
```

`product-context-packs.json` 保留完整审查链路；`product-context-packs-by-topic/` 是后续 fact analyzer 的逐 topic 输入。阶段完成后必须检查总文件和 per-topic 目录存在。缺失则停止。

## Phase 4: LLM Fact + Evidence Extraction

逐个 topic 派发 `$PLUGIN_ROOT/agents/product-index-analyzer.md`。每次只允许 agent 读取一个 per-topic context pack，不能把所有 topics 一次性传给同一个 agent。

每个 agent 必须读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs-by-topic/<topic-file>.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-index-extractions-by-topic/<topic-file>.json
```

单个 topic 输出必须是 JSON 对象：

```text
{ topicId, sourceReads, usedFiles, ignoredFiles, facts, warnings }
```

facts 必须包含 `type/text/conditions/evidenceRefs/confidence`，且 `evidenceRefs` 只能引用当前 per-topic context pack 中已有的 anchorId。不要派发 agent 全项目搜索，不要要求 agent 新增文件或 anchor。

阶段完成后必须检查 `product-index-extractions-by-topic/` 下每个 topic 都有对应 JSON。缺失则停止。

## Phase 5: Finalize Product Index

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --finalize $ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-index-extractions-by-topic/*.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-index-extractions.json
$PROJECT_ROOT/.understand-anything/product-index.json
$PROJECT_ROOT/.understand-anything/product-index-trace.json
```

`product-index-trace.json` 必须保留 boundary candidates、topic normalization、context packs、extractions、discarded candidates、ignored files、overflow files 和 warnings。

完成 `--finalize --shard <id>` 后，必须运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --refresh-shards
```

用 `--refresh-shards` 刷新 `.understand-anything/product-index.json` manifest，使新生成的 `$PROJECT_ROOT/.understand-anything/product-shards/<id>.json` 被索引。

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
