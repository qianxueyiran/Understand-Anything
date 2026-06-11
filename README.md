# Understand Anything

本工程基于开源项目 [Lum1104/Understand-Anything](https://github.com/Lum1104/Understand-Anything) 进行二次开发，面向大型 Android 项目场景，扩展了分片模式下的代码图谱生成、产品知识索引、冷启动编排和增量更新能力。

---

## 1. 项目说明

原开源项目通过多智能体流水线分析代码库，构建交互式知识图谱，支持可视化探索、语义搜索和架构理解。

本工程在此基础上重点扩展了：

- **分片（Shard）模式**：将大型 Android 项目按模块切分为多个 shard，独立分析后合并为统一的 sharded manifest，突破单次上下文限制
- **Product Index 生成**：基于 code shard 提取严格 grounded 的产品事实，用于回答"某功能如何实现"类客户端产品问题
- **冷启动编排**：通过配置文件一次性完成所有 code shard + product shard 的首次生成，支持断点续跑
- **增量更新**：仅重新分析自上次运行以来变更的文件，快速同步代码图谱

---

## 2. 快速开始

### 前提条件

- Node.js >= 22
- pnpm >= 10
- Claude Code CLI

### 首次安装

**第一步：构建依赖包**

```bash
pnpm install
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
```

**第二步：将插件复制到 Claude Code 本地缓存**

```bash
mkdir -p ~/.claude/plugins/cache/understand-anything/understand-anything/2.7.6
cp -R ./understand-anything-plugin/. \
  ~/.claude/plugins/cache/understand-anything/understand-anything/2.7.6/
```

**第三步：将插件注册为本地版本**

编辑 `~/.claude/plugins/installed_plugins.json`，将 `understand-anything@understand-anything` 条目的 `installPath` 和 `version` 改为：

```json
{
  "installPath": "/Users/<你的用户名>/.claude/plugins/cache/understand-anything/understand-anything/2.7.6",
  "version": "2.7.6"
}
```

> 这一步让 Claude Code 命中本地缓存，不再从 marketplace 拉取上游版本。

**第四步：启动一个新的 Claude Code session**

已有 session 会缓存旧的 skill 内容，必须新开 session 才能加载改动。

---

### 后续改动时同步

每次修改 skill / agent / src 代码后执行：

```bash
pnpm --filter @understand-anything/core build && \
pnpm --filter @understand-anything/skill build && \
cp -R ./understand-anything-plugin/. \
  ~/.claude/plugins/cache/understand-anything/understand-anything/2.7.6/
```

然后重新开一个 Claude Code session。

---

## 3. `/understand` 介绍及使用说明

`/understand` 负责分析指定范围的代码，生成或更新 code shard。本工程只支持分片模式。

### 支持的命令形式

```bash
# 生成（或重建）一个 code shard
/understand --scope <目录1,目录2,...> --shard <shard-id>

# 强制重建（等价于上面，--full 只是明确表示强制重建）
/understand --scope <目录1,目录2,...> --shard <shard-id> --full

# 增量更新（详见第 6 节）
/understand --update-diff
```

不支持不带 `--shard` 的全项目分析模式。

### 参数说明

| 参数 | 说明 |
|------|------|
| `--scope <paths>` | 以逗号分隔的项目相对路径，指定本 shard 覆盖的模块目录 |
| `--shard <id>` | shard 标识符，须匹配 `^[A-Za-z0-9_-]+$` |
| `--full` | 强制重建，忽略已有 shard 产物 |
| `--language <lang>` | 输出语言，默认 `zh`（中文）|

### 生成产物

- `.understand-anything/knowledge-graph.json` — sharded manifest（`kind: "codebase-sharded"`）
- `.understand-anything/shards/<id>.json` — 该 shard 的代码图正文
- `.understand-anything/fingerprints/shards/<id>.json` — 用于增量更新的文件指纹

### 示例

```bash
# 分析 home 模块（包含 a_home 和 a_home_api 两个目录）
/understand --scope a_home,a_home_api --shard home

# 分析 player 模块
/understand --scope a_player,a_player_core --shard player
```

---

## 4. `/understand-product` 介绍及使用说明

`/understand-product` 基于已有的 code shard，提取以代码为依据的产品事实，生成 product shard，用于回答客户端产品相关问题。

**前提条件：** 对应的 code shard（`.understand-anything/shards/<id>.json`）必须已存在，且根 manifest 的 `kind` 为 `codebase-sharded`。

### 支持的命令形式

```bash
# 为指定 shard 生成产品知识索引
/understand-product --shard <id> --platform android

# 仅刷新 product manifest（不重新生成 shard 内容）
/understand-product --refresh-shards
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `--shard <id>` | 目标 shard 标识符，须与 code shard id 对应 |
| `--platform <name>` | 平台类型，默认 `android` |
| `--refresh-shards` | 不重新生成，只重建 product-index.json manifest |

### 生成产物

- `.understand-anything/product-shards/<id>.json` — 该 shard 的产品知识
- `.understand-anything/product-traces/<id>.json` — 产品事实的代码溯源
- `.understand-anything/product-index.json` — 汇总 manifest（`kind: "product-sharded"`）

### 业务词汇表

在 `docs/business-glossary.md` 中维护项目业务术语，`/understand-product` 会自动读取，用于 Topic 规范化，提升产品问答的准确性。

### 示例

```bash
# 为 home shard 生成产品索引
/understand-product --shard home --platform android

# 为 player shard 生成产品索引
/understand-product --shard player --platform android

# 所有 shard 都生成完毕后，刷新 manifest
/understand-product --refresh-shards
```

---

## 5. 大型项目冷启动

冷启动适用于项目首次接入、需要一次性完成所有 shard 生成的场景。`/understand-cold-start` 按配置文件顺序依次执行每个 code shard 和 product shard，支持断点续跑。

### 第一步：编写分片配置

在目标项目根目录创建 `.understand-anything/scope-shards.json`：

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
      "scopes": ["a_player", "a_player_core"]
    },
    {
      "id": "common",
      "scopes": ["a_common", "a_network"]
    }
  ]
}
```

配置规则：
- `version` 必须为 `1`
- `platform` 目前支持 `android`
- `shards` 按数组顺序执行；`id` 须唯一且符合 `^[A-Za-z0-9_-]+$`
- `scopes` 为项目根目录下的相对路径列表，不能包含逗号

### 第二步：执行冷启动

```bash
# 使用默认配置路径（.understand-anything/scope-shards.json）
/understand-cold-start

# 指定配置文件路径
/understand-cold-start --config path/to/scope-shards.json

# 从上次中断处继续（跳过已成功完成的 shard）
/understand-cold-start --resume

# 某个 shard 失败时继续执行其他 shard，而非中止整个流程
/understand-cold-start --continue-on-error
```

### 执行流程

1. **校验配置**：解析 `scope-shards.json`，输出执行计划（各 shard 的等价手动命令）
2. **状态机驱动执行**：依次生成每个 code shard，再依次生成对应的 product shard
3. **校验产物**：确认所有 shard 文件存在且内容合法，输出校验报告

### 完成后的产物

| 产物路径 | 说明 |
|---------|------|
| `.understand-anything/knowledge-graph.json` | sharded manifest，`kind: "codebase-sharded"` |
| `.understand-anything/shards/<id>.json` | 每个 code shard |
| `.understand-anything/product-index.json` | product manifest，`kind: "product-sharded"` |
| `.understand-anything/product-shards/<id>.json` | 每个 product shard |
| `.understand-anything/product-traces/<id>.json` | 每个 product shard 的代码溯源 |

---

## 6. 更新

代码变更后，使用 `/understand --update-diff` 增量更新代码图谱。

```bash
/understand --update-diff
```

该命令仅重新分析自上次运行以来发生变更的文件，不重建未变动的 shard，速度远快于完整重建。

### 工作机制

- 读取已有的 `kind: "codebase-sharded"` manifest，与当前 git HEAD 比较，确定变更文件
- 将变更文件映射到对应的 shard，只对受影响的 shard 重新运行 `file-analyzer`
- 以事务方式提交，确保所有受影响 shard 均成功后才更新 `knowledge-graph.json`；任意 shard 失败则整次更新回滚
- 无法映射到已有 shard 的变更文件记录为警告，不触发全量重建

### 注意事项

- 运行前须确保工作区处于干净的 git 状态（或已提交目标变更），命令依赖 git diff 计算变更范围
- 该命令只更新 code shard，不自动刷新 product shard；如需同步产品索引，在更新完成后手动运行 `/understand-product --shard <id>`
