# Understand Product Shard-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/understand` 和 `/understand-product` 的正式生成流程收敛为 shard-only，减少 Agent 调度时需要理解和选择的分支。

**Architecture:** 先用文档契约测试锁定 shard-only 行为，再收敛 skill 文档，最后在 `product-index-cli.ts` 增加 CLI enforcement，避免底层仍能生成非 shard product index。历史完整图读取兼容不删除，只把正式生成路径改为 shard-only。

**Tech Stack:** TypeScript strict mode、Vitest、Node.js ESM、pnpm workspace、Markdown skill 文档、现有 Python/Node sharded manifest 脚本。

---

## 文件结构

- 修改 `understand-anything-plugin/skills/understand/SKILL.md`：只保留 code shard 生成和 sharded update 正式流程。
- 修改 `understand-anything-plugin/skills/understand-product/SKILL.md`：只保留 product shard 生成和 product manifest refresh 正式流程。
- 修改 `understand-anything-plugin/src/product-index-cli.ts`：拒绝非 shard product stage；保留 `--refresh-shards` 和 `--shard <id>` stage。
- 修改 `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`：锁定 `/understand` shard-only 文档契约。
- 修改 `understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts`：锁定 `/understand-product` shard-only 文档契约。
- 修改 `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`：调整非 shard CLI 测试为拒绝，保留 shard 流程测试。
- 修改 `understand-anything-plugin/hooks/auto-update-prompt.md`：删除非分片 hook 流程说明，只保留 sharded update。

## Task 1: 锁定 `/understand` shard-only 文档契约

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: 写失败测试，确认 `/understand` 不再暴露非 shard 正式分支**

在 `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts` 中新增测试：

```ts
it("documents shard-only understand generation contract", () => {
  const skill = readFileSync(
    join(pluginRoot, "skills", "understand", "SKILL.md"),
    "utf-8",
  );

  expect(skill).toContain("shard-only");
  expect(skill).toContain("/understand --scope <paths> --shard <id>");
  expect(skill).toContain("/understand --update-diff");
  expect(skill).toContain("kind: \"codebase-sharded\"");
  expect(skill).toContain("非 shard 不再是正式流程的可执行分支");
  expect(skill).not.toContain("Existing non-sharded incremental update path");
  expect(skill).not.toContain("Full mode:");
  expect(skill).not.toContain("Full analysis (all phases)");
  expect(skill).not.toContain("Review-only path");
  expect(skill).not.toContain("automatically launch the dashboard");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @understand-anything/skill test -- understand-sharded-diff-docs.test.ts
```

Expected: FAIL，失败点包含缺少 `shard-only` 或仍包含非 shard 文案。

- [ ] **Step 3: 收敛 `/understand` 选项和决策表**

修改 `understand-anything-plugin/skills/understand/SKILL.md` 顶部选项说明，将正式契约替换为：

````md
## Shard-Only Contract

`/understand` 的正式生成流程是 shard-only。新生成的根 `.understand-anything/knowledge-graph.json` 必须是 `kind: "codebase-sharded"` manifest；代码图正文写入 `.understand-anything/shards/<id>.json`。

支持：
- `/understand --scope <paths> --shard <id>`：生成或重建单个 code shard。
- `/understand --scope <paths> --shard <id> --full`：同上，`--full` 只表示强制重建该 shard。
- `/understand --update-diff`：仅在根 manifest 是 `kind: "codebase-sharded"` 时更新受影响 shards。
- `--language <lang>`：控制自然语言字段输出语言，可与 shard 生成同用。
- `--auto-update` / `--no-auto-update`：写入配置；若没有同时提供 shard 或 update 命令，写完配置后停止。

不支持：
- 无参 `/understand` 生成完整图。
- `/understand --full` 生成完整图。
- 非 sharded root 上的 `/understand --update-diff`。
- 完整图 review-only 分支。

遇到不支持状态时停止并提示：

```text
当前 /understand 正式流程是 shard-only。请使用 /understand --scope <paths> --shard <id> 生成 code shard，或在已有 codebase-sharded manifest 后使用 /understand --update-diff。
```
````

- [ ] **Step 4: 删除正式流程中的非 shard 分支**

在 `Phase 0` 决策逻辑中保留以下表格，删除非 shard full/incremental/review-only 行：

