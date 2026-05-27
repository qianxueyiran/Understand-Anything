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

When the root graph is `kind: "codebase-sharded"`, `/understand --update-diff` runs a simplified transaction over affected code shards:

1. Run `plan` to compute one run-scoped diff, map changed files to shards, and write the current sharded update plan.
2. Dispatch `file-analyzer` for every shard marked `needs-file-analysis`.
3. Run `assemble-shard --shard <id>` for each affected shard so the workflow can merge retained shard content with the current-run analyzer output and write a `candidate-shard.json` when a structural candidate exists. Candidates must not include `layers` or `tour` keys.
4. Run `commit` to validate code shards transactionally. A successful commit publishes code shard artifacts/metadata and advances `knowledge-graph.json.update.gitCommitHash`.

All artifacts written after `plan` must include `runId`, `headCommitHash`, and `shardId`. `commit` rejects artifacts whose run identity does not match the active plan, whose `headCommitHash` is stale, or whose `shardId` belongs to a different affected shard. This applies to analyzer batches, assemble results, and `candidate-shard.json`.

`assemble-shard` must reject missing analyzer output for shards that need file analysis, failed analyzer output, or stale analyzer output from a previous run. For structural or deleted-file shards, a successful assemble result must point to the current run's `candidate-shard.json`; missing candidates, candidate paths outside the required output location, invalid edge endpoints, and candidates that omit required structural file nodes are rejected later by `commit`.

After writing `candidate-shard.json`, `assemble-shard` runs `merge-batch-graphs.py --import-recovery-only --graph <candidate>` so missing `imports` edges are recovered from `scan-result.json` `importMap`. When the candidate path is under `intermediate/sharded/`, targets without a `file:` node in the candidate become `imports` edges with `external: true` (path-only target, no scope-out node). `commit` allows these edges when `external: true` and the source endpoint exists in the candidate; ordinary dangling edges are still rejected. External targets are not refreshed when only another shard's files change and this shard has no structural files in the diff — that lag is acceptable for B-only dependency updates.

`commit` is the only command allowed to advance `knowledge-graph.json.update.gitCommitHash`. It must not partially publish valid shards when another affected shard has a missing, stale, or failed assemble result.

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

| Status | Meaning | Dispatch/commit handling |
|---|---|---|
| `ready` | `plan` mapped changes to shards and the run can proceed. | Dispatch only the shards listed by the plan, then assemble and commit the same `runId`. |
| `blocked` | Baseline, manifest, or shard metadata is missing or unsafe. | Do not dispatch analyzers or commit; report warnings and ask the user to rerun from a trustworthy baseline. |

### Shard Status Contract

| Status | Meaning | Dispatch/commit handling |
|---|---|---|
| `blocked` | The run is blocked, so shard work is blocked too. | Do not dispatch analyzers, assemble, or commit this shard. |
| `needs-file-analysis` | The shard has structural or new-file changes (any existing file in the diff), possibly alongside deletions. | Dispatch `file-analyzer`, then run `assemble-shard --shard <id>` and require a valid assemble result before commit. |
| `deleted-only` | The shard has deleted files but no structural files. | Run `assemble-shard --shard <id>` so deletion pruning can produce a candidate, then commit. |
| `noop` | The shard is not affected by this run. | Do not dispatch analyzers or assemble; `commit` ignores it. |

### Assemble Result Status Contract

| Status | Meaning | Dispatch/commit handling |
|---|---|---|
| `success` | `assemble-shard` produced a current-run result and, for structural or deleted-only shards, a valid `candidate-shard.json`. | `commit` may publish it after validating `runId`, `headCommitHash`, `shardId`, candidate location, nodes, and edges. |
| `failed` | Analyzer or assembly failed, or required current-run artifacts are missing or stale. | `commit` rejects the transaction and must not partially save other affected shards. |
