# `/understand` 与 `/understand-product` shard-only 设计

**日期：** 2026-05-26  
**状态：** 已确认  
**目标：** 将 `/understand` 和 `/understand-product` 的正式执行流程收敛为 shard-only，降低 Agent 阅读流程、判断分支和调度子 Agent 的负担。

---

## 背景

当前 `/understand` 同时承载完整图生成、scoped shard 生成、非分片增量、sharded 增量、review-only、dashboard 启动等多条路径。`/understand-product` 也同时支持完整 `product-index.json` 生成和 product shard 生成。

这些兼容路径增加了 Agent 调度成本：Agent 必须先判断当前产物是完整图还是 manifest，再选择不同阶段、不同文件路径和不同错误处理。近期代码已经向 file-only、no `layers`/`tour`、sharded manifest 演进，因此可以把正式生成路径收敛为 shard-only。

## 决策

1. `/understand` 的正式流程只支持 code shard 生成和 sharded update。
2. `/understand-product` 的正式流程只支持 product shard 生成和 product manifest refresh。
3. 非 shard 不再是正式流程的可执行分支，只作为 unsupported legacy state 报错。
4. 旧完整图读取兼容暂时保留给 dashboard、chat、explain、product-qa 和历史产物消费，不在本次设计中硬删除。
5. 根 `.understand-anything/knowledge-graph.json` 在新生成路径下永远是 `kind: "codebase-sharded"` manifest。
6. 根 `.understand-anything/product-index.json` 在新生成路径下永远是 `kind: "product-sharded"` manifest。

## 目标

1. 降低 Agent 执行 `/understand` 时的流程分支数量。
2. 降低 Agent 执行 `/understand-product` 时的路径判断数量。
3. 保持 code shard、product shard 的分析质量不下降。
4. 让错误状态清晰：没有 shard 参数、根图不是 sharded manifest、目标 shard 缺失时都直接停止。
5. 保留历史产物读取兼容，避免一次性破坏下游消费者。

## 非目标

1. 不删除 core 中完整图的 schema、loader 和 persistence 兼容。
2. 不改造 dashboard 的完整图读取逻辑。
3. 不修改 `/understand-domain` 为 shard-only；它可在后续单独收敛。
4. 不实现自动 scope 规划；scope 仍由用户或外部编排提供。
5. 不合并多个 product shards 为单个完整 product index。

## `/understand` 正式契约

### 支持命令

```bash
/understand --scope <paths> --shard <id>
/understand --scope <paths> --shard <id> --full
/understand --update-diff
/understand --auto-update
/understand --no-auto-update
```

`--language <lang>` 可与 shard 生成命令同用。`--auto-update` 和 `--no-auto-update` 只写配置；如果没有同时提供可执行 shard/update 命令，应完成配置写入后停止。

### 不支持命令

```bash
/understand
/understand --full
/understand --update-diff   # 当根 knowledge-graph.json 不是 codebase-sharded
/understand --review        # 作为完整图 review-only 分支
```

这些命令停止并提示：

```text
当前 /understand 正式流程是 shard-only。请使用 /understand --scope <paths> --shard <id> 生成 code shard，或在已有 codebase-sharded manifest 后使用 /understand --update-diff。
```

### 生成流程

```text
Phase 0  preflight：解析 PROJECT_ROOT、PLUGIN_ROOT、language、scope、shard
Phase 0.5 ignore：生成或读取 .understandignore
Phase 1  scan：只扫描 scope roots，import resolution 仍以 PROJECT_ROOT 为根
Phase 2  analyze：file-analyzer 分 batch 分析 scope 文件
Phase 3  merge：merge-batch-graphs.py --preserve-external
Phase 4  validate：确定性校验 nodes / edges，移除 layers / tour
Phase 5  save：写 shards/<id>.json，刷新 codebase-sharded manifest
```

正式流程不再描述非分片 full analysis、非分片 incremental、review-only 完整图、dashboard auto-launch。

### 增量流程

`/understand --update-diff` 只支持 sharded root manifest：

```text
plan
-> 对 needs-file-analysis shard 调度 file-analyzer
-> assemble-shard --shard <id>
-> commit
```