```md
| Condition | Action |
|---|---|
| `--auto-update` 或 `--no-auto-update` 且没有 shard/update 命令 | 写入配置后停止 |
| `SCOPED_SHARD_MODE=true` | 运行 scoped shard full analysis |
| `--update-diff` + existing graph `kind === "codebase-sharded"` | 运行 sharded file-level incremental update |
| `--update-diff` + missing/non-sharded graph | 停止并提示先生成 shard-only graph |
| 其它情况 | 停止并提示 shard-only 用法 |
```

- [ ] **Step 5: 收敛 Phase 5 保存说明**

将保存阶段改为只描述 shard 输出：

````md
## Phase 5 — SAVE

1. 写入 `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json`。
2. 运行：

```bash
python <SKILL_DIR>/refresh-sharded-manifest.py $PROJECT_ROOT
```

3. 为该 shard 写入 `$PROJECT_ROOT/.understand-anything/fingerprints/shards/$SHARD_ID.json`。
4. 清理 intermediate/tmp。
5. 输出中文摘要：shard id、scope、分析文件数、节点/边数量、warnings、shard path、manifest path。
````

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
pnpm --filter @understand-anything/skill test -- understand-sharded-diff-docs.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 Task 1**

```bash
git add understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts understand-anything-plugin/skills/understand/SKILL.md
git commit -m "docs(understand): make understand flow shard-only"
```

