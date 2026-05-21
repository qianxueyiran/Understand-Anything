# Sharded Diff / Incremental 更新设计

## 背景

`/understand --scope ... --shard ...` 已经把大型项目的 code graph 拆成多个独立 code shards，并用根 `.understand-anything/knowledge-graph.json` 作为轻量 `codebase-sharded` manifest。`/understand-domain --shard <id>` 和 `/understand-product --shard <id>` 也已经可以从对应 code shard 派生 domain/product shard。

当前缺口是增量更新仍只适用于非分片的单文件 `knowledge-graph.json`。分片模式下 `/understand --scope --shard` 每次都是 scoped full analysis；domain/product 也只能手动按 shard 重跑。本设计让分片项目具备 diff/incremental 能力，同时保持实现第一阶段可控。

## 目标

1. `/understand` 在 sharded project 中支持基于 git diff 找出受影响 code shards。
2. `/understand` 对受影响 code shard 做文件级 incremental patch：只重分析 shard 内发生结构变化的代码文件，并合并回旧 shard。
3. `/understand-domain` 和 `/understand-product` 不做内部 diff；它们跟随内容发生变化的 code shard 重建同名 domain/product shard。
4. 保持非分片项目现有 incremental update 行为不变。
5. 不把所有 shards 合并回巨型图谱。
6. 自动更新路径能同时刷新 code/domain/product 的 root manifest。
7. 更新状态持久化独立于轻量 manifest，避免破坏现有 manifest 的定位职责。

## 非目标

1. 不实现 product topic 级 diff。
2. 不实现 domain flow/step 局部 patch。
3. 不实现跨 shard 依赖反向索引或 `graph-locator.json`。
4. 不让 `/understand-domain` 或 `/understand-product` 默认扫描所有 shards。
5. 不改造 Dashboard。
6. 不要求所有项目必须启用 auto-update；手动命令也应可运行。

## 设计选择

第一版采用 **code shard 内文件级增量 + downstream shard 重建**：

```text
git diff -> changed files -> affected code shards
         -> fingerprint classify changed code files per shard
         -> re-analyze structural files only
         -> patch old code shard
         -> rebuild matching domain/product shards when code shard artifact changed
         -> refresh manifests and update state
```

这样让 `/understand` 的分片模式接近非分片 incremental path：变更检测以 git diff 和 fingerprint 为入口，LLM 只处理结构变化的代码文件；旧 shard 中未变化文件的 nodes/edges 直接保留。domain/product 仍按 shard 重建，避免第一版就处理 domain flow 局部 patch 或 product topic 级 diff。

## 状态文件

新增 `.understand-anything/update-state.json`，用于记录分片增量更新状态。root manifest 继续只负责定位和轻量概览。

```json
{
  "version": "1.0.0",
  "mode": "sharded",
  "gitCommitHash": "abc123",
  "updatedAt": "2026-05-21T00:00:00.000Z",
  "codeShards": {
    "home": {
      "path": "shards/home.json",
      "scopes": ["a_home", "a_home_api"],
      "sourceFingerprintPath": "fingerprints/shards/home.json",
      "artifactHash": "sha256:...",
      "gitCommitHash": "abc123",
      "updatedAt": "2026-05-21T00:00:00.000Z"
    }
  },
  "domainShards": {
    "home": {
      "path": "domain-shards/home.json",
      "sourceCodeShard": "shards/home.json",
      "sourceCodeArtifactHash": "sha256:...",
      "artifactHash": "sha256:...",
      "updatedAt": "2026-05-21T00:00:00.000Z"
    }
  },
  "productShards": {
    "home": {
      "path": "product-shards/home.json",
      "tracePath": "product-traces/home.json",
      "sourceCodeShard": "shards/home.json",
      "sourceDomainShard": "domain-shards/home.json",
      "sourceCodeArtifactHash": "sha256:...",
      "sourceDomainArtifactHash": "sha256:...",
      "artifactHash": "sha256:...",
      "updatedAt": "2026-05-21T00:00:00.000Z"
    }
  },
  "warnings": []
}
```

约定：

1. `gitCommitHash` 是上一次成功完成 sharded update 的 commit。
2. `codeShards[*].scopes` 来自 code manifest 或 shard 顶层 `shard.scopes`。
3. `artifactHash` 是目标 shard 文件内容的 SHA-256，用于判断 downstream 是否需要重建。
4. `sourceFingerprintPath` 指向该 code shard 的独立 fingerprint store。sharded incremental 第一版必须生成并维护它。
5. 该文件可以由手动命令和 hook-triggered auto-update 共用。

