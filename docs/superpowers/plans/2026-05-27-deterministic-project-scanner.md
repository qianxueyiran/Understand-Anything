# Deterministic Project Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `project-scanner` 从“每次让 agent 写扫描脚本”改成“主流程先运行固定脚本，scanner agent 只做轻量总结和结果装配”，同时保证 `/understand --scope` 的 scoped 文件列表与 cross-scope import 解析保持正确。

**Architecture:** `code-shard-workflow.md` 负责在主上下文调用固定脚本生成中间扫描产物；`project-scanner.md` 只读取这些产物、补充 README/manifest 驱动的项目描述和保守 framework 总结，并写出既有 `scan-result.json` schema。`scan-project.mjs` 提供 scope 过滤能力；`extract-import-map.mjs` 使用全仓文件集合解析 import，但只为 scoped 文件输出 key。

**Tech Stack:** Node.js ESM scripts, Vitest docs/contract tests, existing `@understand-anything/core` ignore filter and parser registry.

---

## 设计约束

- 最终 `scan-result.json` schema 不变，继续包含 `name`、`description`、`languages`、`frameworks`、`files`、`totalFiles`、`filteredByIgnore`、`estimatedComplexity`、`importMap`。
- `files`、`totalFiles`、`filteredByIgnore`、`estimatedComplexity`、`importMap` 由固定脚本产物决定，scanner agent 不允许重写这些结构化字段。
- `/understand --scope` 的 `files` 只包含 scope 内文件；`importMap` 只包含 scope 内文件作为 key，但 value 可以指向全仓任意已发现文件。
- 固定脚本失败两次后才 fallback 到 agent 自写扫描脚本，并且最终结果必须带 `warnings: ["deterministic-scan-fallback-used"]`。
- fallback 是兼容性兜底，不是常规路径；常规路径不再要求 agent 写临时扫描脚本。

## Task 1: 增加 scanner 契约测试

- [ ] 编辑 `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`。
- [ ] 新增测试 `documents deterministic project-scanner contract`，读取：
  - `skills/understand/code-shard-workflow.md`
  - `agents/project-scanner.md`
- [ ] 断言 `code-shard-workflow.md` 包含：
  - `scan-project.mjs`
  - `extract-import-map.mjs`
  - `scan-files.json`
  - `import-map.json`
  - `scan-result.json`
  - `using `$PLUGIN_ROOT/agents/project-scanner.md``
- [ ] 断言 `project-scanner.md` 包含：
  - `Deterministic Scan Inputs`
  - `scan-files.json`
  - `import-map.json`
  - `deterministic-scan-fallback-used`
  - `Do not rewrite`
- [ ] 断言 `project-scanner.md` 不再包含常规路径的 `Write a script`、`tmp/ua-project-scan.js`。
- [ ] 运行测试，确认先失败：

```bash
corepack pnpm --filter @understand-anything/skill exec vitest run src/__tests__/understand-sharded-diff-docs.test.ts
```

Expected failure: 新测试应因 workflow/scanner 文档尚未声明固定脚本契约而失败。

## Task 2: 为 `scan-project.mjs` 增加 scope 输入契约

- [ ] 编辑 `understand-anything-plugin/skills/understand/scan-project.mjs`。
- [ ] 将 CLI 用法扩展为：

```text
node scan-project.mjs <projectRoot> <outputPath> [--scope-json <json-array>]
```

- [ ] 解析 `--scope-json` 为 project-relative scope roots，拒绝绝对路径、空字符串、包含 `..` 越界的路径。
- [ ] 扫描仍先枚举全仓并应用 `.understandignore`，然后生成两个集合：
  - `repositoryFiles`: 全仓保留文件，用于 import 解析上下文。
  - `files`: scope 内保留文件；无 scope 时等于 `repositoryFiles`。
- [ ] 输出 JSON 增加中间字段：

```json
{
  "projectRoot": "/abs/project",
  "files": [],
  "repositoryFiles": []
}
```

`repositoryFiles` 只允许作为 intermediate 输入，不进入最终 `scan-result.json`。

- [ ] `totalFiles`、`estimatedComplexity`、`stats.filesScanned` 基于 scoped `files` 计算。
- [ ] `filteredByIgnore` 继续表示用户 `.understandignore` 对全仓候选文件的额外过滤数量，避免 scoped shard 误报“没有过滤”。
- [ ] 如果 scope 内没有文件，脚本仍输出空 `files`、`totalFiles: 0`，并以 exit 0 完成。

## Task 3: 让 `extract-import-map.mjs` 支持全仓解析、scoped key 输出

