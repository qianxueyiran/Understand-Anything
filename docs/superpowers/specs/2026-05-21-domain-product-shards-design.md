# `/understand-domain` 与 `/understand-product` 分片产物设计

## 背景

`/understand --scope ... --shard ...` 已将大型代码库的结构图拆成按用户外部编排维护的 code shards：

```text
.understand-anything/
  knowledge-graph.json
  shards/
    home.json
    player.json
```

分片模式下，根 `knowledge-graph.json` 是轻量入口，不再包含全量 `nodes` / `edges`。当前 `/understand-domain` 和 `/understand-product` 都仍假设可以读取完整 `knowledge-graph.json`，并分别写出单个 `domain-graph.json` 和 `product-index.json`。这会在大型项目里重新制造单文件瓶颈。

本设计扩展 domain/product 流程，使它们基于 code shard 派生自己的分片产物，同时保持非分片项目的旧行为。

## 目标

1. 分片项目中，`/understand-domain` 基于指定 code shard 生成对应 domain shard。
2. 分片项目中，`/understand-product` 基于指定 code shard 和可选 domain shard 生成对应 product shard。
3. root `domain-graph.json` 和 `product-index.json` 在分片模式下都是轻量 manifest。
4. domain/product root manifest 不存储数量统计，也不存储 shard 生命周期统计，尽量只做文件定位。
5. 不引入 `graph-locator.json`、`domain-locator.json`、`product-locator.json`。
6. 不做跨 shard 深度合并；检索依赖稳定 id/path/topic 文本和文件系统搜索。
7. 非分片项目保持现有单文件行为兼容。

## 非目标

1. 不改造 Dashboard。
2. 不实现跨 shard domain 合并算法。
3. 不实现跨 shard product topic merge。
4. 不把所有 domain/product shards 合并回单个大文件。
5. 不在 domain/product root manifest 中写 `nodeCount`、`edgeCount`、`topicCount`、`factCount`、`evidenceCount` 等数量字段。
6. 不让 `/understand-domain` 或 `/understand-product` 默认读取所有 code shards。

## 产物结构

分片项目推荐结构：

```text
.understand-anything/
  knowledge-graph.json
  shards/
    home.json
    player.json

  domain-graph.json
  domain-shards/
    home.json
    player.json

  product-index.json
  product-shards/
    home.json
    player.json
  product-traces/
    home.json
    player.json
```

### Code Shard

`shards/<id>.json` 是 `/understand --scope ... --shard <id>` 生成的结构图 shard。domain/product shard 必须以它为来源。

`--shard <id>` 不负责选择目录，也不重新扫描源码。目录组合仍由外部编排通过 `/understand --scope ... --shard ...` 完成。

### Domain Shard

`domain-shards/<id>.json` 仍使用 `KnowledgeGraph` 形态，包含 `domain` / `flow` / `step` 节点和 domain 边。第一版不要求 domain shard 内必须写额外 metadata；文件名决定 shard id，root manifest 负责声明它来自哪个 code shard。

如果实现时需要在内容文件中保留来源，也只增加可选 `shard` metadata，不新增 `kind: "domain"`，避免破坏现有 `KnowledgeGraph` schema。该 metadata 只是内容文件自己的说明，root manifest 不依赖它。

```json
{
  "shard": {
    "id": "home",
    "sourceCodeShard": "shards/home.json"
  }
}
```

`domain-shards/<id>.json` 是实际内容文件，可以被单独读取、审查和更新。

### Product Shard

`product-shards/<id>.json` 使用现有 product index 数据模型，保存该 code shard 对应的 topics、facts、evidence、signals 等内容。不要为了分片额外新增 root manifest 才需要的统计字段。

来源信息优先复用现有 `sources` 字段，而不是增加独立索引。示例是 `sources` 片段，不代表完整 product index：

```json
{
  "sources": {
    "knowledgeGraph": {
      "path": ".understand-anything/shards/home.json",
      "required": true
    },
    "domainGraph": {
      "path": ".understand-anything/domain-shards/home.json",
      "available": true,
      "required": false
    }
  }
}
```