### Shard Fingerprints

每个 code shard 保存独立 fingerprint：

```text
.understand-anything/
  fingerprints/
    shards/
      home.json
      player.json
```

每个 shard fingerprint store 只包含该 shard scope 内的已分析代码文件。格式复用现有 core fingerprint store，额外允许记录 `shardId` 和 `scopes`：

```json
{
  "version": "1.0.0",
  "shardId": "home",
  "scopes": ["a_home", "a_home_api"],
  "gitCommitHash": "abc123",
  "files": {
    "a_home/src/Home.kt": {
      "contentHash": "sha256:...",
      "structuralHash": "sha256:...",
      "functions": [],
      "classes": [],
      "imports": [],
      "exports": []
    }
  }
}
```

非分片项目继续使用 `.understand-anything/fingerprints.json`。

## `/understand` 命令语义

新增或扩展参数：

```bash
/understand --update-shards
/understand --update-shards --with-domain
/understand --update-shards --with-product
/understand --update-shards --with-domain --with-product
```

规则：

1. `--update-shards` 只适用于 root `knowledge-graph.json` 顶层 `kind` 为 `codebase-sharded` 的项目。
2. 非分片项目继续走现有 `/understand` incremental path。
3. `--with-domain` 表示受影响 code shard 更新后，重建同名 domain shard。
4. `--with-product` 表示受影响 code shard 更新后，重建同名 product shard；如果同时有 `--with-domain`，product 使用刚重建的 domain shard。
5. 如果既不传 `--with-domain` 也不传 `--with-product`，只更新 code shards。

## 受影响 shard 识别

### 输入

1. 当前 git commit：`git rev-parse HEAD`
2. 上次成功更新 commit：优先读取 `update-state.json.gitCommitHash`
3. 变更文件：`git diff <lastCommitHash>..HEAD --name-only`
4. code manifest：`.understand-anything/knowledge-graph.json`
5. code shards：`.understand-anything/shards/*.json`

### 映射策略

按以下顺序把 changed files 映射到 code shards：

1. 如果文件路径位于某个 manifest shard 的 `scopes[]` 下，命中该 shard。
2. 如果 scope 信息缺失，读取 shard 的 `nodes[*].filePath`，精确匹配 changed file。
3. 对删除文件，若当前文件不存在，仍用旧 shard `nodes[*].filePath` 匹配。
4. 如果一个 changed file 命中多个 shards，所有命中的 shards 都受影响。
5. 如果 changed file 未命中任何 shard：
   - 非源码文件默认记录 warning，不触发重建。
   - 源码文件记录为 `unmappedChangedFiles`，提示需要新增 shard 或重新运行 `/understand --scope ... --shard ...`。

### 输出

生成临时文件：

```text
.understand-anything/intermediate/sharded-update-plan.json
```

```json
{
  "baseCommitHash": "abc123",
  "headCommitHash": "def456",
  "changedFiles": ["a_home/src/Home.kt"],
  "affectedCodeShards": [
    {
      "id": "home",
      "path": "shards/home.json",
      "scopes": ["a_home", "a_home_api"],
      "changedFiles": ["a_home/src/Home.kt"],
      "structuralFiles": ["a_home/src/Home.kt"],
      "cosmeticFiles": [],
      "deletedFiles": [],
      "reason": "changed file matched shard scope"
    }
  ],
  "unmappedChangedFiles": [],
  "warnings": []
}
```

## Code Shard 更新流程

对每个 `affectedCodeShards[]`：

1. 读取旧 `.understand-anything/shards/<id>.json`。
2. 读取该 shard 的 `.understand-anything/fingerprints/shards/<id>.json`。
3. 对 `changedFiles` 运行 fingerprint comparison：
   - `NONE` / `COSMETIC`：不重分析。
   - `STRUCTURAL`：加入 `structuralFiles`。
   - 新文件：如果在 shard scope 内，加入 `structuralFiles`。
   - 删除文件：加入 `deletedFiles`。
4. 如果 `structuralFiles` 和 `deletedFiles` 都为空：
   - 不改写 shard。
   - 更新该 shard fingerprint 中的 content hash。
   - 不触发 domain/product 重建。
5. 如果存在结构变化：
   - 只把 `structuralFiles` 分 batch 派发给 `file-analyzer`。
   - agent prompt 必须说明这是 shard incremental update，只能为本批文件创建 nodes/edges，不能重写未变化文件。
   - `batchImportData` 仍由 project-scanner 或旧 scan/importMap 提供；node id 和 filePath 继续相对 `PROJECT_ROOT`。