## Task 2: 锁定 `/understand-product` shard-only 文档契约

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts`
- Modify: `understand-anything-plugin/skills/understand-product/SKILL.md`

- [ ] **Step 1: 写失败测试，确认 product 正式流程只讲 shard**

在 `understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts` 中新增测试：

```ts
it("documents shard-only product generation contract", () => {
  expect(skill).toContain("正式流程是 shard-only");
  expect(skill).toContain("/understand-product --shard <id>");
  expect(skill).toContain("/understand-product --refresh-shards");
  expect(skill).toContain("product-shards/<id>.json");
  expect(skill).toContain("product-traces/<id>.json");
  expect(skill).toContain("非 shard 不再是正式流程的可执行分支");
  expect(skill).not.toContain("非 shard 模式");
  expect(skill).not.toContain("product-index-trace.json");
  expect(skill).not.toContain("product-signals.jsonl");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @understand-anything/skill test -- product-index-strict-docs.test.ts
```

Expected: FAIL，失败点来自旧的非 shard 路径文案。

- [ ] **Step 3: 重写 `/understand-product` 顶部契约**

将 `understand-anything-plugin/skills/understand-product/SKILL.md` 开头改为：

````md
# /understand-product

`/understand-product` 的正式流程是 shard-only。它基于 `.understand-anything/shards/<id>.json` 生成单个 product shard，并刷新 `.understand-anything/product-index.json` manifest。

支持：
- `/understand-product --shard <id> [--platform android]`
- `/understand-product --refresh-shards`

不支持：
- 无参 `/understand-product`
- 用户直接运行 `--prepare-candidates`
- 用户直接运行 `--build-context-packs`
- 用户直接运行 `--finalize`
- 从完整 `.understand-anything/knowledge-graph.json` 生成单文件 product index

遇到不支持状态时停止并提示：

```text
当前 /understand-product 正式流程是 shard-only。请使用 /understand-product --shard <id> 生成 product shard，或使用 /understand-product --refresh-shards 刷新 product manifest。
```
````

- [ ] **Step 4: 删除正式流程中的非 shard 文件路径**

保留 shard 路径，并删除完整路径说明。阶段路径应只包含：

```text
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-boundary-candidates.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-topic-normalization.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/intermediate/product-shards/<id>/product-index-extractions-by-topic/<topic-file>.json
$PROJECT_ROOT/.understand-anything/product-shards/<id>.json
$PROJECT_ROOT/.understand-anything/product-shards/<id>.signals.jsonl
$PROJECT_ROOT/.understand-anything/product-traces/<id>.json
```

- [ ] **Step 5: 保留内部 CLI 阶段命令但标明由 skill 调用**

阶段命令保留 `$ARGUMENTS`，但说明用户不直接调用这些阶段：

````md
以下 CLI 阶段命令由本 skill 内部调用。用户正式入口始终是 `/understand-product --shard <id>`。

```bash
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --prepare-candidates $ARGUMENTS
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --build-context-packs $ARGUMENTS
node "$PLUGIN_ROOT/dist/product-index-cli.js" "$PROJECT_ROOT" --finalize $ARGUMENTS
```
````

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
pnpm --filter @understand-anything/skill test -- product-index-strict-docs.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 Task 2**

```bash
git add understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts understand-anything-plugin/skills/understand-product/SKILL.md
git commit -m "docs(product): make product flow shard-only"
```

## Task 3: 在 product CLI 中拒绝非 shard 生成

**Files:**
- Modify: `understand-anything-plugin/src/product-index-cli.ts`
- Modify: `understand-anything-plugin/src/__tests__/product-index-cli.test.ts`

- [ ] **Step 1: 写失败测试，非 shard stage 必须报错**

替换 `product-index CLI` 中的 `"prepares boundary candidates without product-index.json"` 测试为：

```ts
it("rejects non-shard product generation stages", async () => {
  await expect(
    runProductIndexCli([
      testRoot,
      "--platform",
      "android",
      "--prepare-candidates",
    ]),
  ).rejects.toThrow(/shard-only.*--shard <id>.*--refresh-shards/s);
});
```

- [ ] **Step 2: 更新 signal path 测试使用 shard 输入**

将 `"writes project-relative signal paths for in-project absolute file paths"` 改为 sharded root：

```ts
it("writes project-relative signal paths for in-project absolute file paths in shard mode", async () => {
  const filePath = resolve(testRoot, "player/PlayerActivity.kt");
  writeShardedRoot("home");
  writeCodeShard("home", {
    ...graph,
    nodes: [{ ...graph.nodes[0], filePath }, graph.nodes[1]],
  });

  await runProductIndexCli([
    testRoot,
    "--platform",
    "android",
    "--prepare-candidates",
    "--shard",
    "home",
  ]);

  const content = readFileSync(
    join(testRoot, ".understand-anything", "product-shards", "home.signals.jsonl"),
    "utf-8",
  ).trim();
  const signals = content
    ? content.split("\n").map((line) => JSON.parse(line) as { filePath?: string })
    : [];

  expect(signals[0].filePath).toBe("player/PlayerActivity.kt");
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run:

```bash
pnpm --filter @understand-anything/skill test -- product-index-cli.test.ts
```

Expected: FAIL，非 shard stage 当前仍会执行。

- [ ] **Step 4: 添加 shard-only guard**

在 `runProductIndexCli` 的 `refreshShards` 分支之后、`loadProductGraphInputs` 之前加入：

```ts
  if (!options.shardId) {
    throw new Error(
      "当前 /understand-product 正式流程是 shard-only。请使用 --shard <id> 生成 product shard，或使用 --refresh-shards 刷新 product-index.json manifest。",
    );
  }
```

完整位置：

```ts
  if (options.refreshShards) {
    const productIndexPath = refreshProductShardedManifest(options.projectRoot);
    return {
      projectRoot: options.projectRoot,
      productIndexPath,
      topics: 0,
      facts: 0,
      evidence: 0,
      signals: 0,
      contextPacks: 0,
    };
  }

  if (!options.shardId) {
    throw new Error(
      "当前 /understand-product 正式流程是 shard-only。请使用 --shard <id> 生成 product shard，或使用 --refresh-shards 刷新 product-index.json manifest。",
    );
  }

  const { graph, domainGraph } = loadProductGraphInputs(options, graphPath);
```

- [ ] **Step 5: 简化 `loadProductGraphInputs` 的非 shard 分支**

将 `loadProductGraphInputs` 中 `if (getTopLevelKind(rootGraph) === "codebase-sharded")` 之后的完整图加载分支替换为不可达保护：

```ts
  throw new Error(
    "Internal error: product shard generation requires --shard <id>.",
  );
```

保留函数签名和 shard 分支，避免本任务扩大重构面。

- [ ] **Step 6: 运行 product CLI 测试**

Run:

```bash
pnpm --filter @understand-anything/skill test -- product-index-cli.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 Task 3**

```bash
git add understand-anything-plugin/src/product-index-cli.ts understand-anything-plugin/src/__tests__/product-index-cli.test.ts
git commit -m "refactor(product): enforce shard-only product generation"
```

## Task 4: 收敛 auto-update hook 文档

**Files:**
- Modify: `understand-anything-plugin/hooks/auto-update-prompt.md`
- Modify: `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`

- [ ] **Step 1: 写失败测试，hook 不再描述非分片路径**

在 `understand-sharded-diff-docs.test.ts` 的 hook 测试中追加：

```ts
expect(hookPrompt).toContain("只支持 codebase-sharded");
expect(hookPrompt).not.toContain("meta.json");
expect(hookPrompt).not.toContain("fingerprints.json");
expect(hookPrompt).not.toContain("PARTIAL_UPDATE");
expect(hookPrompt).not.toContain("FULL_UPDATE");
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @understand-anything/skill test -- understand-sharded-diff-docs.test.ts
```

Expected: FAIL，hook 文档仍包含 legacy non-sharded auto-update。

- [ ] **Step 3: 重写 hook prompt 为 sharded-only**

将 `understand-anything-plugin/hooks/auto-update-prompt.md` 主体替换为：

````md
# Auto-Update Knowledge Graph (Internal — Hook-Triggered)

本 hook 只支持 `kind: "codebase-sharded"` 的 shard-only code graph。它等价于运行 `/understand --update-diff`。

## Phase 0 — Pre-flight

1. Set `PROJECT_ROOT` to the current working directory.
2. Check `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.
3. Read root JSON and require top-level `kind === "codebase-sharded"`.
4. If the file is missing or not sharded, report:

```text
Auto-update requires shard-only graph. Run /understand --scope <paths> --shard <id> first.
```

Then STOP.

## Phase 1 — Sharded Update

Run the same workflow as `/understand --update-diff`:

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT plan
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT assemble-shard --shard <id>
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT commit
```

Only dispatch `file-analyzer` for shards whose run status is `needs-file-analysis`. For `deleted-only`, run `assemble-shard` without file-analyzer. For `noop`, do nothing.

## Phase 2 — Report

Report affected shard ids, warnings, and whether `knowledge-graph.json.update.gitCommitHash` advanced.
````

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
pnpm --filter @understand-anything/skill test -- understand-sharded-diff-docs.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 Task 4**

```bash
git add understand-anything-plugin/hooks/auto-update-prompt.md understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts
git commit -m "docs(hooks): make auto-update sharded-only"
```

## Task 5: 全量验证和文档一致性

**Files:**
- Modify if needed: `understand-anything-plugin/src/__tests__/understand-skill-language.test.ts`
- Modify if needed: `understand-anything-plugin/skills/understand-cold-start/SKILL.md`

- [ ] **Step 1: 运行 skill 测试**

Run:

```bash
pnpm --filter @understand-anything/skill test
```

Expected: PASS。若 `understand-skill-language.test.ts` 失败，只调整断言到 shard-only 文案，例如：

```ts
expect(skillText).toContain("shard-only");
expect(skillText).toContain("不等待人工确认");
expect(skillText).toContain("失败两次后停止");
```

- [ ] **Step 2: 运行 core 测试，确认 shard manifest 和 product builder 未破坏**

Run:

```bash
pnpm --filter @understand-anything/core test
```

Expected: PASS。

- [ ] **Step 3: 运行 build**

Run:

```bash
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
```

Expected: both commands exit 0。

- [ ] **Step 4: 搜索遗留正式流程文案**

Run:

```bash
rg -n "Existing non-sharded incremental|Full analysis \\(all phases\\)|product-index-trace\\.json|product-signals\\.jsonl|非 shard 模式" understand-anything-plugin/skills/understand understand-anything-plugin/skills/understand-product understand-anything-plugin/hooks
```

Expected: no output。如果命中只存在于明确的 legacy error/migration 文案，改成“unsupported legacy state”，不要描述可执行步骤。

- [ ] **Step 5: 提交验证修正**

如果 Step 1-4 产生修正：

```bash
git add understand-anything-plugin/src/__tests__/understand-skill-language.test.ts understand-anything-plugin/skills/understand-cold-start/SKILL.md understand-anything-plugin/skills/understand/SKILL.md understand-anything-plugin/skills/understand-product/SKILL.md understand-anything-plugin/hooks/auto-update-prompt.md
git commit -m "test: align shard-only flow coverage"
```

如果没有修正：

```bash
git status --short
```

Expected: no task-related unstaged changes。

## Self-Review

**Spec coverage:** Task 1 覆盖 `/understand` shard-only；Task 2 覆盖 `/understand-product` 文档；Task 3 覆盖 CLI enforcement；Task 4 覆盖 auto-update；Task 5 覆盖验证。

**Placeholder scan:** 本计划每个修改点都给出文件、命令、预期结果和具体文本或代码。

**Type consistency:** `runProductIndexCli`、`loadProductGraphInputs`、`shardId`、`refreshShards`、`getTopLevelKind` 名称与现有代码一致。
