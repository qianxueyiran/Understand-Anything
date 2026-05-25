# Sharded Incremental Simplified Transaction Design

## Context

The first sharded diff/incremental design proved that file-level updates can reduce LLM token usage, but the current workflow is too long and fragile:

```text
prepare
-> write-batch-existing
-> file-analyzer
-> merge-batch-graphs.py
-> architecture-analyzer
-> tour-builder
-> finalize-code
-> finalize-manifest
-> downstream plan
-> understand-domain / understand-product
-> finalize-downstream
```

This creates too many places where a missing step, stale intermediate file, or old downstream artifact can look like a successful update.

The goal of this refinement is to preserve the important token-saving property:

> Only changed structural files should be sent back to LLM agents.

But simplify transaction boundaries:

> Shard updates should be assembled as complete shard candidates, and manifests should be committed exactly once after all requested work is verified.

## Goals

1. Keep `/understand --update-diff` as the user-facing entry point.
2. Do not create a new user-facing update skill.
3. Do not change the non-sharded incremental architecture.
4. In sharded mode, use file-level diff and fingerprinting to minimize LLM input.
5. Replace many manually chained sharded update commands with a small state-machine workflow.
6. Prevent stale intermediate files from being treated as current-run success.
7. Ensure the root sharded manifest commit advances only after all requested code/domain/product work succeeds.
8. Make cosmetic-only changes cheap and safe: update fingerprints, do not rewrite shard artifacts, and do not trigger downstream rebuilds.

## Non-Goals

1. Do not implement topic-level product diff.
2. Do not implement domain flow partial patching.
3. Do not merge all code shards into one giant graph.
4. Do not make `/understand-domain` or `/understand-product` scan all shards by default.
5. Do not remove existing scoped shard full analysis.

## Recommended Shape

The sharded update workflow should be organized around three commands:

```bash
node sharded-update-workflow.mjs <project-root> plan
node sharded-update-workflow.mjs <project-root> assemble-shard --shard <id>
node sharded-update-workflow.mjs <project-root> commit [--with-domain] [--with-product]
```

Historical manual chain (`prepare`, `write-batch-existing`, `finalize-code`, `finalize-manifest`, `finalize-downstream`) is retired. `/understand` and tests use only `plan`, `assemble-shard`, and `commit`.

## Artifact Model

Every sharded update run has a run record:

```text
.understand-anything/intermediate/sharded-update-run.json
```

Example:

```json
{
  "version": "1.0.0",
  "runId": "2026-05-22T03:00:00.000Z-def456",
  "baseCommitHash": "abc123",
  "headCommitHash": "def456",
  "status": "ready",
  "changedFiles": ["a_home/src/Home.kt"],
  "shards": [
    {
      "id": "home",
      "path": "shards/home.json",
      "status": "needs-file-analysis",
      "changedFiles": ["a_home/src/Home.kt"],
      "structuralFiles": ["a_home/src/Home.kt"],
      "cosmeticFiles": [],
      "deletedFiles": [],
      "requiredOutputs": {
        "fileAnalyzerBatches": [
          "intermediate/sharded/home/batch-001.json"
        ],
        "candidateShard": "intermediate/sharded/home/candidate-shard.json",
        "assembleResult": "intermediate/sharded/home/assemble-result.json"
      }
    }
  ],
  "warnings": []
}
```

Every intermediate result produced after `plan` must include:

```json
{
  "runId": "2026-05-22T03:00:00.000Z-def456",
  "headCommitHash": "def456",
  "shardId": "home"
}
```

The `commit` command must reject intermediate files with a missing or mismatched `runId`, `headCommitHash`, or `shardId`.

## Shard Statuses

`plan` assigns each affected shard one explicit status:

| Status | Meaning | LLM Required | Shard Artifact Changes |
|---|---|---:|---:|
| `blocked` | Missing root update baseline, missing fingerprint baseline, invalid shard metadata, or unsafe state | No | No |
| `noop` | No effective changes for this shard | No | No |
| `cosmetic-only` | Content changed, but structural fingerprint did not | No | No |
| `deleted-only` | Files were deleted, but no new structural analysis is needed | No | Yes |
| `needs-file-analysis` | Structural/new files need LLM analysis | Yes, file-level only | Yes |
| `ready-to-assemble` | Required LLM outputs exist and validate | No | Candidate ready |
| `failed` | Any required step failed | No | No commit |