`product-traces/<id>.json` 保存 strict pipeline 的 trace，避免全局 `product-index-trace.json` 膨胀。

## Root Manifest

### `domain-graph.json`

分片模式下，root `domain-graph.json` 是 manifest，不是完整 domain graph。

```json
{
  "version": "1.0.0",
  "kind": "domain-sharded",
  "source": {
    "codeManifest": "knowledge-graph.json"
  },
  "shards": [
    {
      "id": "home",
      "path": "domain-shards/home.json",
      "sourceCodeShard": "shards/home.json"
    }
  ],
  "warnings": []
}
```

Manifest 不包含数量统计，也不包含 `analyzedAt`、`gitCommitHash` 这类由 shard 生成流程决定的生命周期字段。消费者需要数量或更新时间时，应读取目标 shard 或按文件系统状态按需计算。

### `product-index.json`

分片模式下，root `product-index.json` 是 manifest，不是完整 product index。

```json
{
  "version": "1.0.0",
  "kind": "product-sharded",
  "source": {
    "codeManifest": "knowledge-graph.json",
    "domainManifest": "domain-graph.json"
  },
  "shards": [
    {
      "id": "home",
      "path": "product-shards/home.json",
      "tracePath": "product-traces/home.json",
      "sourceCodeShard": "shards/home.json",
      "sourceDomainShard": "domain-shards/home.json"
    }
  ],
  "warnings": []
}
```

Manifest 不包含 `topicCount`、`factCount`、`evidenceCount`、`signalsCount`、`contextPacksCount`，也不复制 product shard 内部的 `coverage` 或 `quality` 汇总。`sourceDomainShard` 是可选字段；如果生成 product shard 时没有对应 domain shard，就省略该字段，并在 warnings 中记录 domain context skipped。

### Manifest Schema 与 Loader

第一版新增两个轻量 manifest 类型：

```ts
type DomainShardedManifest = {
  version: string;
  kind: "domain-sharded";
  source: { codeManifest: string };
  shards: Array<{ id: string; path: string; sourceCodeShard: string }>;
  warnings: string[];
};

type ProductShardedManifest = {
  version: string;
  kind: "product-sharded";
  source: { codeManifest: string; domainManifest?: string };
  shards: Array<{
    id: string;
    path: string;
    tracePath?: string;
    sourceCodeShard: string;
    sourceDomainShard?: string;
  }>;
  warnings: string[];
};
```

这些类型只用于识别和定位分片，不替代现有 `KnowledgeGraph` / `ProductIndex` 内容模型。

读取策略：

1. 新增或复用一个 raw JSON loader，先读取 `knowledge-graph.json` / `domain-graph.json` / `product-index.json` 的顶层 `kind`。
2. 只有确认不是 sharded manifest 时，才调用现有 `loadGraph()`、`validateGraph()`、`loadProductIndex()`。
3. `loadProductIndex()` 本身保持旧语义：只加载完整 product index。遇到 `kind: "product-sharded"` 时应返回空或抛出清晰错误，由 `/understand-chat` 等消费流程改用 sharded-aware loader。

## 命令语义

### `/understand-domain`

新增参数：

```bash
/understand-domain --shard home
/understand-domain --refresh-shards
```

`--shard <id>` 行为：

1. 检查 `.understand-anything/knowledge-graph.json`。
2. 校验 shard id 复用 `/understand --shard` 的规则：`^[A-Za-z0-9_-]+$`。校验失败直接停止，避免路径穿越和大小写规则不一致。
3. 先以 raw JSON 读取 root 文件并检查顶层 `kind`，不要先走现有 `loadGraph()`。
4. 如果 root code graph 是普通 `KnowledgeGraph`，报告 “当前项目不是 sharded code graph” 并停止。
5. 如果 root code graph 是 `kind: "codebase-sharded"`：
   - 要求 `.understand-anything/shards/<id>.json` 存在。
   - 读取该 code shard 作为 domain analyzer 输入。
   - 不读取所有 code shards。
   - 中间产物写入 `.understand-anything/intermediate/domain-shards/<id>/domain-analysis.json`；如果未来 `--full` shard scan 需要 `domain-context.json`，也写入同一目录。
   - 写入 `.understand-anything/domain-shards/<id>.json`。
   - 刷新 root `.understand-anything/domain-graph.json` manifest。
   - 不自动启动 Dashboard，只输出 shard 路径和 manifest 刷新结果。

