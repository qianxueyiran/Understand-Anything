# `/understand --scope` 分片分析设计

## 背景

当前 `/understand` 已经在分析阶段按 batch 拆分文件，但最终仍会把所有 batch 合并为单个 `.understand-anything/knowledge-graph.json`。在大型代码库，尤其是 Android 多模块项目中，单个图谱文件会过大，导致后续读取、检索、传递给 Agent 和增量更新都变慢。

本次设计只优化 `/understand` 流程。第一阶段不考虑 Dashboard，不引入目录配置文件，不在项目内做循环编排。外部脚本或上层 Agent 可以多次调用 `/understand --scope ... --shard ...` 来生成多个分片。

## 目标

1. 保持不带 `--scope` 的现有 `/understand` 行为完全兼容。
2. 新增 `--scope` 和 `--shard` 参数，用于生成或更新单个分片图谱。
3. 一个 shard 可以包含一个或多个 scope，例如 `a_home,a_home_api` 一起分析并保存为同一个分片。
4. 分片图谱仍使用现有 `KnowledgeGraph` 结构，降低 schema 和消费端改造成本。
5. 分片内 edge 可以指向当前 shard 之外的 node id，跨 shard 引用不因本 shard 缺少目标节点而被删除。
6. 根 `knowledge-graph.json` 在分片模式下变为轻量入口文件，只记录项目概览和 shard 列表，不合并所有节点和边。

## 非目标

1. 不在本项目内实现目录配置文件或自动循环分析。
2. 不实现 `graph-locator.json`。
3. 不实现 `joints/` 或跨分片联合分析产物。
4. 不把所有 shard 重新合并回巨型 `knowledge-graph.json`。
5. 不改造 Dashboard。
6. 不在第一阶段改造 `/understand-domain`、`/understand-product`、`/understand-chat`、`/understand-explain` 的完整分片消费能力，只为后续消费保留稳定产物约定。

## 命令语义

### 旧完整模式

以下命令保持现有行为：

```bash
/understand
/understand --full
/understand /path/to/project
```

行为：

1. `PROJECT_ROOT` 为当前目录或显式传入目录。
2. 扫描整个 `PROJECT_ROOT`。
3. 分 batch 分析。
4. 合并为完整 `KnowledgeGraph`。
5. 写入 `.understand-anything/knowledge-graph.json`。
6. 写入 `.understand-anything/meta.json` 和 `.understand-anything/fingerprints.json`。
7. 现有消费者继续按单文件图谱读取。

### 分片模式

新增命令：

```bash
/understand --scope a_home,a_home_api --shard home
/understand --scope a_player --shard player
```

规则：

1. `--scope` 必须和 `--shard` 一起使用。
2. `--scope` 是逗号分隔的相对路径列表，也可以后续支持重复传参。
3. scope 必须位于 `PROJECT_ROOT` 内。
4. 多个 scope 合并成同一个分析范围，不生成多个分片。
5. `--shard` 是稳定分片 id，只允许字母、数字、短横线和下划线，校验规则为 `^[A-Za-z0-9_-]+$`。
6. node id 和 `filePath` 始终使用相对 `PROJECT_ROOT` 的路径，不能使用相对 scope 的路径。

示例：

```text
PROJECT_ROOT=/repo
--scope a_home,a_home_api --shard home
```

生成的节点仍应是：

```json
{
  "id": "file:a_home/src/main/java/HomeViewModel.kt",
  "filePath": "a_home/src/main/java/HomeViewModel.kt"
}
```

不能变成：

```json
{
  "id": "file:src/main/java/HomeViewModel.kt",
  "filePath": "src/main/java/HomeViewModel.kt"
}
```

## 产物结构

分片模式下产物为：

```text
.understand-anything/
  knowledge-graph.json
  shards/
    home.json
    player.json
    account.json
  meta.json
  fingerprints.json
```

### `shards/<id>.json`

每个 shard 文件是完整 `KnowledgeGraph`：

```json
{
  "version": "1.0.0",
  "kind": "codebase",
  "project": {
    "name": "KiwifruitApp",
    "languages": ["kotlin", "java"],
    "frameworks": ["Android"],
    "description": "home shard",
    "analyzedAt": "2026-05-20T00:00:00.000Z",
    "gitCommitHash": "abc123"
  },
  "nodes": [],
  "edges": [],
  "layers": [],
  "tour": []
}
```

附加约定：

