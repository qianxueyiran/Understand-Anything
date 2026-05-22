# Update Diff Workflow

This document is the focused contract for `/understand --update-diff`. Keep `SKILL.md` responsible for option parsing and agent dispatch, and keep `sharded-update-workflow.mjs` responsible for validating the `plan`, `assemble-shard`, and `commit` transaction states.

## Non-Sharded Graphs

When `.understand-anything/knowledge-graph.json` is absent or is not `kind: "codebase-sharded"`, the existing non-sharded incremental path remains in effect. `/understand --update-diff` should continue to reuse the legacy changed-file analysis and graph merge flow for ordinary graphs.

## Sharded Graphs

When the root graph is `kind: "codebase-sharded"`, `/understand --update-diff` runs a simplified transaction over all affected shards:

1. Run `plan` to compute one run-scoped diff, map changed files to shards, and write the current sharded update plan.
2. Dispatch `file-analyzer` for every shard marked `needs-file-analysis`.
3. Run `assemble-shard --shard <id>` for each affected shard so the workflow can merge retained shard content with the current-run analyzer output and write a `candidate-shard.json` when a structural candidate exists. Candidates must not include `layers` or `tour` keys.
4. Run `commit [--with-domain] [--with-product]` to validate code shards transactionally. Without downstream flags, a successful commit publishes code shard artifacts/metadata and advances `knowledge-graph.json.update.gitCommitHash`. With downstream flags, code shard artifacts/metadata may be published first while root commit advancement waits for current-run downstream results.

All artifacts written after `plan` must include `runId`, `headCommitHash`, and `shardId`. `commit` rejects artifacts whose run identity does not match the active plan, whose `headCommitHash` is stale, or whose `shardId` belongs to a different affected shard. This applies to analyzer batches, assemble results, `candidate-shard.json`, and downstream current-run result files.

`assemble-shard` must reject missing analyzer output for shards that need file analysis, failed analyzer output, or stale analyzer output from a previous run. For structural or deleted-file shards, a successful assemble result must point to the current run's `candidate-shard.json`; missing candidates, candidate paths outside the required output location, invalid edge endpoints, and candidates that omit required structural file nodes are rejected later by `commit`.

After writing `candidate-shard.json`, `assemble-shard` runs `merge-batch-graphs.py --import-recovery-only --graph <candidate>` so missing `imports` edges are recovered from `scan-result.json` `importMap`. When the candidate path is under `intermediate/sharded/`, targets without a `file:` node in the candidate become `imports` edges with `external: true` (path-only target, no scope-out node). `commit` allows these edges when `external: true` and the source endpoint exists in the candidate; ordinary dangling edges are still rejected. External targets are not refreshed when only another shard's files change and this shard has no structural files in the diff — that lag is acceptable for B-only dependency updates.

`commit` is the only command allowed to advance `knowledge-graph.json.update.gitCommitHash`. It must not partially publish valid shards when another affected shard has a missing, stale, or failed assemble result. With `--with-domain` or `--with-product`, it also validates that requested downstream shards produced a current-run result with matching `runId`, `headCommitHash`, and `shardId`; stale, missing, or failed downstream results keep the root code commit from advancing.

With `--with-domain` or `--with-product`, downstream rebuilds are two-phase. The first `commit [--with-domain] [--with-product]` may commit validated code shard artifacts and metadata and write downstream rebuild planning, but it keeps `knowledge-graph.json.update.gitCommitHash` at the previous commit while downstream work is pending. Then rerun `commit [--with-domain] [--with-product]` after `/understand-domain` and/or `/understand-product` produce current-run result files. That second commit validates downstream results, writes downstream metadata, and advances the root code commit only when every requested current-run result is present and valid.

`plan` records changed source files that cannot be mapped to a shard as `unmappedChangedFiles` and warnings. Treat those as warnings on the run, not as a shard status, and do not rebuild every shard as a fallback.

Classification rule: any file that appears in the git diff and still exists in the workspace is **structural** (including comment-only or formatting-only edits). Deleted files are **deleted-only** when no structural files remain for that shard.

`sharded-update-workflow.mjs` owns plan/assemble/commit validation and is the only workflow code that may decide whether a sharded transaction can advance `knowledge-graph.json.update.gitCommitHash`.

### Orchestration (`/understand`)

Do not follow the legacy non-sharded Phase 2 merge/finalize flow for a sharded root manifest. Execute the steps below, then stop after the sharded update summary. Do not run non-sharded Phase 3 merge, assemble-review, or manifest finalization.

**Supported workflow commands only:** `plan`, `assemble-shard --shard <id>`, `commit [--with-domain] [--with-product]`, and optional `reconcile-warnings`. Legacy commands (`prepare`, `write-batch-existing`, `finalize-code`, `finalize-manifest`, `finalize-downstream`) are removed.

**Workflow script** (run from `$PROJECT_ROOT`; `<SKILL_DIR>` is the understand skill directory):

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT plan
```

Read `.understand-anything/intermediate/sharded-update-run.json`. If `status` is `blocked`, report `warnings` and STOP — ask the user to rerun `/understand --update-diff` after baselines exist.

For each entry in `shards` where `status` is not `noop` or `blocked`:

| Shard status | Actions |
|---|---|
| `needs-file-analysis` | Dispatch `file-analyzer` (see below), then `assemble-shard --shard <id>` |
| `deleted-only` | Skip `file-analyzer`; run `assemble-shard --shard <id>` |

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT assemble-shard --shard <id>
```

**`file-analyzer` dispatch (sharded update-diff only)** — one subagent per `needs-file-analysis` shard; run up to 5 concurrently. Each dispatch must analyze only that shard's `structuralFiles`, write to the shard's `requiredOutputs.fileAnalyzerBatches` path (usually `intermediate/sharded/<shardId>/batch-001.json`), and include matching `runId`, `headCommitHash`, `shardId`, and `status: "success"` (see `agents/file-analyzer.md` — Sharded `--update-diff` writing section):

> **Mode:** sharded `--update-diff` batch for shard `<shardId>`.
> Project root: `$PROJECT_ROOT`
> Run identity (copy verbatim into the output JSON): `runId` = `<runId>`, `headCommitHash` = `<headCommitHash>`, `shardId` = `<shardId>`
> Analyze **only** these structural files: `<structuralFiles JSON array from the shard entry>`
> Write output to: `$PROJECT_ROOT/.understand-anything/<requiredOutputs.fileAnalyzerBatches[0]>` (usually `intermediate/sharded/<shardId>/batch-001.json`)
> Include `status: "success"` on success, or `status: "failed"` with `warning` on failure.
> Construct `batchImportData` only for the structural files above (same rules as full build).
> Follow `agents/file-analyzer.md` — use the **Sharded `--update-diff`** writing section, not `intermediate/batch-<n>.json`.

**Commit and downstream:**

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT commit [--with-domain] [--with-product]
```

If `--with-domain` or `--with-product` was requested and the first commit kept `gitCommitHash` at the previous commit, dispatch `/understand-domain --shard <id>` and/or `/understand-product --shard <id>` only for shard IDs listed in `.understand-anything/intermediate/sharded-downstream-plan.json`, then rerun the same `commit` command after current-run `domain-update-result.json` / `product-update-result.json` files exist (each must include matching `runId`, `headCommitHash`, and `shardId`).

Report the sharded update summary and STOP.

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