`--refresh-shards` 行为：

1. 扫描 `.understand-anything/domain-shards/*.json` 文件名。
2. 重写 root `domain-graph.json` manifest。
3. 不运行 LLM。
4. 不读取每个 shard 的完整节点和边做统计，也不依赖 shard 内部 metadata。

无参数行为：

1. 如果 `.understand-anything/knowledge-graph.json` 是普通完整 graph，保持现有 `/understand-domain` 行为。
2. 如果它是 `kind: "codebase-sharded"`，提示用户使用 `--shard <id>` 或 `--refresh-shards`，不默认加载所有 shards。

### `/understand-product`

新增参数：

```bash
/understand-product --shard home
/understand-product --refresh-shards
```

`--shard <id>` 行为：

1. 检查 `.understand-anything/knowledge-graph.json`。
2. 校验 shard id 复用 `/understand --shard` 的规则：`^[A-Za-z0-9_-]+$`。
3. 先以 raw JSON 读取 root 文件并检查顶层 `kind`，不要先走现有 `loadGraph()`。
4. 如果 root code graph 是普通完整 graph，报告 “当前项目不是 sharded code graph” 并停止。
5. 如果 root code graph 是 `kind: "codebase-sharded"`：
   - 要求 `.understand-anything/shards/<id>.json` 存在。
   - 可选读取 `.understand-anything/domain-shards/<id>.json`；不存在不阻塞。
   - strict pipeline 的 prepare candidates、topic normalization、context packs、fact extraction、finalize 都只围绕该 shard 运行。
   - 写入 `.understand-anything/product-shards/<id>.json`。
   - 写入 `.understand-anything/product-traces/<id>.json`。
   - 刷新 root `.understand-anything/product-index.json` manifest。
   - 输出刚生成 shard 的 topics/facts/evidence 等摘要，但不把这些数量写入 root manifest。

`--refresh-shards` 行为：

1. 扫描 `.understand-anything/product-shards/*.json` 和可选 `.understand-anything/product-traces/*.json` 文件名。
2. 重写 root `product-index.json` manifest。
3. 不运行 LLM。
4. 不读取每个 product shard 的 topics/facts/evidence 做统计，也不依赖 shard 内部 metadata。

无参数行为：

1. 如果 `.understand-anything/knowledge-graph.json` 是普通完整 graph，保持当前 strict pipeline。
2. 如果它是 `kind: "codebase-sharded"`，提示用户使用 `--shard <id>` 或 `--refresh-shards`，不默认加载所有 shards。

## Product Strict Pipeline 的分片适配

当前 `/understand-product` CLI 读取固定文件：

```text
.understand-anything/knowledge-graph.json
.understand-anything/domain-graph.json
```

分片模式需要增加 shard 输入参数，语义上等价于：

```text
codeGraphPath = .understand-anything/shards/<id>.json
domainGraphPath = .understand-anything/domain-shards/<id>.json，如果存在
outputProductIndexPath = .understand-anything/product-shards/<id>.json
outputTracePath = .understand-anything/product-traces/<id>.json
intermediateDir = .understand-anything/intermediate/product-shards/<id>
```

中间产物也应按 shard 隔离：

```text
.understand-anything/intermediate/product-shards/<id>/
  product-boundary-candidates.json
  product-topic-normalization.json
  product-context-packs.json
  product-context-packs-by-topic/
  product-index-extractions-by-topic/
  product-index-extractions.json
```

