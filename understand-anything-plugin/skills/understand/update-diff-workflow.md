# Update Diff Workflow

This document is the focused shard-only contract for `/understand --update-diff`. It is a workflow fragment, not a skill. The main context reads this file and executes the phases inline.

Keep `SKILL.md` responsible for option parsing and agent dispatch. Keep `sharded-update-workflow.mjs` responsible for validating `plan`, `assemble-shard`, and `commit` transaction states.

## Inputs

- `PROJECT_ROOT` — absolute project root.
- `PLUGIN_ROOT` — absolute Understand Anything plugin root.
- `SKILL_DIR` — `$PLUGIN_ROOT/skills/understand`.
- `LANGUAGE_DIRECTIVE` — language directive from SKILL.md Pre-flight step 4; inject into every `file-analyzer` dispatch.
- Existing `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` with `kind: "codebase-sharded"`.
- Existing shard artifacts referenced by the manifest.
- Existing shard fingerprints when available under `.understand-anything/fingerprints/shards/`.

## Outputs

- `$PROJECT_ROOT/.understand-anything/intermediate/sharded-update-run.json`
- per-shard analyzer batches under `.understand-anything/intermediate/sharded/<shardId>/`
- per-shard `candidate-shard.json`
- per-shard `assemble-result.json`
- updated `.understand-anything/shards/<id>.json`
- refreshed `.understand-anything/knowledge-graph.json`
- refreshed `.understand-anything/fingerprints/shards/<id>.json`

## Sharded Update

When the root graph is `kind: "codebase-sharded"`, `/understand --update-diff` is a transaction over affected code shards.

Core invariants:

- Artifacts written after `plan` must carry the active `runId`, `headCommitHash`, and `shardId`.
- `sharded-update-workflow.mjs` rejects stale, missing, failed, cross-run, and cross-shard artifacts.
- `merge-batch-graphs.py --import-recovery-only` recovers `imports` edges from `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` `importMap` during `assemble-shard`; Phase 2 Step 1 builds that file by merging per-shard import maps. Cross-shard targets are preserved as `external: true` imports.
- `commit` is the only command allowed to advance `knowledge-graph.json.update.gitCommitHash`.
- `commit` must not partially publish valid shards when another affected shard is rejected.

Product/domain refresh is deliberately outside this workflow. Use `/understand-refresh` when the user wants to run code update followed by `/understand-domain --shard <id>` and/or `/understand-product --shard <id>`. That orchestration is sequential and recoverable; it does not require `/understand` to wait for product/domain current-run result files.

`plan` records changed source files that cannot be mapped to a shard as `unmappedChangedFiles` and warnings. Treat those as warnings on the run, not as a shard status, and do not rebuild every shard as a fallback.

Classification rule: any file that appears in the git diff and still exists in the workspace is **structural** (including comment-only or formatting-only edits). Deleted files are **deleted-only** when no structural files remain for that shard.

`sharded-update-workflow.mjs` owns plan/assemble/commit validation and is the only workflow code that may decide whether a sharded transaction can advance `knowledge-graph.json.update.gitCommitHash`.

### Orchestration (`/understand`)

Execute the phases below, then stop after the sharded update summary.

**Supported workflow commands only:** `plan`, `assemble-shard --shard <id>`, `commit`, and optional `reconcile-warnings`.

## Phase 1 — PLAN

Run the workflow planner from `$PROJECT_ROOT`:

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT plan
```

Read `.understand-anything/intermediate/sharded-update-run.json`.

Extract and keep `runId`, `headCommitHash`, `status`, `warnings`, `unmappedChangedFiles`, and `shards[]`.

If `status` is `blocked`, report `warnings` and STOP. Do not dispatch analyzers, assemble shards, or commit.

For every shard entry, keep:

- `id`
- `path`
- `scopes`
- `status`
- `changedFiles`
- `structuralFiles`
- `deletedFiles`
- `requiredOutputs.fileAnalyzerBatches`
- `requiredOutputs.candidateShard`
- `requiredOutputs.assembleResult`

## Phase 2 — ANALYZE AFFECTED SHARDS

Before Phase 2, ensure working directories exist:

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate/sharded"
mkdir -p "$PROJECT_ROOT/.understand-anything/tmp"
```

Skip analyzer dispatch for `deleted-only`, `noop`, and `blocked` shards.

For each shard where `status === "needs-file-analysis"`, treat that shard's `structuralFiles` as **one batch** (`batch-001`). Run up to **6 shards concurrently**.

Initialize `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` once per run as `{ "importMap": {} }` before the first affected shard scan. Merge each shard's import map into it during Step 1.

### Step 1 — Prepare batch inputs per affected shard

说明：`batchFiles` 只能来自 `structuralFiles` 对应的扫描元数据，禁止扩展文件范围。

For each affected shard:

1. Run deterministic scan scoped to the shard's `scopes`:

```bash
node "$SKILL_DIR/scan-project.mjs" "$PROJECT_ROOT" "$PROJECT_ROOT/.understand-anything/intermediate/update-diff-scan-<shardId>.json" --scope-json "<scopes JSON>" --require-scope --repository-output "$PROJECT_ROOT/.understand-anything/intermediate/update-diff-repository-<shardId>.json"
node "$SKILL_DIR/extract-import-map.mjs" "$PROJECT_ROOT/.understand-anything/intermediate/update-diff-scan-<shardId>.json" "$PROJECT_ROOT/.understand-anything/intermediate/update-diff-import-map-<shardId>.json" --repository-input "$PROJECT_ROOT/.understand-anything/intermediate/update-diff-repository-<shardId>.json"
```

If either deterministic script fails, retry the failed command once with the same arguments after reading stderr. If the retry also fails, stop and report shard id + error.

2. Build `structuralFileSet = new Set(structuralFiles)` and `batchFiles` by filtering scan `files` to paths in `structuralFileSet`.
3. Build `batchImportData` from `update-diff-import-map-<shardId>.json` → `importMap[path] ?? []` for every path in `batchFiles`.
4. Merge this shard's `importMap` into `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` for all paths in `batchFiles` (used by `assemble-shard` import recovery).
5. Validate before dispatch:
   - `batchFiles` is the only source of analyzer input; do not read `repository-files.json`, rescan the repo ad hoc, or reuse stale tmp `ua-file-analyzer-input-*.json`;
   - `new Set(batchFiles.map(f => f.path))` must equal `structuralFileSet` — every structural file must have scan metadata; stop if any path is missing;
   - every batch file must have `fileCategory` in `code|config|docs|infra|data|script|markup`;
   - reject `image`, `resource`, `binary`, or any file category/language outside the scanner contract;
   - `batchImportData` keys must exactly equal the batch file paths.

If validation fails, stop and report the shard id plus invalid paths/categories. Do not dispatch `file-analyzer`.

### Step 2 — Pre-extract structure in main context

说明：主流程先完成结构抽取，子 agent 只做语义分析；tmp 路径用 `<shardId>` 以避免并发冲突。

For each affected shard:

1. Write extract input JSON (verbatim fields) to:
   - `$PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<shardId>.json`

   Required shape:

   ```json
   {
     "projectRoot": "$PROJECT_ROOT",
     "batchFiles": [<path, language, sizeLines, fileCategory each>],
     "batchImportData": { "<path>": ["<resolved-import>", ...], ... }
   }
   ```

2. Run:

```bash
node "$SKILL_DIR/extract-structure.mjs" \
  "$PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<shardId>.json" \
  "$PROJECT_ROOT/.understand-anything/tmp/ua-file-extract-results-<shardId>.json"
```

3. Validate extraction output:
   - `scriptCompleted === true`;
   - `results` is an array;
   - every `results[].path` is in `structuralFileSet`.
4. If extraction fails, retry once with the same arguments after reading stderr. If retry fails, stop and report shard id + error.

### Step 3 — Dispatch `file-analyzer` subagents

说明：派发语义分析合同；输出为 sharded update-diff envelope。

**After extraction files are ready, dispatch one `file-analyzer` subagent per affected shard using `$PLUGIN_ROOT/agents/file-analyzer.md`**.

Before each dispatch:

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate/sharded/<shardId>"
```

**`file-analyzer` dispatch (sharded update-diff only)** — each dispatch must analyze only that shard's `batchFiles`, write to the shard's `requiredOutputs.fileAnalyzerBatches[0]` path, and include matching `runId`, `headCommitHash`, `shardId`, and `status: "success"`.

Additional context:

```markdown
> **Additional context from main session:**
>
> $LANGUAGE_DIRECTIVE
```

The dispatch prompt must include:

```text
Mode: sharded --update-diff for shard <shardId>.**MUST READ AND FOLLOW `$PLUGIN_ROOT/agents/file-analyzer.md` BEFORE WORK** — use the Sharded `--update-diff` writing section.
Project root: $PROJECT_ROOT
runId: <runId from sharded-update-run.json>
headCommitHash: <headCommitHash from sharded-update-run.json>
shardId: <shardId>
Write output to: $PROJECT_ROOT/.understand-anything/<requiredOutputs.fileAnalyzerBatches[0]> (usually `intermediate/sharded/<shardId>/batch-001.json`)
Pre-extracted structure path: $PROJECT_ROOT/.understand-anything/tmp/ua-file-extract-results-<shardId>.json
Pre-resolved import data: <batchImportData JSON>
Files to analyze: <batchFiles — path, language, sizeLines, fileCategory each>

Field constraints:
- Process: read and use `Pre-extracted structure path` only. Do not run or create scripts.
- Granularity: one node per batch file. `code`/`script`/`markup` → `file:<path>` only — never `function:`/`class:` IDs or type function/class. Non-code: parent node per file (`config`, `document`, `service`, `pipeline`, `schema`, `table`, `endpoint`, `resource`); optional children from non-empty services/endpoints/steps/resources only.
- Node required:
   - `id`: type-prefixed, e.g. file:src/a.ts — no project prefix, no bare paths
   - `type`: file|config|document|service|table|endpoint|pipeline|schema|resource
   - `name`
   - `summary`: non-empty, follow language directive
   - `tags`: 3–5, non-empty; follow language directive
   - `complexity`: simple|moderate|complex
   - `filePath`: = batchFiles[].path
   - `businessSignals`: 0–5, follow language directive, [{type: entry|behavior|rule|display|data|integration, text: 关键业务逻辑，使用产品语言描述}]
