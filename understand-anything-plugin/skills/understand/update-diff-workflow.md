# Update Diff Workflow

This document is the focused shard-only contract for `/understand --update-diff`. It is a workflow fragment, not a skill. The main context reads this file and executes the phases inline.

Keep `SKILL.md` responsible for option parsing and agent dispatch. Keep `sharded-update-workflow.mjs` responsible for validating `plan`, `assemble-shard`, and `commit` transaction states.

## Inputs

- `PROJECT_ROOT` — absolute project root.
- `PLUGIN_ROOT` — absolute Understand Anything plugin root.
- `SKILL_DIR` — `$PLUGIN_ROOT/skills/understand`.
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
- Published shard candidates must not include `layers` or `tour` keys.
- `sharded-update-workflow.mjs` rejects stale, missing, failed, cross-run, and cross-shard artifacts.
- `merge-batch-graphs.py --import-recovery-only` recovers `imports` edges from `scan-result.json` `importMap`; cross-shard targets are preserved as `external: true` imports.
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

For each shard where `status === "needs-file-analysis"`, dispatch one `file-analyzer` subagent. Run up to 5 concurrently.

Skip analyzer dispatch for `deleted-only`, `noop`, and `blocked` shards.

**`file-analyzer` dispatch (sharded update-diff only)** — each dispatch must analyze only that shard's `structuralFiles`, write to the shard's `requiredOutputs.fileAnalyzerBatches[0]` path, and include matching `runId`, `headCommitHash`, `shardId`, and `status: "success"`.

The dispatch prompt must include:

> **Mode:** sharded `--update-diff` batch for shard `<shardId>`.
> MUST READ AND FOLLOW `agents/file-analyzer.md` — use the **Sharded `--update-diff`** writing section.
> Project root: `$PROJECT_ROOT`
> Run identity (copy verbatim into the output JSON): `runId` = `<runId>`, `headCommitHash` = `<headCommitHash>`, `shardId` = `<shardId>`
> Analyze **only** these structural files: `<structuralFiles JSON array from the shard entry>`
> Write output to: `$PROJECT_ROOT/.understand-anything/<requiredOutputs.fileAnalyzerBatches[0]>` (usually `intermediate/sharded/<shardId>/batch-001.json`)
> Include `status: "success"` on success, or `status: "failed"` with `warning` on failure.
> Construct `batchImportData` only for the structural files above (same rules as full build).
> Do not write to `intermediate/batch-<n>.json`.

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
