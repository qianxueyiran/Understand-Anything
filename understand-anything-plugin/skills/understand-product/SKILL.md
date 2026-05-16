---
name: understand-product
description: Extract product-facing knowledge from a codebase using an existing /understand knowledge graph, including product areas, concepts, display rules, data fields, and code evidence.
argument-hint: [--full]
---

# /understand-product

从已有 `/understand` 知识图谱中抽取面向产品经理可理解的产品知识，生成可选的 `.understand-anything/product-knowledge.json`。这个 skill 不改变 `/understand` 默认流程；只有用户显式运行 `/understand-product` 时才生成产品知识。

## Phase 0: 准备路径

将 `PROJECT_ROOT` 设为当前工作目录，并在后续所有步骤中用它表示当前项目。

必须先检查：

```bash
if [ ! -f "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" ]; then
  echo "Error: .understand-anything/knowledge-graph.json not found. 请先运行 /understand 生成知识图谱。"
  exit 1
fi
```

如果 `$PROJECT_ROOT/.understand-anything/domain-graph.json` 存在，将它作为可选业务流上下文一起提供给分析 agent；不存在时继续执行，不要报错。

解析 `PLUGIN_ROOT` 时必须与 `/understand-domain` 保持一致：优先使用运行时注入的 plugin root，然后尝试通用安装路径、skill symlink 真实路径、Copilot skill symlink 真实路径和常见 clone 安装路径。

```bash
SKILL_REAL=$(realpath ~/.agents/skills/understand-product 2>/dev/null || readlink -f ~/.agents/skills/understand-product 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand-product 2>/dev/null || readlink -f ~/.copilot/skills/understand-product 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

PLUGIN_ROOT=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT}" \
  "$HOME/.understand-anything-plugin" \
  "$SELF_RELATIVE" \
  "$COPILOT_SELF_RELATIVE" \
  "$HOME/.codex/understand-anything/understand-anything-plugin" \
  "$HOME/.opencode/understand-anything/understand-anything-plugin" \
  "$HOME/.pi/understand-anything/understand-anything-plugin" \
  "$HOME/understand-anything/understand-anything-plugin"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done

if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: Cannot find the understand-anything plugin root."
  echo "Checked:"
  echo "  - ${CLAUDE_PLUGIN_ROOT:-<unset CLAUDE_PLUGIN_ROOT>}"
  echo "  - $HOME/.understand-anything-plugin"
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand-product>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand-product>}"
  echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
  echo "  - $HOME/understand-anything/understand-anything-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi
```

## Phase 1: 抽取产品上下文候选

运行预处理脚本：

```bash
python "$PLUGIN_ROOT/skills/understand-product/extract-product-context.py" "$PROJECT_ROOT"
```

脚本只写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-context.json
```

这个文件包含高信号候选文件、用户可见文案、字段、展示逻辑标记和短 preview，用于降低 agent 直接扫源码的成本。

## Phase 2: 产品知识分析

读取以下输入并派发 subagent：

- `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`
- `$PROJECT_ROOT/.understand-anything/domain-graph.json`，如果存在则作为可选业务流上下文
- `$PROJECT_ROOT/.understand-anything/intermediate/product-context.json`
- `$PLUGIN_ROOT/agents/product-analyzer.md`

subagent 必须将结果写入：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-knowledge.json
```

不要把完整 JSON 返回到对话上下文；只返回简短统计。

## Phase 3: 验证并保存

读取 `$PROJECT_ROOT/.understand-anything/intermediate/product-knowledge.json` 后验证：

- 顶层必须包含 `version`、`project`、`productAreas`、`concepts`
- `productAreas` 与 `concepts` 必须为数组
- 每个 `confidence` 为 `confirmed` 的 concept 至少包含一条 `evidence`
- 每条 evidence 至少能定位到 `filePath` 或 `nodeId`
- `displayRules`、`dataFields` 如存在，必须保持数组结构
- 保存前必须优先调用 core schema/persistence 提供的验证或保存能力（例如 `ProductKnowledge` schema validation / persistence save path），让 core 层统一做结构和 evidence 校验；只有当前运行环境无法直接调用这些能力时，才允许使用下面的硬规则手工验证。
- 必须递归校验所有 evidence/code reference 路径，覆盖：
  - `productAreas[].codeRefs[]`
  - `concepts[].evidence[]`
  - `concepts[].displayRules[].evidence[]`
  - `concepts[].dataFields[].evidence[]`
- 对上述对象里的每个 `filePath` 应用同一组硬规则：必须是项目内相对路径；禁止绝对路径；禁止空字符串；禁止包含 `..` 路径段；禁止反斜杠；禁止 Windows 盘符或 UNC 路径等可疑路径；规范化后仍必须位于 `$PROJECT_ROOT` 内。
- 如果 evidence 无法确认项目内路径，但可以确认知识图谱节点，只保留 `nodeId` 并删除/拒绝不可信 `filePath`；如果既没有可信 `filePath` 也没有 `nodeId`，该 evidence 验证失败。

验证失败时停止保存，并保留现有 `.understand-anything/product-knowledge.json` 不变。向用户说明失败原因，让用户可重新运行。

验证成功时，将中间结果保存为：

```text
$PROJECT_ROOT/.understand-anything/product-knowledge.json
```

## Phase 4: 清理产品中间文件

只清理以下两个中间文件：

```bash
rm -f "$PROJECT_ROOT/.understand-anything/intermediate/product-context.json"
rm -f "$PROJECT_ROOT/.understand-anything/intermediate/product-knowledge.json"
```

不要删除 `.understand-anything/intermediate/` 下的其他文件。

## 完成输出

完成后输出中文摘要，至少包含：

- product areas 数量
- concepts 数量
- display rules 数量
- confirmed concepts 数量
- 提示：现在可以使用 `/understand-chat` 提问产品问题
