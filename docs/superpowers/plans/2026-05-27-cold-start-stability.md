# Cold Start Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/understand-cold-start` 在长时间运行、上下文压缩、失败重试和 resume 场景下保持稳定。

**Architecture:** 保留 `cold-start-plan.json` 作为静态计划，新增 `cold-start-run.json` 作为运行态状态文件，由 `cold-start-workflow.py` 提供唯一的状态机命令。把 `/understand-product` 的 shard 流程抽成共享 workflow，cold-start 和 product skill 都读取同一个流程片段，避免 skill 调 skill。

**Tech Stack:** Python helper、Markdown skill workflow、Vitest 文档约束测试、unittest helper 测试。

---

### Task 1: Cold Start Run State

**Files:**
- Modify: `understand-anything-plugin/skills/understand-cold-start/cold-start-workflow.py`
- Modify: `understand-anything-plugin/skills/understand-cold-start/test_cold_start_workflow.py`

- [ ] **Step 1: Write failing tests**

新增测试覆盖：
- `init` 写入 `.understand-anything/cold-start-run.json`。
- `next` 返回第一个 pending code shard。
- `mark-success` 推进 code shard 后返回 product shard。
- `mark-failed` 记录 phase、error、attempts，并在 `--continue-on-error` 下让 `next` 继续。

- [ ] **Step 2: Run tests to verify failure**

Run: `python3 understand-anything-plugin/skills/understand-cold-start/test_cold_start_workflow.py -v`

- [ ] **Step 3: Implement minimal helper state machine**

新增命令：
- `init <project-root> <config-path> <run-path>`
- `next <project-root> <config-path> <run-path> [--resume] [--continue-on-error]`
- `mark-success <project-root> <config-path> <run-path> <stage> <shard-id>`
- `mark-failed <project-root> <config-path> <run-path> <stage> <shard-id> <phase> <error>`
- `status <project-root> <config-path> <run-path>`

- [ ] **Step 4: Run tests to verify pass**

Run: `python3 understand-anything-plugin/skills/understand-cold-start/test_cold_start_workflow.py -v`

### Task 2: Strict Resume Verification

**Files:**
- Modify: `understand-anything-plugin/skills/understand-cold-start/cold-start-workflow.py`
- Modify: `understand-anything-plugin/skills/understand-cold-start/test_cold_start_workflow.py`

- [ ] **Step 1: Write failing tests**

新增测试覆盖：
- code resume 必须校验 shard id、scopes、nodes/edges、无 `layers/tour`。
- product resume 必须校验 product shard、trace、product manifest entry 一致。
- config hash 不匹配时不复用旧 run state。

- [ ] **Step 2: Implement strict artifact checks**

在 helper 中实现 `can_resume_code_shard`、`can_resume_product_shard`，由 `next` 使用。

- [ ] **Step 3: Verify**

Run: `python3 understand-anything-plugin/skills/understand-cold-start/test_cold_start_workflow.py -v`

### Task 3: Product Shard Workflow Sharing

**Files:**
- Create: `understand-anything-plugin/skills/understand-product/product-shard-workflow.md`
- Modify: `understand-anything-plugin/skills/understand-product/SKILL.md`
- Modify: `understand-anything-plugin/skills/understand-cold-start/SKILL.md`
- Modify: `understand-anything-plugin/src/__tests__/product-index-strict-docs.test.ts`
- Modify: `understand-anything-plugin/src/__tests__/understand-sharded-diff-docs.test.ts`

- [ ] **Step 1: Write failing docs tests**

新增测试要求：
- product skill 引用 `product-shard-workflow.md`。
- cold-start 明确内联执行 product shard workflow，不调用 `/understand-product --shard`。
- shared workflow 保留 Phase 1-5 和显式输入/输出路径契约。

- [ ] **Step 2: Extract workflow and update skill docs**

把 `understand-product/SKILL.md` 的 Phase 1-5 主体移动到共享 workflow，product skill 负责参数解析和引用，cold-start 负责内联执行。

- [ ] **Step 3: Verify docs tests**

Run: `corepack pnpm --filter @understand-anything/skill exec vitest run src/__tests__/product-index-strict-docs.test.ts src/__tests__/understand-sharded-diff-docs.test.ts`

### Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run helper tests**

Run: `python3 understand-anything-plugin/skills/understand-cold-start/test_cold_start_workflow.py -v`

- [ ] **Step 2: Run docs tests**

Run: `corepack pnpm --filter @understand-anything/skill exec vitest run src/__tests__/product-index-strict-docs.test.ts src/__tests__/understand-sharded-diff-docs.test.ts src/__tests__/understand-skill-language.test.ts`