- [ ] 编辑 `understand-anything-plugin/skills/understand/extract-import-map.mjs`。
- [ ] 保持旧输入兼容：如果没有 `repositoryFiles`，继续使用 `files` 构建解析上下文。
- [ ] 当输入包含 `repositoryFiles` 时：
  - 用 `repositoryFiles` 构建 `fileSet`、tsconfig/go.mod/composer/Rust/Java/Kotlin/C# 索引。
  - 只遍历 `files` 生成 `importMap` keys。
  - 输出 value 可以指向 `repositoryFiles` 中任意文件。
- [ ] 输出统计保持确定性：
  - `filesScanned` = scoped `files.length`
  - `filesWithImports` = scoped key 中 value 非空的数量
  - `totalEdges` = scoped key 的边数量
- [ ] 不改变已有 resolver 规则。

## Task 4: 增加脚本级回归测试

- [ ] 新增 `understand-anything-plugin/src/__tests__/understand-deterministic-scanner.test.ts`，避免引入新的测试框架。
- [ ] 在测试中用 `mkdtemp` 构造临时项目：
  - `packages/a/src/a.ts` import `../../b/src/b`
  - `packages/b/src/b.ts`
  - `README.md`
- [ ] 测试通过 `spawnSync(process.execPath, [...])` 运行 `scan-project.mjs` 和 `extract-import-map.mjs`，不要 mock 脚本行为。
- [ ] 断言：
  - `scan-files.json.files` 只包含 `packages/a/**`。
  - `scan-files.json.repositoryFiles` 包含 `packages/a/**` 和 `packages/b/**`。
  - `import-map.json.importMap` 只包含 `packages/a/src/a.ts` key。
  - `import-map.json.importMap["packages/a/src/a.ts"]` 包含 `packages/b/src/b.ts`。
- [ ] 再构造 no-scope 情况，断言没有 `repositoryFiles` 兼容性破坏，或 `repositoryFiles` 与 `files` 等价。

## Task 5: 更新 `code-shard-workflow.md` Phase 1

- [ ] 编辑 `understand-anything-plugin/skills/understand/code-shard-workflow.md`。
- [ ] 在 dispatch `project-scanner` 之前，要求主上下文创建 intermediate 目录并运行固定脚本：

```bash
node "$SKILL_DIR/scan-project.mjs" "$PROJECT_ROOT" "$PROJECT_ROOT/.understand-anything/intermediate/scan-files.json" --scope-json "$SCOPE_PATHS_JSON"
node "$SKILL_DIR/extract-import-map.mjs" "$PROJECT_ROOT/.understand-anything/intermediate/scan-files.json" "$PROJECT_ROOT/.understand-anything/intermediate/import-map.json"
```

- [ ] 明确 `$SCOPE_PATHS_JSON` 是 `SCOPE_PATHS` 的 JSON array 表达；如果 scope 为空，传 `[]` 或省略参数，两者必须由实现保持一致。
- [ ] scanner prompt 改为“读取固定脚本输出并装配 `scan-result.json`”，不要再让 scanner 自己发现全仓。
- [ ] 保留 `README_CONTENT`、`MANIFEST_CONTENT`、`LANGUAGE_DIRECTIVE` 注入。
- [ ] 保留 `$PLUGIN_ROOT/agents/project-scanner.md` 绝对 plugin root 引用，避免破坏既有 docs 测试。

## Task 6: 收窄 `project-scanner.md`

- [ ] 编辑 `understand-anything-plugin/agents/project-scanner.md`。
- [ ] 将原 `Phase 1 -- Discovery Script` 改成 `Phase 1 -- Deterministic Scan Inputs`。
- [ ] 常规路径只允许读取：
  - `$PROJECT_ROOT/.understand-anything/intermediate/scan-files.json`
  - `$PROJECT_ROOT/.understand-anything/intermediate/import-map.json`
  - main session 提供的 README/manifest context
- [ ] 明确结构化字段来源：
  - `files`、`totalFiles`、`filteredByIgnore`、`estimatedComplexity` 来自 `scan-files.json`
  - `importMap` 来自 `import-map.json`
  - `name`、`rawDescription`、`readmeHead`、`description`、`frameworks` 可由 README/manifest/扫描摘要生成
- [ ] `frameworks` 采用保守策略：
  - 固定脚本或轻量规则命中的 framework 可以保留。
  - LLM 可添加 `frameworkNotes`，但不能把不确定项写入强断言。
