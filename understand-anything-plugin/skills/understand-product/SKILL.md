---
name: understand-product
description: 基于 code shard 生成严格 grounded 的 product shard，用于回答客户端产品问题。
argument-hint: [--shard <id>] [--platform android] [--entry-patterns <patterns>] [--refresh-shards]
---

# /understand-product

`/understand-product` 的正式流程是 shard-only。它读取 `.understand-anything/shards/<id>.json`，生成 `.understand-anything/product-shards/<id>.json` 和 `.understand-anything/product-traces/<id>.json`，并刷新 `.understand-anything/product-index.json` manifest。

正式流程必须严格经过 LLM Topic Normalization 和 LLM Fact + Evidence Extraction。不要使用 `--fast`，不要运行不带阶段参数的 CLI，也不要用确定性 fallback 生成 product shard。

## Supported Commands

- `/understand-product --shard <id> [--platform android]`
- `/understand-product --refresh-shards`

支持的参数会透传给内部 CLI 阶段：

- `--platform <name>`，默认 `android`
- `--entry-patterns <comma-separated patterns>`
- `--max-depth <positive integer>`
- `--max-nodes-per-topic <positive integer>`
- `--max-frontier-per-depth <positive integer>`
- `--max-evidence-per-topic <positive integer>`
- `--hub-degree-threshold <positive integer>`
- `--shard <id>`
- `--refresh-shards`

## Phase 0: 准备路径

1. 将 `PROJECT_ROOT` 设为当前工作目录。
2. 检查 `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` 存在，并且顶层 `kind` 是 `codebase-sharded`。
3. 设置`PLUGIN_ROOT` 为 `$PROJECT_ROOT/.understand-anything-plugin`
4. 如果传入 `--refresh-shards`，直接运行：

   ```bash
   node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --refresh-shards
   ```

   运行完成后停止，并用中文说明已刷新 product shard manifest。

5. 如果传入 `--shard <id>`：
   - 校验 `<id>` 匹配 `^[A-Za-z0-9_-]+$`。
   - 检查 `$PROJECT_ROOT/.understand-anything/shards/<id>.json` 存在。
   - 如果 `$PROJECT_ROOT/.understand-anything/domain-shards/<id>.json` 存在，将其作为可选 domain context；缺失不阻塞。

6. **加载业务词汇表：**
   - 检查 `$PROJECT_ROOT/docs/business-glossary.md` 是否存在。若存在，读取全文，存为 `$BUSINESS_GLOSSARY`。否则设为空字符串。

## Product Shard Generation

For `/understand-product --shard <id>`, read and execute **`skills/understand-product/product-shard-workflow.md`** in the main context after Phase 0 sets:

- `PROJECT_ROOT`
- `PLUGIN_ROOT`
- `SHARD_ID`
- `PRODUCT_ARGUMENTS=$ARGUMENTS`
- `BUSINESS_GLOSSARY`

`skills/understand-product/product-shard-workflow.md` owns Prepare Boundary Candidates, LLM Topic Normalization using `product-topic-normalizer.md`, Build Context Packs, LLM Fact + Evidence Extraction using `product-index-analyzer.md`, Finalize Product Index, strict path passing, and completion reporting. Keep those phase details in the shared workflow file instead of duplicating them here.
