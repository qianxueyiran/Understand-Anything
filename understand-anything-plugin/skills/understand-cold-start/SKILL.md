---
name: understand-cold-start
description: 用于大型 Android 项目按配置冷启动生成分片 code graph 和 product index。
argument-hint: [--config <path>] [--resume] [--continue-on-error]
---

# /understand-cold-start

根据用户维护的分片配置，为大型项目建立第一批分析产物。这个 skill 只做编排：读取配置、按顺序执行已有分片命令，然后校验生成的 code graph 和 product index 产物。

## 配置

默认配置路径是 `.understand-anything/scope-shards.json`。`--config <path>` 可以覆盖默认路径。除非传入绝对路径，否则配置路径为项目根目录。

```json
{
  "version": 1,
  "platform": "android",
  "shards": [
    {
      "id": "home",
      "scopes": ["a_home", "a_home_api"]
    },
    {
      "id": "player",
      "scopes": ["a_player"]
    }
  ]
}
```

配置规则：

- `version` 必须是 `1`。
- `platform` 默认是 `android`。
- `shards` 的顺序就是执行顺序。
- `id` 必须匹配 `^[A-Za-z0-9_-]+$`，并且不能重复。
- `scopes` 必须是 `PROJECT_ROOT` 下非空的项目相对目录列表。
- scope 条目不能包含逗号，因为 `/understand --scope` 使用逗号分隔多个路径。

## Phase 0: 解析路径

1. 将 `PROJECT_ROOT` 设为当前工作目录。
2. 按 `/understand-domain` 的策略解析 `PLUGIN_ROOT`：优先使用 `${CLAUDE_PLUGIN_ROOT}`，然后尝试 `$HOME/.understand-anything-plugin`、从 skill symlink 推导出的根目录，以及各平台常见安装路径。
3. 解析 `CONFIG_PATH`：
   - 如果 `$ARGUMENTS` 包含 `--config <path>`，使用该路径。
   - 否则使用 `$PROJECT_ROOT/.understand-anything/scope-shards.json`。
   - 相对配置路径按 `PROJECT_ROOT` 解析。

## Phase 1: 校验配置并输出计划

运行确定性 helper：

```bash
python "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" plan "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-plan.json"
```

然后读取 `.understand-anything/cold-start-plan.json` 并报告：

- platform
- shard 数量
- 按执行顺序排列的 shard id
- 即将运行的精确 `/understand --scope ... --shard ...` 和 `/understand-product --shard ... --platform ...` 命令

如果配置校验失败，停止并报告错误。配置无效时不要尝试部分执行。

## Phase 2: 生成 Code Shards

按计划顺序，对每个 shard 执行：

```text
/understand --scope <scopeArg> --shard <id>
```

执行规则：

- 一次只运行一个 shard，不要并行。用户明确需要有序冷启动。
- 如果传入 `--resume`，并且 `.understand-anything/shards/<id>.json` 存在且 `shard.id`、`shard.scopes` 与配置匹配，跳过该 code shard，并在报告中说明是 resumed。
- 如果某个 shard 失败，立即停止，除非传入了 `--continue-on-error`。
- 在最终摘要中记录失败项。

## Phase 3: 生成 Product Shards

按同一个计划顺序，对每个 shard 执行：

```text
/understand-product --shard <id> --platform <platform>
```

执行规则：

- 一次只运行一个 product shard。
- 如果传入 `--resume`，并且 `.understand-anything/product-shards/<id>.json` 和 `.understand-anything/product-traces/<id>.json` 都存在，跳过该 product shard，并在报告中说明是 resumed。
- 不要执行 `/understand-domain`。
- 如果某个 product shard 失败，立即停止，除非传入了 `--continue-on-error`。

## Phase 4: 校验产物

运行：

```bash
python "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" verify "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-report.json"
```

读取 `.understand-anything/cold-start-report.json`。

报告必须确认：

- `.understand-anything/knowledge-graph.json` 存在，并且 `kind` 是 `"codebase-sharded"`。
- 每个配置中的 `.understand-anything/shards/<id>.json` 都存在。
- 每个 code shard 顶层的 `shard.id` 和 `shard.scopes` 都与配置匹配。
- `.understand-anything/product-index.json` 存在，并且 `kind` 是 `"product-sharded"`。
- 每个配置中的 `.understand-anything/product-shards/<id>.json` 都存在。
- 每个配置中的 `.understand-anything/product-traces/<id>.json` 都存在。

如果校验失败，报告错误；不要声称冷启动已完成。

## 最终回复

使用中文回复，并包含：

- 使用的配置路径。
- 已完成、因 resume 跳过、失败的 shards。
- code shard manifest 和 product shard manifest 是否通过校验。
- `.understand-anything/cold-start-report.json` 路径。
