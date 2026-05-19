---
name: understand-product
description: 基于已有 /understand 知识图谱生成产品知识索引，用于回答客户端产品问题。
argument-hint: [--platform android] [--fast] [--entry-patterns <patterns>]
---

# /understand-product

生成 `.understand-anything/product-index.json` 产品知识索引。当前项目必须已经运行 `/understand`，并且存在 `.understand-anything/knowledge-graph.json`。

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
- `--fast`，跳过 LLM 抽取，只使用确定性 fallback
- `--entry-patterns <comma-separated patterns>`
- `--max-depth <positive integer>`
- `--max-nodes-per-topic <positive integer>`
- `--max-frontier-per-depth <positive integer>`
- `--max-evidence-per-topic <positive integer>`
- `--hub-degree-threshold <positive integer>`

## Phase 1: Prepare Topic Context Packs

如果用户没有传 `--fast`，先运行 prepare：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --prepare $ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/knowledge-graph.json
$PROJECT_ROOT/.understand-anything/domain-graph.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs.json
$PROJECT_ROOT/.understand-anything/product-signals.jsonl
```

`product-context-packs.json` 是后续 LLM agent 唯一可用于抽取产品事实的上下文。

## Phase 2: LLM 事实抽取

如果用户没有传 `--fast`，派发 `$PLUGIN_ROOT/agents/product-index-analyzer.md`。

agent 必须读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-index-extractions.json
```

输出必须是 JSON 数组，每个元素为：

```text
{ topicId, usedFiles, ignoredFiles, facts }
```

facts 必须包含 `type/text/conditions/evidenceRefs/confidence`，且 `evidenceRefs` 只能引用 context packs 中已有的 anchorId。不要派发 agent 全项目搜索，不要要求 agent 新增文件或 anchor。

## Phase 3: Finalize Product Index

如果用户没有传 `--fast`，在 agent 写出 extractions 后运行 finalize：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --finalize $ARGUMENTS
```

该命令读取：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-index-extractions.json
```

并写入：

```text
$PROJECT_ROOT/.understand-anything/product-index.json
$PROJECT_ROOT/.understand-anything/product-index-trace.json
```

trace 至少包含 contextPacks、extractions 和 warnings，便于排查 agent 输出被丢弃的原因。

## Fast 模式

如果用户传 `--fast`，跳过 Phase 1-3 的 LLM 编排，直接运行确定性 fallback：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --fast $ARGUMENTS
```

也可以运行不带 `--prepare/--finalize` 的 CLI；该路径会 prepare context packs，基于第一个可用 anchor 生成 inferred fact，然后 finalize 并保存 `product-index.json`。

## 完成输出

输出中文摘要，必须包含：

- topics 数量
- evidence 数量
- facts 数量
- signals 数量
- contextPacks 数量
- 是否使用 LLM
- 提示现在可以使用 `/understand-chat` 提问产品问题