- [ ] 删除常规路径中的 `Write a script`、`tmp/ua-project-scan.js`、“execute your script”指令。
- [ ] 增加 fallback 段落：
  - 只有固定脚本缺失、Node 不可用、或固定脚本连续失败两次时才启用。
  - fallback 仍可以写临时脚本，但必须输出兼容 schema。
  - fallback 输出必须增加 `warnings`，包含 `deterministic-scan-fallback-used`。
  - 如果 fallback 也失败两次，停止并报告失败，不进入无限重试。

## Task 7: 跑完整验证

- [ ] 运行 docs/contract 测试：

```bash
corepack pnpm --filter @understand-anything/skill exec vitest run src/__tests__/understand-sharded-diff-docs.test.ts
```

- [ ] 运行新增脚本测试所在文件：

```bash
corepack pnpm --filter @understand-anything/skill exec vitest run src/__tests__/understand-deterministic-scanner.test.ts
```

- [ ] 直接 smoke test 固定脚本：

```bash
mkdir -p /private/tmp/ua-scanner-smoke/packages/a/src /private/tmp/ua-scanner-smoke/packages/b/src /private/tmp/ua-scanner-smoke/.understand-anything/intermediate
printf "import '../../b/src/b';\n" > /private/tmp/ua-scanner-smoke/packages/a/src/a.ts
printf "export const b = 1;\n" > /private/tmp/ua-scanner-smoke/packages/b/src/b.ts
node understand-anything-plugin/skills/understand/scan-project.mjs /private/tmp/ua-scanner-smoke /private/tmp/ua-scanner-smoke/.understand-anything/intermediate/scan-files.json --scope-json '["packages/a"]'
node understand-anything-plugin/skills/understand/extract-import-map.mjs /private/tmp/ua-scanner-smoke/.understand-anything/intermediate/scan-files.json /private/tmp/ua-scanner-smoke/.understand-anything/intermediate/import-map.json
```

- [ ] 检查 smoke output：

```bash
node -e "const fs=require('fs'); const scan=JSON.parse(fs.readFileSync('/private/tmp/ua-scanner-smoke/.understand-anything/intermediate/scan-files.json','utf8')); const imports=JSON.parse(fs.readFileSync('/private/tmp/ua-scanner-smoke/.understand-anything/intermediate/import-map.json','utf8')); console.log(JSON.stringify({files: scan.files.map(f=>f.path), repositoryFiles: scan.repositoryFiles.map(f=>f.path), importMap: imports.importMap}, null, 2));"
```

Expected output:

```json
{
  "files": ["packages/a/src/a.ts"],
  "repositoryFiles": ["packages/a/src/a.ts", "packages/b/src/b.ts"],
  "importMap": {
    "packages/a/src/a.ts": ["packages/b/src/b.ts"]
  }
}
```

## Task 8: 最终检查

- [ ] `git diff -- understand-anything-plugin/skills/understand/scan-project.mjs`，确认 no-scope 行为向后兼容。
- [ ] `git diff -- understand-anything-plugin/skills/understand/extract-import-map.mjs`，确认 resolver 逻辑没有无关重写。
- [ ] `git diff -- understand-anything-plugin/agents/project-scanner.md understand-anything-plugin/skills/understand/code-shard-workflow.md`，确认 agent 常规路径不再要求写扫描脚本。
- [ ] `git status --short`，确认只包含本任务相关文件和用户已有脏改，不回退任何既有改动。

---

## 风险与缓解

- **风险：scope 过滤导致 cross-scope import 丢失。** 通过 `repositoryFiles` 作为解析上下文、`files` 作为 key 集合解决。
- **风险：agent 又开始写临时扫描脚本。** 通过 docs 测试锁定 `project-scanner.md` 常规路径不包含 `Write a script` 和 `tmp/ua-project-scan.js`。
- **风险：最终 schema 被中间字段污染。** `project-scanner.md` 明确 `repositoryFiles` 不能写入最终 `scan-result.json`，并用契约测试覆盖。
- **风险：不同 shell 对 JSON 参数转义不一致。** workflow 中定义 `$SCOPE_PATHS_JSON` 由主上下文生成，脚本端只解析单个 JSON array 参数；测试使用单引号包裹 JSON。

## 完成定义

- `/understand --scope` 的 Phase 1 不再要求 `project-scanner` 自写扫描脚本。
- scoped shard 的 `files` 只包含 scope 内文件。
- scoped shard 的 `importMap` 能指向 scope 外文件。
- 固定扫描脚本失败策略统一为失败两次后 fallback；fallback 失败两次后停止。
- 相关 Vitest 和 smoke test 通过。