6. 构造 `batch-existing.json`：
   - 从旧 shard 删除 `filePath` 属于 `structuralFiles` 或 `deletedFiles` 的旧 nodes。
   - 删除 source/target 指向被删除 nodes 的旧 edges。
   - 保留其他 nodes/edges，包括 external edges。
7. 将 `batch-existing.json` 与新 `batch-*.json` 一起交给 merge script：
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py "$PROJECT_ROOT" --allow-external-edges
   ```
8. 基于 patched shard 的完整 node/edge 集合，重跑 architecture/tour。
   - 这是为了保持 layer/tour 和非分片 incremental path 一样，在文件结构变化后重新收敛。
   - reviewer 可继续使用 deterministic validation；`--review` 时可按现有逻辑运行 graph-reviewer。
9. 写回 `.understand-anything/shards/<id>.json`，保留并更新顶层 `shard` metadata。
10. 刷新 sharded manifest：
   ```bash
   python <SKILL_DIR>/refresh-sharded-manifest.py "$PROJECT_ROOT"
   ```
11. 更新该 shard fingerprint store。
12. 计算新 shard artifact hash，写入 `update-state.json.codeShards[id]`。

这条路径复用非分片 incremental 的核心合并模型，但 merge 必须使用 `--allow-external-edges`，否则跨 shard external edge 会被当成 dangling edge 删除。

## Domain Shard 跟随更新

当启用 `--with-domain` 时，对每个 **artifact hash 发生变化** 的 code shard 执行：

```bash
/understand-domain --shard <id>
```

行为：

1. 只读取 `.understand-anything/shards/<id>.json`。
2. 写入 `.understand-anything/domain-shards/<id>.json`。
3. 刷新 `.understand-anything/domain-graph.json` manifest。
4. 计算 domain shard artifact hash。
5. 更新 `update-state.json.domainShards[id]`。

如果 code shard 没有结构变化或 patch 后 artifact hash 未变化，不运行对应 domain shard。

如果 code shard 更新失败，不运行对应 domain shard。

如果旧 domain shard 存在但 code shard 删除或无法定位，保留旧文件并在 manifest/state warnings 中标记 stale；第一版不自动删除。

## Product Shard 跟随更新

当启用 `--with-product` 时，对每个 **artifact hash 发生变化** 的 code shard 执行：

```bash
/understand-product --shard <id>
```

行为：

1. 只读取 `.understand-anything/shards/<id>.json`。
2. 如果 `.understand-anything/domain-shards/<id>.json` 存在，则作为 domain context；不存在则跳过。
3. 重新执行 strict pipeline 的 prepare candidates、topic normalization、context packs、fact extraction、finalize。
4. 写入 `.understand-anything/product-shards/<id>.json`。
5. 写入 `.understand-anything/product-traces/<id>.json`。
6. 刷新 `.understand-anything/product-index.json` manifest。
7. 计算 product shard 和 trace artifact hash。
8. 更新 `update-state.json.productShards[id]`。

第一版不做 topic 级 diff。这样新增 topic、删除 topic、topic merge/split 都由完整 shard strict pipeline 重新判断，保证语义结果一致。

如果 code shard 只有 cosmetic 变化，product shard 不重建。

## Auto-Update Hook

现有 hook prompt 读取 `meta.json` 和 `fingerprints.json`，只适用于非分片项目。需要增加分支逻辑：

1. 读取 `.understand-anything/knowledge-graph.json` 顶层 `kind`。
2. 如果不是 `codebase-sharded`，保持现有逻辑。
3. 如果是 `codebase-sharded`：
   - 读取 `update-state.json`。
   - 如果缺失，提示运行 `/understand --update-shards --with-domain --with-product` 建立 baseline。
   - 生成 sharded update plan。
   - 对 affected code shards 做文件级 incremental patch。
   - 如果存在 `domain-graph.json` 且顶层是 `domain-sharded`，默认重建 artifact hash 发生变化的 domain shards。
   - 如果存在 `product-index.json` 且顶层是 `product-sharded`，默认重建 artifact hash 发生变化的 product shards。
   - 保存 `update-state.json`。

Hook 默认跟随已有产物：如果项目之前没有 domain/product sharded manifest，就不要自动生成新的 domain/product 产物。

## 删除与重命名

### 文件删除

如果 deleted file 仍能从旧 shard `nodes[*].filePath` 映射到 shard，则在该 shard 的 `deletedFiles` 中记录。patch 时删除该文件对应旧 nodes 以及相关 edges，然后重新 merge 和验证。

### 文件移动

git diff 只提供 name-only 时，移动通常表现为旧路径删除 + 新路径新增。处理方式：

1. 旧路径命中 shard A，新路径命中 shard B：A 删除旧文件节点，B 分析新文件。
2. 旧路径和新路径都命中同一 shard：该 shard 删除旧文件节点并分析新文件。
3. 新路径未命中任何 scope：记录 unmapped warning。

### Shard 删除

第一版不自动删除 shard 文件。删除 shard 需要用户或外部编排显式移除 `.understand-anything/shards/<id>.json` 并运行 refresh manifest。这样避免因为一次误判把大型产物删掉。

## 失败处理

1. Code shard patch 失败：保留旧 code/domain/product shard，记录 warning，不更新该 shard 的 state hash。
2. Domain shard 重建失败：保留旧 domain shard，默认继续 product 重建。
   - 如果旧 domain shard 仍存在，product 使用旧 domain shard，并在 warning 中记录 domain rebuild failed。
   - 如果旧 domain shard 不存在，product 使用无 domain context 模式继续。
3. Product shard 重建失败：保留旧 product shard 和 trace，记录 warning。
4. 只有所有 requested shard 更新步骤完成后，才更新全局 `update-state.json.gitCommitHash`。
5. 如果部分 shard 失败，`gitCommitHash` 不推进到 HEAD，下一次 update 会重新尝试。

## 产物一致性

需要修正 product shard 的 source path：

1. 非分片 product index 继续写：
   ```json
   "knowledgeGraph": { "path": ".understand-anything/knowledge-graph.json" }
   ```
2. 分片 product shard 应写：
   ```json
   "knowledgeGraph": { "path": ".understand-anything/shards/home.json" }
   ```
3. 如果使用 domain shard，应写：
   ```json
   "domainGraph": { "path": ".understand-anything/domain-shards/home.json" }
   ```

否则 product freshness 和追溯会误认为它依赖 root manifest，而不是具体 code shard。

## 测试策略

### Core 单元测试

1. `sharded-update-state`：
   - 读写 `update-state.json`。
   - 计算 artifact hash。
   - 缺失 state 时返回需要 baseline 的结果。
2. `affected-shard-detector`：
   - changed file 命中 scope。
   - deleted file 命中旧 shard node。
   - file move 命中两个 shard。
   - unmapped source file 产生 warning。
3. `shard-incremental-patch`：
   - cosmetic-only file 不触发 LLM batch，也不触发 domain/product。
   - structural file 只替换该文件旧 nodes/edges。
   - deleted file 删除对应旧 nodes/edges。
   - external edges 在 merge 后保留。
4. `product sources`：
   - `--shard home` 生成 product shard 时 sources 指向 `shards/home.json`。
   - domain shard 存在时 sources 指向 `domain-shards/home.json`。

### Skill helper 测试

1. sharded update plan 脚本输出 affected shards 和 structural/cosmetic/deleted 文件分类。
2. refresh manifest 后 state 不丢失。
3. 部分 shard patch 失败时不推进全局 commit。

### 文档/Prompt 测试

1. `/understand` 文档包含 `--update-shards` 语义。
2. hook prompt 包含 `codebase-sharded` 分支。
3. `/understand-domain` 和 `/understand-product` 文档明确它们不做内部 diff，只跟随受影响 shard 重建。

## 实施顺序

1. 增加 core/state helper：`update-state`、artifact hash、affected shard detector。
2. 增加 per-shard fingerprint 读写和 changed file classification。
3. 增加 code shard incremental patch helper：prune old file nodes/edges、写 `batch-existing.json`、调用 merge。
4. 扩展 `/understand` skill 文档，加入 `--update-shards` 文件级增量流程。
5. 扩展 hook prompt，识别 `codebase-sharded` 并走 sharded file-level update。
6. 修正 product shard sources path。
7. 增加 domain/product 跟随重建说明。
8. 增加测试覆盖。

## 验收标准

1. 非分片 `/understand` incremental tests 仍通过。
2. 分片项目修改 `a_home/src/Home.kt` 后，只重分析 `home` shard 中的该文件，不重扫整个 `home` scope。
3. cosmetic-only 修改不会触发 LLM file-analyzer，也不会重建 domain/product。
4. 开启 domain/product 跟随后，同一次 update 只重建 artifact hash 变化的 `domain-shards/home.json` 和 `product-shards/home.json`。
5. 修改未映射源码文件时，不错误重建所有 shards，并输出明确 warning。
6. product shard 的 `sources.knowledgeGraph.path` 指向对应 code shard。
7. 任一 shard patch 或 downstream 重建失败时不会推进全局 sharded update commit。
