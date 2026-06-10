---
name: understand-cold-start
description: 用于大型 Android 项目按配置冷启动生成分片 code graph 和 product index。
argument-hint: [--config <path>] [--resume] [--continue-on-error]
---

# /understand-cold-start

根据用户维护的分片配置，为大型项目建立第一批分析产物。这个 skill 只做编排：读取配置、在主上下文内联执行每个 code shard 的共享 workflow、按顺序生成 product shards，然后校验产物。

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
2. 解析 `PLUGIN_ROOT`：优先使用运行时注入的 plugin root，然后尝试 `$HOME/.understand-anything-plugin`、从当前 skill 文件位置解析出的 plugin root，以及各平台常见安装路径。
3. 解析 `CONFIG_PATH`：
   - 如果 `$ARGUMENTS` 包含 `--config <path>`，使用该路径。
   - 否则使用 `$PROJECT_ROOT/.understand-anything/scope-shards.json`。
   - 相对配置路径按 `PROJECT_ROOT` 解析。

## Phase 1: 校验配置并输出计划

运行确定性 helper：

```bash
python3 "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" plan "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-plan.json"
python3 "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" init "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-run.json"
```

然后读取 `.understand-anything/cold-start-plan.json` 和 `.understand-anything/cold-start-run.json` 并报告：

- platform
- shard 数量
- 按执行顺序排列的 shard id
- 每个 shard 的 scopes 和等价手动命令。等价命令只用于报告，不作为本 skill 的执行步骤。
- run state 路径和 configHash。

如果配置校验失败，停止并报告错误。配置无效时不要尝试部分执行。

## Phase 2: 状态机驱动执行

长期运行必须由 helper 的 run state 驱动。不要靠上下文记忆判断“下一个 shard”。

循环运行：

```bash
python3 "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" next "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-run.json" "$PROJECT_ROOT/.understand-anything/cold-start-next.json" [--resume] [--continue-on-error]
```

读取 `.understand-anything/cold-start-next.json`：

- `action: "run-code-shard"`：执行 Phase 3。
- `action: "run-product-shard"`：执行 Phase 4。
- `action: "blocked"`：停止，报告 `stage`、`shardId`、`phase`、`error`、`attempts`。
- `action: "complete"`：进入 Phase 5 校验。

每次执行 action 前，先调用：

```bash
python3 "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" mark-start "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-run.json" <code|product> <shardId> <phase>
```

执行成功后调用：

```bash
python3 "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" mark-success "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-run.json" <code|product> <shardId>
```

执行失败后调用：

```bash
python3 "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" mark-failed "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-run.json" <code|product> <shardId> <phase> "<error>"
```

失败两次后 helper 会返回 `blocked`。传入 `--continue-on-error` 时，helper 会记录失败并继续下一个可执行 shard。`--resume` 只跳过通过 helper 严格校验的 code/product artifacts。

## Phase 3: 生成 Code Shards

执行规则：
- 当 next action 是 `run-code-shard`，**在主上下文内联执行 Code Shard Workflow：读取并执行 `skills/understand/code-shard-workflow.md`**。不要派发 subagent 执行整个 workflow。
- 对当前 shard 设置 `PROJECT_ROOT`、`PLUGIN_ROOT`、`SKILL_DIR=$PLUGIN_ROOT/skills/understand`、`SHARD_ID`、`SCOPE_PATHS`、`SCOPE_PATHS_JSON`、`SCOPE_ROOTS`、`OUTPUT_LANGUAGE`、`LANGUAGE_DIRECTIVE`、`README_CONTENT`、`MANIFEST_CONTENT`。
- `SCOPE_PATHS_JSON` 必须由当前 shard 的 `SCOPE_PATHS` JSON-encode 得到，且必须是非空 JSON array；如果为空或缺失，停止该 shard，不要执行全项目扫描。
- **使用 `skills/understand/code-shard-workflow.md` 作为唯一 code shard 生成流程来源**，主上下文内联执行其中的 scan、batch analyze、merge、assemble review、validate、save 和 manifest refresh 阶段。
- **一次只运行一个 shard，不要并行**。

## Phase 4: 生成 Product Shards

- 当 next action 是 `run-product-shard`，**在主上下文内联执行 Product Shard Workflow：读取并执行 `skills/understand-product/product-shard-workflow.md`**。不要派发 subagent 执行整个 workflow，也不要把整个 product shard 生成委托给 `/understand-product`。
- 对当前 shard 设置 `PROJECT_ROOT`、`PLUGIN_ROOT`、`SHARD_ID`、`PRODUCT_ARGUMENTS="--shard <id> --platform <platform>"`。
- **使用 `skills/understand-product/product-shard-workflow.md` 作为唯一 product shard 生成流程来源**，主上下文内联执行其中的 prepare candidates、topic normalization、context packs、fact extraction、finalize 和 manifest refresh 阶段。
- **一次只运行一个 product shard，不要并行**。

## Phase 5: 校验产物

运行：

```bash
python3 "$PLUGIN_ROOT/skills/understand-cold-start/cold-start-workflow.py" verify "$PROJECT_ROOT" "$CONFIG_PATH" "$PROJECT_ROOT/.understand-anything/cold-start-report.json"
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
- `.understand-anything/cold-start-run.json` 路径。
- 已完成、因 resume 跳过、失败、blocked 的 shards。
- code shard manifest 和 product shard manifest 是否通过校验。
- `.understand-anything/cold-start-report.json` 路径。
