# Deterministic Project Scanner 设计

## 背景

当前 `project-scanner` agent 的职责过重：它需要阅读长篇扫描规则、临时编写扫描脚本、执行脚本、修复脚本错误，再生成最终 `scan-result.json`。这种设计早期有合理性，因为它能快速适配未知语言、未知框架和不同运行环境；但在 shard-only、cold-start、大型仓库长期运行场景中，它带来了明显问题：

- 扫描阶段耗时不稳定，agent 常把时间花在写脚本和 debug 脚本上。
- 同一项目在不同 agent 或不同运行中可能输出不同的 `files`、`frameworks`、`importMap`。
- scoped shard 仍需要跨仓库 import 解析，临时脚本容易扫过多文件或漏掉 alias。
- 已经存在 `scan-project.mjs` 和 `extract-import-map.mjs`，但 workflow 仍没有把它们作为主路径使用。

本设计的目标是保留原输出 schema 和下游契约，同时把确定性工作从 LLM 推理中拿出来。

## 目标

1. 保持 `scan-result.json` 的现有字段结构不变。
2. 默认使用固定脚本生成结构化字段，减少 project-scanner 阶段耗时和输出漂移。
3. 保留 `project-scanner` agent，但把它降级为轻量总结器，只负责自然语言 `description` 和受控 warning。
4. 保留异常 fallback，但必须显式标记，方便后续把缺口沉淀回脚本。
5. 不改变 `file-analyzer`、`merge-batch-graphs.py`、dashboard、update-diff 对扫描结果的消费方式。

## 非目标

- 不在本阶段移除 `project-scanner` subagent。
- 不重写 `scan-project.mjs` 或 `extract-import-map.mjs` 的核心解析能力。
- 不改变 `scan-result.json` 的必需字段名称。
- 不让 LLM 修改 `files`、`importMap`、`totalFiles` 等结构化字段。

## 输出责任划分

确定性脚本负责以下字段：

- `files`
- `languages`
- `files[].language`
- `files[].fileCategory`
- `files[].sizeLines`
- `totalFiles`
- `filteredByIgnore`
- `estimatedComplexity`
- `importMap`
- `frameworks` 初筛，采用保守规则

LLM 只负责：

- `description`
- 可选 `warnings`
- 可选 `frameworkNotes`

LLM 不允许改写以下字段：

- `files`
- `languages`
- `frameworks`
- `totalFiles`
- `filteredByIgnore`
- `estimatedComplexity`
- `importMap`

如果 LLM 认为脚本输出存在可疑之处，只能写入 `warnings` 或 `frameworkNotes`，不能直接修补结构化字段。

## 新扫描流程

`code-shard-workflow.md` 的 Phase 1 使用固定脚本作为主路径。

第一步，运行文件扫描：

```bash
node "$SKILL_DIR/scan-project.mjs" "$PROJECT_ROOT" "$PROJECT_ROOT/.understand-anything/intermediate/scan-files.json"
```

该步骤输出文件清单、语言、分类、行数、ignore 统计、复杂度和 framework 初筛。

第二步，运行 importMap 解析：

```bash
node "$SKILL_DIR/extract-import-map.mjs" "$PROJECT_ROOT/.understand-anything/intermediate/scan-files.json" "$PROJECT_ROOT/.understand-anything/intermediate/import-map.json"
```

该步骤输出以 scope 文件为 key 的 `importMap`。对于 scoped shard，`files` 只包含 scope 内文件，但 import 解析可以使用全仓文件索引，以保留跨 shard `imports` 边。

第三步，调用 `project-scanner` agent 进行轻量总结：

- 读取 `scan-files.json`。
- 读取 `import-map.json`。
- 读取 README 和 manifest 注入上下文。
- 生成 `description`。
- 将脚本输出和 `description` 组装成最终 `.understand-anything/intermediate/scan-result.json`。

## project-scanner agent 新职责

`project-scanner.md` 需要改为：

- 不再要求 agent 写扫描脚本。
- 明确 `scan-project.mjs` 和 `extract-import-map.mjs` 是默认主路径。
- 明确结构化字段必须直接来自脚本输出。
- 明确 agent 只能生成 `description`、`warnings`、`frameworkNotes`。
- 明确 fallback 只有在脚本缺失或脚本失败两次后允许。

最终输出仍为：

```json
{
  "name": "project-name",
  "description": "Brief description from README or package.json",
  "languages": ["kotlin", "xml"],
  "frameworks": ["Android"],
  "files": [
    {
      "path": "a_home/src/main/Home.kt",
      "language": "kotlin",
      "sizeLines": 120,
      "fileCategory": "code"
    }
  ],
  "totalFiles": 1,
  "filteredByIgnore": 0,
  "estimatedComplexity": "small",
  "importMap": {
    "a_home/src/main/Home.kt": []
  },
  "warnings": [],
  "frameworkNotes": []
}
```

`warnings` 和 `frameworkNotes` 可以缺省，但如果出现 fallback 必须写入 `warnings`。

## fallback 规则

只有以下情况允许 fallback 到 agent 临时脚本：

- `scan-project.mjs` 不存在。
- `extract-import-map.mjs` 不存在。
- Node.js 不可用。
- 固定脚本执行失败两次。

fallback 输出必须包含 warning：

```json
"warnings": ["deterministic-scan-fallback-used"]
```

fallback 不应成为常规路径。它的目的只是让跨平台运行不至于完全中断，并把缺口显式暴露出来。

## 测试策略

新增或更新文档约束测试：

- `project-scanner.md` 不再包含 “Write a script”。
- `project-scanner.md` 包含 `scan-project.mjs` 和 `extract-import-map.mjs`。
- `project-scanner.md` 明确 LLM 不允许改写 `files`、`importMap`、`totalFiles`。
- `code-shard-workflow.md` Phase 1 明确先运行固定脚本，再让 scanner agent 组装最终输出。
- `scan-result.json` schema 字段保持不变。
- fallback 必须出现 `deterministic-scan-fallback-used` warning。

保留现有脚本测试，不在本设计中扩展解析规则。

## 风险与缓解

风险：固定脚本不如优秀 agent 临场适配能力强。  
缓解：保留 fallback，并要求 agent 把规则缺口写入 warning，后续沉淀到脚本。

风险：framework 初筛变保守，可能少报。  
缓解：LLM 可写 `frameworkNotes`，但不改 `frameworks` 数组，避免结构化字段漂移。

风险：某些平台 Node 不可用。  
缓解：fallback 允许 agent 写脚本，但必须显式标记。

风险：下游依赖字段顺序或缺省字段。  
缓解：最终 `scan-result.json` 保持原必需字段不变，新增字段只使用可选 `warnings` 和 `frameworkNotes`。

## 验收标准

1. `/understand --scope` 和 `understand-cold-start` 的 scan 阶段默认使用固定脚本。
2. `project-scanner` 不再在正常路径中写扫描脚本。
3. 输出 `scan-result.json` 的必需字段与现有下游兼容。
4. 相关文档约束测试通过。
5. 固定脚本失败时，fallback 会显式写入 `deterministic-scan-fallback-used`。