- Edge required: `source`, `target`, `type`, `direction` "forward", `weight` (number).
- Code edges only: imports 0.7, depends_on 0.6, tested_by 0.5 — no contains/calls/exports/inherits. For path P, imports edge count MUST equal batchImportData[P].length (one edge per entry; keys use batchFiles[].path).
- Non-code edges when justified: configures 0.6, documents 0.5, deploys 0.7, migrates 0.7, triggers 0.6, defines_schema 0.8, serves 0.7, provisions 0.7, routes 0.6, related 0.5, depends_on 0.6.
- Self-check before writing:
  - imports edge count equals `sum(batchImportData[path].length)` across code files;
  - no `function`/`class` nodes and no `function:`/`class:` ids;
  - every non-external edge target/source exists in produced nodes.
- Envelope required: {runId, headCommitHash, shardId, status:"success", nodes, edges} — or status:"failed" + warning.
- Do not write to intermediate/batch-<n>.json in this mode.
- Output: valid JSON to path above; one node per file; no duplicate ids; no self-edges; reply with counts only (no full JSON in chat).
```

**Do not skip `file-analyzer`; do not simulate it with scripts.**

Read the batch output before assembling. If it is missing, has `status !== "success"`, or does not copy the expected `runId`, `headCommitHash`, and `shardId`, retry that subagent once with the mismatch included as failure context. If the retry fails, write no replacement artifact and continue to Phase 3 so `assemble-shard` can record the failed assemble result for that shard.

## Phase 3 — ASSEMBLE SHARDS

For each shard where `status` is `needs-file-analysis` or `deleted-only`, run:

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT assemble-shard --shard <id>
```

Read the assemble result from `.understand-anything/<requiredOutputs.assembleResult>`.

For `needs-file-analysis`, the assemble step requires the current-run analyzer batch. For `deleted-only`, it prunes deleted file nodes without analyzer dispatch.

If the assemble result has `status: "failed"`, keep the warning and continue checking the remaining affected shards. The later `commit` phase must reject the transaction and must not partially publish other affected shards.

If the assemble result has `status: "success"`, verify that `candidatePath` matches `requiredOutputs.candidateShard` and that the candidate exists. Do not edit the candidate manually.

Candidate shard JSON must not include `layers` or `tour` keys.

## Phase 4 — COMMIT

Run commit once after all affected shards have an assemble result or known failure:

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT commit
```

Read the refreshed manifest at `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.

If any affected shard failed validation, `knowledge-graph.json.update.gitCommitHash` must remain at the previous commit and `update.warnings` must explain the rejection.

If commit succeeds, verify:

- `knowledge-graph.json.update.gitCommitHash === headCommitHash`
- every successful affected shard has refreshed `update.shards[shardId].artifactHash`
- every successful affected shard has a refreshed fingerprint path under `fingerprints/shards/`
- `overview.nodeCount`, `overview.edgeCount`, and shard summaries reflect the published shard artifacts

## Report

Report a concise Chinese summary:

- Affected shard ids
- Shards analyzed by `file-analyzer`
- Deleted-only shards assembled without analyzer dispatch
- `unmappedChangedFiles`
- Warnings from the run record and refreshed manifest
- Whether `knowledge-graph.json.update.gitCommitHash` advanced
- Updated shard paths and manifest path

## Error Handling

- If `plan` fails, stop and report the command error.
- If the run is `blocked`, stop before analyzer dispatch.
- If a `file-analyzer` dispatch fails, retry once for that shard.
- If an analyzer retry still fails, do not synthesize JSON manually; let `assemble-shard` record the failure.
- If `assemble-shard` fails for any affected shard, still run `commit` once so it can reject the transaction consistently.
- If `commit` rejects the transaction, report warnings and do not present any affected shard as updated.
- Never manually advance `knowledge-graph.json.update.gitCommitHash`.

### Run Status Contract

| Status | Meaning |
|---|---|
| `ready` | `plan` mapped changes to shards and the run can proceed. |
| `blocked` | Baseline, manifest, or shard metadata is missing or unsafe. |

### Shard Status Contract

| Status | Meaning |
|---|---|
| `blocked` | The run is blocked, so shard work is blocked too. |
| `needs-file-analysis` | The shard has structural or new-file changes (any existing file in the diff), possibly alongside deletions. |
| `deleted-only` | The shard has deleted files but no structural files. |
| `noop` | The shard is not affected by this run. |

### Assemble Result Status Contract

| Status | Meaning |
|---|---|
| `success` | `assemble-shard` produced a current-run result and, for structural or deleted-only shards, a valid `candidate-shard.json`. |
| `failed` | Analyzer or assembly failed, or required current-run artifacts are missing or stale. |
