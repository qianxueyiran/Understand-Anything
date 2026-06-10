# Auto-Update Knowledge Graph (Internal Hook)

本 hook 只支持 codebase-sharded 的 shard-only code graph，等价于执行 `/understand --update-diff`。

它由 post-commit hook 在 `autoUpdate` 启用时触发，不是面向用户的 skill。

---

## Phase 0 — Pre-flight

1. Set `PROJECT_ROOT` to the current working directory.

2. Read `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.
   - If it does not exist: report `Auto-update requires codebase-sharded manifest. Run /understand --scope <paths> --shard <id> first.` and **STOP**.
   - If top-level `kind !== "codebase-sharded"`: report the same message and **STOP**.

3. Read `knowledge-graph.json.update.gitCommitHash`.
   - If missing, build baseline update metadata from the existing `shards[]` entries before planning the diff.

4. Get current commit hash:
   ```bash
   git rev-parse HEAD
   ```

5. If the manifest commit hash matches the current commit and `--force` is not present in `$ARGUMENTS`, report `Knowledge graph is already up to date.` and **STOP**.

---

## Phase 1 — Plan Sharded Update

Run the sharded update workflow planner:

```bash
node <plugin>/skills/understand/sharded-update-workflow.mjs plan --project-root "$PROJECT_ROOT"
```

Read the generated run record from `.understand-anything/intermediate/`.

The planner maps changed files to affected shard ids, computes file-level decisions, and records the exact shard write plan. Treat that run record as the source of truth for all later phases.

---

## Phase 2 — Re-Analyze Affected Files

Follow `skills/understand/update-diff-workflow.md` Phase 2 end-to-end. Each affected shard uses one batch (`batch-001`), tmp paths keyed by `<shardId>`, and sharded envelope output.

Process each shard plan entry from the run record:

- `noop`: skip the shard.
- `deleted-only`: run the assemble step for the shard so removed file nodes and dangling edges are pruned.
- `needs-file-analysis`:
  1. Build `batchFiles` / `batchImportData` from deterministic scan scoped to shard `scopes`, filtered to `structuralFiles`.
  2. Run `extract-structure.mjs` in the main context for that shard.
  3. Dispatch `file-analyzer` with `Pre-extracted structure path` and the sharded update-diff envelope contract.
  4. Run the assemble step for that shard.

When dispatching `file-analyzer`, include:

- Project root: `$PROJECT_ROOT`
- Run identity: `runId`, `headCommitHash`, `shardId`
- Pre-extracted structure path: `.understand-anything/tmp/ua-file-extract-results-<shardId>.json`
- Pre-resolved import data and batch file list
- Output path: shard `requiredOutputs.fileAnalyzerBatches[0]`

Analyze only the files listed in `structuralFiles`. Do not run `extract-structure.mjs` inside the subagent.

---

## Phase 3 — Commit Sharded Outputs

Run the sharded update commit step after all affected shard entries are processed:

```bash
node <plugin>/skills/understand/sharded-update-workflow.mjs commit --project-root "$PROJECT_ROOT"
```

The commit step updates:

- `.understand-anything/shards/<id>.json`
- `.understand-anything/knowledge-graph.json`
- `.understand-anything/intermediate/` run metadata

Do not rebuild domain or product artifacts from this hook.

---

## Phase 4 — Report

Report a concise summary:

- Affected shard ids
- Files analyzed
- Deleted files pruned
- Warnings from the run record
- Updated `knowledge-graph.json.update.gitCommitHash`

If any shard failed after one retry, report the failing shard id and preserve the run record for debugging.

---

## Error Handling

- If planning fails, stop and report the planner error.
- If a `file-analyzer` dispatch fails, retry once for that shard.
- If assembly or commit fails, stop and report the failing step.
- Never write a partial manifest without the commit step succeeding.