这样外部脚本可以并发或循环执行不同 shard，避免中间产物互相覆盖。

## 检索策略

第一版不引入 locator。推荐检索方式：

```bash
rg "播放|Player|topic:playback" .understand-anything/product-shards
rg "flow|播放" .understand-anything/domain-shards
rg "file:a_home/..." .understand-anything/shards
```

Agent 消费流程可以先读 root manifest 得到 shard 文件列表，再用 `rg` 或定向读取具体 shard。

跨 shard 引用保持地址化：

1. domain/product evidence 继续保留 `nodeId`、`filePath`。
2. 如果 evidence 指向其他 code shard，消费者可以在 `.understand-anything/shards/*.json` 中搜索该 node id。
3. 不需要提前维护全局边索引。

## 错误处理

1. `--shard <id>` 但 code root 不是 sharded manifest：停止并提示当前项目不是分片模式。
2. `--shard <id>` 但 `shards/<id>.json` 不存在：停止并提示先运行 `/understand --scope ... --shard <id>`。
3. `/understand-product --shard <id>` 缺少 `domain-shards/<id>.json`：不阻塞，只跳过 domain context。
4. `--refresh-shards` 发现 product shard 缺少对应 trace 文件：不阻塞，把文件名加入 warnings。
5. root manifest 缺少数量字段是预期行为，消费者不得依赖数量字段判断成功。
6. shard id 不符合 `^[A-Za-z0-9_-]+$`：停止并提示只允许字母、数字、下划线和短横线。

## 测试策略

### Domain

1. 普通完整 graph：无参数 `/understand-domain` 仍走旧流程。
2. sharded code graph：无参数提示必须使用 `--shard` 或 `--refresh-shards`。
3. `--shard home` 只读取 `shards/home.json`，写入 `domain-shards/home.json`。
4. `--shard home` 的中间产物写入 `intermediate/domain-shards/home/`。
5. `--refresh-shards` 只根据文件名生成 root `domain-graph.json` manifest，不统计节点和边数量。

### Product

1. 普通完整 graph：无参数 `/understand-product` 仍走旧 strict pipeline。
2. sharded code graph：无参数提示必须使用 `--shard` 或 `--refresh-shards`。
3. `--shard home` 只读取 `shards/home.json` 和可选 `domain-shards/home.json`。
4. `--shard home` 的中间产物写入 `intermediate/product-shards/home/`。
5. finalize 写入 `product-shards/home.json` 和 `product-traces/home.json`。
6. `--refresh-shards` 只根据文件名生成 root `product-index.json` manifest，不统计 topics/facts/evidence 数量。
7. 缺少 `domain-shards/home.json` 时，root product manifest 不写 `sourceDomainShard`。

## 实施顺序

1. 新增 domain shard manifest 刷新脚本和测试。
2. 修改 `/understand-domain` skill，支持 `--shard` 和 `--refresh-shards`。
3. 修改 product CLI，使 strict pipeline 支持 shard 输入、输出和隔离 intermediate 目录。
4. 新增 product shard manifest 刷新脚本和测试。
5. 修改 `/understand-product` skill，支持 `--shard` 和 `--refresh-shards`。
6. 新增 sharded manifest schema/loader，保证消费流程能区分完整 index 和 sharded manifest。
7. 更新 `/understand-chat` 后续消费设计，让它在 product/domain root manifest 是 sharded 时用 `rg` 搜索 shard 文件。

## 验收标准

1. 分片 code graph 下，`/understand-domain --shard home` 不读取所有 code shards。
2. 分片 code graph 下，`/understand-product --shard home` 不读取所有 code shards。
3. `domain-graph.json` 和 `product-index.json` 在分片模式下都是 manifest。
4. domain/product root manifest 不包含数量统计字段，也不复制 shard 生命周期字段。
5. 非分片项目旧行为保持兼容。
6. `--refresh-shards` 不运行 LLM，不做内容统计，只刷新 shard 列表和路径。
7. domain/product shard id 校验规则与 `/understand --scope --shard` 一致。