如果 `.understand-anything/knowledge-graph.json` 不存在或不是 `kind: "codebase-sharded"`，停止并提示先生成 shard-only graph。

## `/understand-product` 正式契约

### 支持命令

```bash
/understand-product --shard <id> [--platform android]
/understand-product --refresh-shards
```

### 不支持命令

```bash
/understand-product
/understand-product --prepare-candidates
/understand-product --build-context-packs
/understand-product --finalize
```

这些命令停止并提示：

```text
当前 /understand-product 正式流程是 shard-only。请使用 /understand-product --shard <id> 生成 product shard，或使用 /understand-product --refresh-shards 刷新 product manifest。
```

阶段参数仍由 skill 内部调用 CLI 时使用；用户不直接运行阶段模式作为正式流程。

### 生成流程

```text
Phase 0  preflight：解析 PROJECT_ROOT、PLUGIN_ROOT、shard id
Phase 1  prepare candidates：读取 shards/<id>.json 和可选 domain-shards/<id>.json
Phase 2  topic normalization：调度 product-topic-normalizer
Phase 3  context packs：按 topic 生成 bounded context packs
Phase 4  fact extraction：逐 topic 调度 product-index-analyzer
Phase 5  finalize：写 product-shards/<id>.json、product-traces/<id>.json 并刷新 product-index.json manifest
```

`domain-shards/<id>.json` 缺失不阻塞，只跳过 domain context 并进入 warnings。

## 产物模型

```text
.understand-anything/
  knowledge-graph.json              # kind: codebase-sharded
  shards/
    <id>.json
  fingerprints/
    shards/
      <id>.json

  product-index.json                # kind: product-sharded
  product-shards/
    <id>.json
    <id>.signals.jsonl
  product-traces/
    <id>.json
```

## 兼容策略

1. 旧完整 `knowledge-graph.json` 仍可被 legacy readers 读取，但 `/understand` 不再生成它。
2. 旧完整 `product-index.json` 仍可被 legacy readers 读取，但 `/understand-product` 不再生成它。
3. CLI 层应拒绝非 shard product generation，避免 skill 文档和底层能力分裂。
4. 测试应保留 reader 兼容测试，但正式生成流程测试改成 shard-only。

## 文件影响

| 文件 | 责任 |
|---|---|
| `understand-anything-plugin/skills/understand/SKILL.md` | 收敛 `/understand` 正式流程为 shard-only |
| `understand-anything-plugin/skills/understand-product/SKILL.md` | 收敛 `/understand-product` 正式流程为 shard-only |
| `understand-anything-plugin/src/product-index-cli.ts` | CLI enforcement：拒绝非 shard stage，保留 refresh manifest |
| `understand-anything-plugin/src/__tests__/product-index-cli.test.ts` | 更新 product CLI shard-only 行为测试 |
| `understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts` | 更新 product skill 文档契约测试 |
| `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts` | 更新 `/understand` 文档契约测试 |
| `understand-anything-plugin/src/__tests__/understand-skill-language.test.ts` | 调整对无确认、失败停止、language 文案的断言 |
| `understand-anything-plugin/hooks/auto-update-prompt.md` | 将 hook 说明收敛为 sharded update |

## 测试策略

1. 文档契约测试确认 `/understand` 不再描述非 shard full/incremental 正式分支。
2. 文档契约测试确认 `/understand-product` 不再描述非 shard product index 正式分支。
3. CLI 测试确认非 shard stage 报错。
4. CLI 测试确认 `--shard <id>` 仍生成 product shard、trace、manifest。
5. CLI 测试确认 `--refresh-shards` 不运行 LLM 阶段，只刷新 manifest。
6. sharded update workflow 现有事务测试继续通过。

## 验收标准

1. `/understand` skill 的正式 Phase 中只出现 shard generation 和 sharded update。
2. `/understand-product` skill 的正式 Phase 中只出现 product shard generation 和 manifest refresh。
3. `runProductIndexCli([root, "--prepare-candidates"])` 抛出 shard-only 错误。
4. `runProductIndexCli([root, "--prepare-candidates", "--shard", "home"])` 继续可用。
5. `pnpm --filter @understand-anything/skill test` 通过。
6. `pnpm --filter @understand-anything/skill build` 通过。

