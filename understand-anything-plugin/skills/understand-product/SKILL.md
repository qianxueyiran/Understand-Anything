---
name: understand-product
description: 基于已有 /understand 知识图谱生成产品知识索引，用于回答客户端产品问题。
argument-hint: [--platform android] [--fast] [--full] [--topic <name>]
---

# /understand-product

生成 `.understand-anything/product-index.json` 产品知识索引。第一版要求当前项目已经运行 `/understand`，并且存在 `.understand-anything/knowledge-graph.json`。

## Phase 0: 准备路径

将 `PROJECT_ROOT` 设为当前工作目录。先检查：

```bash
if [ ! -f "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" ]; then
  echo "Error: .understand-anything/knowledge-graph.json not found. 请先运行 /understand。"
  exit 1
fi
```

解析 `PLUGIN_ROOT` 时沿用 `/understand-domain` 的插件根目录解析策略：优先使用运行时注入变量，然后尝试各平台常见安装路径。

## Phase 1: 确定性生成产品索引草稿

运行：

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --platform android --fast
```

该命令生成：

```text
$PROJECT_ROOT/.understand-anything/product-index.json
$PROJECT_ROOT/.understand-anything/product-signals.jsonl
```

`--fast` 表示只执行确定性索引阶段，不派发 LLM 增强 agent。确定性阶段会读取 `knowledge-graph.json`，可选读取 `domain-graph.json`，再基于入口、UI、规则、数据、集成等信号生成 topic、evidence 和 signals sidecar。

## Phase 2: 可选 LLM 归纳

如果用户没有传 `--fast`，读取 `$PLUGIN_ROOT/agents/product-index-analyzer.md` 并派发 subagent。subagent 只能基于已有 `product-index.json` 和 `product-signals.jsonl` 做 topic 命名、去重和高置信 fact 归纳，不允许重新全项目找证据。

subagent 将增强结果写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-index-enhanced.json
```

增强结果通过 CLI 或 core validator 校验成功后，覆盖 `.understand-anything/product-index.json`。

## Phase 3: 完成输出

输出中文摘要，包含：

- topics 数量
- evidence 数量
- facts 数量
- signals 数量
- 是否使用 LLM 增强
- 提示现在可以使用 `/understand-chat` 提问产品问题