1. `nodes` 只要求包含本 shard scope 内分析得到的节点。
2. `edges` 可以包含指向外部 node id 的边。
3. shard 文件可以独立被读取、解释和更新。
4. 后续消费者如果需要解析外部 node id，可以在 `.understand-anything/shards/*.json` 中按 node id 搜索。

### 根 `knowledge-graph.json`

分片模式下，根文件是轻量入口：

```json
{
  "version": "1.0.0",
  "kind": "codebase-sharded",
  "project": {
    "name": "KiwifruitApp",
    "languages": ["kotlin", "java"],
    "frameworks": ["Android"],
    "description": "Sharded knowledge graph for KiwifruitApp",
    "analyzedAt": "2026-05-20T00:00:00.000Z",
    "gitCommitHash": "abc123"
  },
  "shards": [
    {
      "id": "home",
      "path": "shards/home.json",
      "scopes": ["a_home", "a_home_api"],
      "nodeCount": 1200,
      "edgeCount": 2400,
      "updatedAt": "2026-05-20T00:00:00.000Z",
      "gitCommitHash": "abc123"
    }
  ],
  "overview": {
    "summary": "Project split into user-managed analysis shards.",
    "nodeCount": 1200,
    "edgeCount": 2400,
    "shardCount": 1
  }
}
```

根文件不再包含全量 `nodes` 和 `edges`。这意味着它不是标准 `KnowledgeGraph`，需要新增轻量 schema 或类型，例如 `ShardedKnowledgeGraphManifest`。

## 跨 shard 引用

第一阶段不维护全局跨 shard 索引。跨 shard 关系直接通过现有 edge 表达。

示例：

```json
{
  "source": "file:a_home/src/main/java/com/example/home/HomeViewModel.kt",
  "target": "file:a_player/src/main/java/com/example/player/PlayerService.kt",
  "type": "imports",
  "direction": "forward",
  "weight": 0.7
}
```

如果该 edge 存在于 `shards/home.json`，但 `target` 不存在于 `home.json.nodes`，它仍然是有效信息，表示 home 分片引用了外部分片中的地址。

因此分片模式的校验规则必须区别于完整模式：

1. 完整模式：edge 的 source 和 target 都必须在同一个图的 nodes 中，否则视为 dangling edge。
2. 分片模式：source 应优先存在于当前 shard；target 可以不存在。target 不存在时标记为 external reference，但不删除。
3. 如果 source 也不存在于当前 shard，可以作为 warning 保留，避免误删 LLM 识别出的外部回调或反向依赖。

## `/understand` 流程改造

### 参数解析

新增参数：

```text
--scope <path[,path...]>
--shard <id>
```

校验：

1. 有 `--scope` 但无 `--shard`，报错并停止。
2. 有 `--shard` 但无 `--scope`，报错并停止。
3. scope 路径不存在，报错并停止。
4. scope 路径不在 `PROJECT_ROOT` 内，报错并停止。
5. shard id 不合法，报错并停止。

### 扫描阶段

完整模式扫描整个项目。

分片模式只扫描 scope 内文件：

```text
scan roots = [PROJECT_ROOT/a_home, PROJECT_ROOT/a_home_api]
```

但 import resolution 和 node id 生成仍以 `PROJECT_ROOT` 为根。这样外部引用地址可以和其他 shard 对齐。

### 分析阶段

batch 构建只使用 scope 文件。多个 scope 的文件可以进入同一个 batch 集合。

原有 batch 策略继续使用：

1. 每批 20 到 30 个文件。
2. 非代码文件尽量按相关性分组。
3. up to 5 个 file-analyzer 并发。

### 合并阶段

`merge-batch-graphs.py` 增加 shard mode。

建议参数：

```bash
python merge-batch-graphs.py <project-root> --mode shard
```

或者：

```bash
python merge-batch-graphs.py <project-root> --allow-external-edges
```

差异：

1. 完整模式继续删除 dangling edges。
2. shard mode 不删除 target 不存在的 edge。
3. shard mode 的报告应统计 external edges 数量。
4. shard mode 仍应规范化 node id、复杂度、edge 类型和 direction。

### 架构层与 tour

第一阶段仍为单 shard 生成 `layers` 和 `tour`，但只描述当前 shard 的内容。

约定：

1. `layers[*].nodeIds` 只能引用当前 shard 内存在的节点。
2. `tour[*].nodeIds` 只能引用当前 shard 内存在的节点。
3. edge 可以引用外部节点，但 layer 和 tour 不引用外部节点。