Only `needs-file-analysis` shards consume LLM tokens.

## Phase 1: Plan

`plan` reads:

1. `.understand-anything/knowledge-graph.json`
2. `.understand-anything/shards/<id>.json`
3. `.understand-anything/fingerprints/shards/<id>.json`
4. `git diff <baseCommitHash>..HEAD --name-only`

`baseCommitHash` must come from `knowledge-graph.json.update.gitCommitHash`.

If root update metadata is missing, `plan` may create baseline metadata, but the run must become `blocked` and require a rerun. It must not silently use `HEAD` as base and proceed.

If a shard fingerprint is missing, `plan` may create that shard fingerprint baseline, but that shard must become `blocked` and the run must require a rerun.

Changed files are mapped to shards by:

1. `shards[].scopes`
2. old shard `nodes[].filePath`

Unmapped source files are recorded in `unmappedChangedFiles` and warnings. They must not trigger a rebuild of every shard.

## Phase 2: File-Level LLM

`/understand` remains responsible for dispatching LLM agents. For each shard with `status: "needs-file-analysis"`:

1. Dispatch `file-analyzer`.
2. Provide only that shard's `structuralFiles`.
3. Instruct the agent to produce nodes/edges only for those files.
4. Write batch outputs to the exact paths specified by the run record.
5. Ensure each batch includes `runId`, `headCommitHash`, and `shardId`.

No LLM agent should run for:

1. `cosmetic-only`
2. `deleted-only`
3. `noop`
4. `blocked`

## Phase 3: Assemble Shard

`assemble-shard --shard <id>` replaces the current manual sequence:

```text
write-batch-existing
-> merge-batch-graphs.py
-> finalize-code
```

For `cosmetic-only`:

1. Do not rewrite `.understand-anything/shards/<id>.json`.
2. Update `.understand-anything/fingerprints/shards/<id>.json`.
3. Write `assemble-result.json` with `status: "skipped-cosmetic"` and the old artifact hash.

For `deleted-only`:

1. Read old shard.
2. Remove deleted-file nodes and edges pointing to them.
3. Preserve unchanged nodes and edges.
4. Produce `candidate-shard.json`.
5. Produce `assemble-result.json`.

For `needs-file-analysis`:

1. Validate that all required `batch-*.json` files exist and match the current `runId`.
2. Read old shard.
3. Remove nodes whose `filePath` belongs to `structuralFiles` or `deletedFiles`.
4. Remove edges pointing to removed nodes.
5. Merge retained old graph with new file-analyzer batches.
6. Preserve external edges when appropriate.
7. Validate the merged candidate's nodes and edges.
8. Mark the candidate as `awaiting-structure-review` when refreshed `layers` and `tour` are still needed.

The output paths are:

```text
.understand-anything/intermediate/sharded/<id>/candidate-shard.json
.understand-anything/intermediate/sharded/<id>/assemble-result.json
```

`assemble-shard` does not update root manifests and does not advance commit metadata. For structural candidates, it may produce a candidate before `layers` and `tour` are refreshed; the final guard happens in `commit`.

## Architecture And Tour

Structural shard patches must refresh layer and tour data before commit.

The implementation should keep agent dispatch in `/understand`:

1. `assemble-shard` creates `candidate-shard.json` with merged nodes and edges.
2. `/understand` dispatches `architecture-analyzer` using that candidate's node/edge set.
3. `/understand` dispatches `tour-builder` using the candidate graph and refreshed layers.
4. `/understand` writes refreshed `layers` and `tour` back into `candidate-shard.json`.
5. `commit` validates that structural candidates contain refreshed `layers` and `tour`.

A structural candidate without refreshed `layers` and `tour` must not be committed.

## Phase 4: Commit

`commit` is the only command allowed to write final shard artifacts and advance manifest commit metadata.

It reads:

1. `sharded-update-run.json`
2. per-shard `assemble-result.json`
3. per-shard `candidate-shard.json` when required
4. existing code/domain/product manifests

For each code shard:

1. Reject missing or stale results.
2. Reject results whose `runId`, `headCommitHash`, or `shardId` does not match the run.
3. If `status: "skipped-cosmetic"`, update fingerprint metadata but keep the old shard artifact hash.
4. If candidate exists and validates, write it atomically to `.understand-anything/shards/<id>.json`.
5. Refresh root manifest `overview` and `shards[]` counts from actual shard files.
6. Update `knowledge-graph.json.update.shards[id]`.

If any affected code shard fails, `knowledge-graph.json.update.gitCommitHash` must remain at the previous successful commit.

If all requested work succeeds and there are no downstream flags, `commit` advances `knowledge-graph.json.update.gitCommitHash` to `headCommitHash`.

## Downstream Handling

With `--with-domain`:

1. Rebuild only domain shards whose source code shard artifact hash changed.
2. Call `/understand-domain --shard <id>` for those shard IDs.
3. Require each domain rebuild to produce a current-run result.
4. Update `domain-graph.json.update.shards[id]`.

With `--with-product`:

1. Rebuild only product shards whose source code artifact hash changed.
2. If a domain shard exists, product may use it as context.
3. Call `/understand-product --shard <id>` for those shard IDs.
4. Require each product rebuild to produce a current-run result.
5. Update `product-index.json.update.shards[id]`.

Old domain/product shard files are not proof of success. `commit` must require current-run result metadata before advancing the root code manifest commit.

## Failure Handling

| Failure | Result |
|---|---|
| Missing root update baseline | Create baseline if possible, mark run `blocked`, require rerun |
| Missing shard fingerprint | Create shard baseline if possible, mark shard/run `blocked`, require rerun |
| Missing file-analyzer batch | Mark shard failed, do not commit |
| Stale batch with wrong `runId` | Reject batch, mark shard failed |
| Candidate lacks required nodes for structural files | Mark shard failed |
| Deleted file nodes remain in candidate | Mark shard failed |
| Structural candidate lacks refreshed layers/tour | Mark shard failed |
| Domain rebuild requested but missing current-run result | Do not advance root code commit |
| Product rebuild requested but missing current-run result | Do not advance root code commit |

## Reuse

The simplified design should keep reusing existing non-sharded machinery where possible:

1. `packages/core/src/incremental-update.ts`
   - path normalization
   - graph pruning
   - changed-file classification

2. `packages/core/src/sharded-update.ts`
   - sharded plan helpers
   - manifest update helpers
   - artifact hash helpers

3. `skills/understand/merge-batch-graphs.py`
   - merge and edge normalization
   - external edge preservation in shard mode

4. Existing agents
   - `file-analyzer`
   - `architecture-analyzer`
   - `tour-builder`

The non-sharded update flow remains unchanged.

## `/understand` Contract

`/understand --update-diff` should keep one user-facing entry point.

For non-sharded graphs, it uses the existing non-sharded incremental path.

For `kind: "codebase-sharded"`, it follows the simplified workflow:

```text
plan
-> dispatch file-analyzer for needs-file-analysis shards
-> assemble-shard for affected shards
-> dispatch architecture/tour for structural candidates
-> write refreshed layers/tour back to candidate-shard.json
-> commit [--with-domain] [--with-product]
```

`SKILL.md` should stay thin. Detailed sharded update rules can live in an internal workflow document, for example:

```text
skills/understand/update-diff-workflow.md
```

The user should not need to learn a new skill command.

## Migration Plan

1. Add `plan`, `assemble-shard`, and `commit` commands while keeping old commands. (done)
2. Convert tests to cover the new three-command workflow. (done)
3. Update `/understand` docs to call the new workflow. (done)
4. Keep old commands as aliases for one transition period. (done)
5. Remove old commands after all tests and docs use the new shape. (done)

## Acceptance Criteria

1. A file add/delete/modify run completes with:
   - changed structural files analyzed by LLM only once
   - deleted nodes removed
   - unchanged nodes preserved
   - root manifest counts refreshed
   - commit advanced only on success

2. Cosmetic-only changes:
   - do not rewrite shard artifact
   - update fingerprint
   - do not trigger downstream rebuild

3. Missing baseline/fingerprint:
   - creates baseline if possible
   - blocks the run
   - does not advance commit

4. Stale intermediate files:
   - are rejected by `runId/headCommitHash/shardId` validation

5. Downstream requested work:
   - rebuilds only changed shard IDs
   - requires current-run results
   - blocks root commit advancement on failure

6. Non-sharded incremental tests remain unchanged and passing.
