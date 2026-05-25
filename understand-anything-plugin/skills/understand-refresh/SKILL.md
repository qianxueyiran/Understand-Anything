---
name: understand-refresh
description: 编排 sharded code graph、domain graph、product index 的顺序刷新；用于替代 `/understand --update-diff --with-domain/--with-product`。
argument-hint: [--domain] [--product] [--all]
---

# /understand-refresh

用于分片项目的跨产物刷新编排。该 Skill 只负责调度已有流程，不直接生成 graph 或 product index。

## 适用场景

- 用户希望在代码变更后同步刷新 code shards、domain shards、product shards。
- 用户希望替代旧的 `/understand --update-diff --with-domain` 或 `/understand --update-diff --with-product` 使用方式。
- 用户希望在 product/domain shard 文件已存在但 manifest 可能不一致时，顺手刷新 manifest。

## 职责边界

- `/understand --update-diff` 只负责 code shard 增量更新。
- `/understand-domain --shard <id>` 只负责单个 domain shard。
- `/understand-product --shard <id>` 只负责单个 product shard。
- `/understand-domain --refresh-shards` 和 `/understand-product --refresh-shards` 只负责重建 manifest。
- 本 Skill 只做顺序编排和失败汇报；不要求 `/understand` 等待 product/domain current-run result。

## 参数

- `--domain`：刷新受影响 code shards 对应的 domain shards。
- `--product`：刷新受影响 code shards 对应的 product shards。
- `--all`：等价于 `--domain --product`。
- 如果没有传参数，默认执行 `--product`，因为产品问答通常依赖最新 product index。

## 执行流程

1. 运行 code graph 增量：

   ```bash
   /understand --update-diff
   ```

2. 读取 `.understand-anything/intermediate/sharded-update-run.json`。

   - 如果不存在，说明 `/understand --update-diff` 未进入 sharded update 流程；报告并停止。
   - 如果 `status` 是 `blocked`，报告其中 `warnings`，停止。
   - 从 `shards[]` 中收集 `status` 为 `needs-file-analysis` 或 `deleted-only` 的 shard id。
   - `noop` shard 不需要刷新下游。

3. 如果启用 domain 刷新，对每个受影响 shard 运行：

   ```bash
   /understand-domain --shard <id>
   ```

   全部 shard 处理结束后运行：

   ```bash
   /understand-domain --refresh-shards
   ```

4. 如果启用 product 刷新，对每个受影响 shard 运行：

   ```bash
   /understand-product --shard <id>
   ```

   全部 shard 处理结束后运行：

   ```bash
   /understand-product --refresh-shards
   ```

5. 输出中文摘要：

   - code update 是否成功
   - 受影响 shard ids
   - domain 刷新成功/失败的 shard ids
   - product 刷新成功/失败的 shard ids
   - manifest refresh 是否成功

## 失败处理

- 如果 `/understand --update-diff` 失败，停止，不继续 domain/product。
- 如果某个 domain shard 失败，记录失败并继续处理其它 domain shards；product 是否继续取决于用户请求：
  - `--domain` only：直接汇报。
  - `--all`：继续 product，但在最终摘要中明确 domain 存在失败。
- 如果某个 product shard 失败，记录失败并继续处理其它 product shards。
- 不回滚已成功的 code/domain/product 产物。失败后用户可以重新运行本 Skill，或单独运行对应 shard 命令修复。