这样每个 shard 可以独立解释，不依赖全局图。

### 保存阶段

完整模式：

```text
.understand-anything/knowledge-graph.json
```

分片模式：

```text
.understand-anything/shards/<shard-id>.json
```

然后刷新根 `knowledge-graph.json`：

1. 读取已有根 manifest，如果不存在则创建。
2. 扫描 `.understand-anything/shards/*.json`。
3. 汇总每个 shard 的 id、path、scopes、nodeCount、edgeCount、updatedAt、gitCommitHash。
4. 汇总项目 languages、frameworks、nodeCount、edgeCount、shardCount。
5. 写回轻量入口 `knowledge-graph.json`。

## 增量更新

### 完整模式

继续使用现有 `meta.json` 和 `fingerprints.json` 逻辑。

### 分片模式

第一阶段建议简化为：外部编排按 shard 触发重建。

例如：

```bash
/understand --scope a_home,a_home_api --shard home --full
```

这会完整重建 `shards/home.json`，然后刷新根 manifest。

后续可以增强为 shard 级增量：

```json
{
  "shards": {
    "home": {
      "scopes": ["a_home", "a_home_api"],
      "gitCommitHash": "abc123",
      "fingerprintKeys": ["a_home/...", "a_home_api/..."]
    }
  }
}
```

但第一阶段不要求实现自动判断哪个 shard 需要更新。这样可以避免在本项目内重新实现外部编排器。

## 错误处理

1. scope 为空：报错。
2. scope 全部被 `.understandignore` 过滤：报错，不写 shard。
3. shard 分析部分失败：保存 partial shard，并在 shard project description 或 root manifest warnings 中记录。
4. root manifest 刷新失败：保留已写入的 shard 文件，向用户报告需要重新运行同一命令或后续新增 `--refresh-shards`。
5. shard id 冲突：同 id 表示覆盖更新该 shard，这是预期行为。

## 测试策略

### 单元测试

1. 参数解析：
   - 无 scope 时走完整模式。
   - 有 scope 无 shard 报错。
   - 有 shard 无 scope 报错。
   - 多 scope 正确解析。
2. node id 路径：
   - scope 内文件生成项目根相对路径。
3. merge shard mode：
   - target 不在 nodes 中的 edge 被保留。
   - 完整模式 dangling edge 仍按旧规则处理。
4. root manifest 刷新：
   - 多个 `shards/*.json` 正确汇总。
   - 覆盖已有 shard 后统计更新。

### 集成测试

构造小型 fixture：

```text
fixture/
  a_home/Home.kt
  a_home_api/HomeApi.kt
  a_player/Player.kt
```

运行：

```bash
/understand --scope a_home,a_home_api --shard home
/understand --scope a_player --shard player
```

验证：

1. 生成 `shards/home.json` 和 `shards/player.json`。
2. `home.json` 内节点路径包含 `a_home/` 和 `a_home_api/`。
3. root `knowledge-graph.json` 为 `kind: codebase-sharded`。
4. root manifest 中有两个 shard 条目。
5. shard 内外部 import edge 不被删除。

## 实施顺序

1. 在 `/understand` skill 文档中新增 `--scope`、`--shard` 参数说明和流程分支。
2. 修改扫描阶段提示，支持 scope roots，但保持 project-root 相对路径。
3. 修改 batch merge 脚本，新增保留 external edge 的 shard mode。
4. 新增 root manifest 生成脚本，例如 `refresh-sharded-manifest.py` 或 Node 脚本。
5. 修改保存阶段，区分完整模式和 shard 模式。
6. 增加测试覆盖 merge shard mode 和 manifest 汇总。
7. 更新 README 或 AGENTS 中的使用示例。

## 验收标准

1. 不带 `--scope` 的 `/understand` 输出与现有行为兼容。
2. `/understand --scope a_home,a_home_api --shard home` 会生成 `.understand-anything/shards/home.json`。
3. shard 内 node id 和 filePath 均保持项目根相对路径。
4. shard mode 下，edge target 不在当前 shard nodes 时不会被删除。
5. 分片模式根 `knowledge-graph.json` 不包含全量 nodes/edges，只包含 manifest 和 overview。
6. 外部脚本可以通过多次调用 `/understand --scope ... --shard ...` 维护多个分片。
7. 第一阶段不依赖 Dashboard，不需要 `graph-locator.json`。
