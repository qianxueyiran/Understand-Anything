---
name: understand
description: Analyze a scoped codebase shard and maintain the sharded Understand Anything manifest
argument-hint: ["[path] [--scope <paths> --shard <id>] [--update-diff] [--auto-update|--no-auto-update] [--language <lang>]"]
---

# /understand

`/understand` 的正式流程是 shard-only。根 `knowledge-graph.json` 是 sharded manifest；代码图正文写入 `.understand-anything/shards/<id>.json`。

## Supported Commands

- `/understand --scope <paths> --shard <id>` — 生成或重建一个 code shard。
- `/understand --scope <paths> --shard <id> --full` — 同上，`--full` 只表示强制重建该 shard。
- `/understand --update-diff` — 对已有 `kind: "codebase-sharded"` manifest 执行 sharded file-level incremental update。
- `/understand --auto-update` / `/understand --no-auto-update` — 只写 `$PROJECT_ROOT/.understand-anything/config.json`，写完停止。
- `--language <lang>` — 控制自然语言字段输出语言，可与 shard 生成同用。

If the command is not one of the supported forms above, stop and show the supported command list.

## Mandatory Execution Contract

- Treat this skill as a strict workflow contract: run the required phase subagents (`project-scanner`, `file-analyzer`, and `assemble-reviewer`). Do not generate `layers` or `tour` — omit both keys from saved shard graphs.
- Do not replace required subagents with ad hoc scripts, heuristics, or manual JSON assembly. Use scripts only where this skill explicitly names them as phase-internal tools.
- If a required phase fails after the documented retry, 失败两次后停止 and report the failure. Do not continue with a reduced workflow.
- Before Phase 1, process `.understandignore` automatically; 不等待人工确认. Before finishing, report which subagents actually ran and the validation result.

## Phase 0 — Pre-flight

1. **Resolve `PROJECT_ROOT`:**
   - Parse `$ARGUMENTS` for the first non-flag token that is not the value of a known value-taking flag. Ignore values following `--language`, `--scope`, and `--shard`.
   - If a directory path is present, resolve it against the current working directory, verify it exists, and set `PROJECT_ROOT` to the absolute path.
   - If no directory path is present, use the current working directory.
   - If `PROJECT_ROOT` is inside a git worktree, redirect output to the main repository root unless `UNDERSTAND_NO_WORKTREE_REDIRECT=1`.

2. **Resolve `PLUGIN_ROOT`:**
   - Prefer runtime-provided plugin roots.
   - Then try symlink-resolved skill locations and common install paths.
   - Stop with a clear error if no plugin root contains both `package.json` and `pnpm-workspace.yaml`.
   - If `$PLUGIN_ROOT/packages/core/dist/index.js` is missing, run:

   ```bash
   cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @understand-anything/core build
   ```

3. **Write optional configuration and stop if requested alone:**
   - `--auto-update`: merge `{"autoUpdate": true}` into `$PROJECT_ROOT/.understand-anything/config.json`
   - `--no-auto-update`: merge `{"autoUpdate": false}` into `$PROJECT_ROOT/.understand-anything/config.json`
   - If neither `--scope --shard` nor `--update-diff` is present, stop after writing the config.

4. **Resolve output language:**
   - `--language <lang>` accepts ISO 639-1 codes and friendly names.
   - If omitted, reuse `$PROJECT_ROOT/.understand-anything/config.json.outputLanguage` when present.
   - Otherwise default to `zh` (Chinese).
   - Store the selected value back to config when `--language` is provided.

   Language directive for subagents:

   ```markdown
   > **Language directive**: Generate descriptive textual content (`description`、`summary`、`title`、`tags`、`businessSignals[].text`、`languageNotes`、`languageLesson`, and natural-language explanations) in **{language}**. Maintain technical accuracy while using natural, native-level phrasing in the target language. Keep code identifiers, file paths, schema fields, framework/library names, API names, and standard technical keywords in their original language when that preserves accuracy or searchability.
   ```

5. **Resolve command mode:**
   - If `--scope <paths>` and `--shard <id>` are both present, run shard generation.
   - If exactly one of `--scope` or `--shard` is present, stop with a scoped shard argument error.
   - If `--update-diff` is present, require `.understand-anything/knowledge-graph.json` with top-level `kind: "codebase-sharded"`, then follow `skills/understand/update-diff-workflow.md`.
   - Otherwise stop and show the supported command list.

6. **Validate shard arguments for shard generation:**
   - Split `--scope <paths>` by comma, trim entries, and reject empty entries.
   - Treat every scope as project-relative, resolve it against `PROJECT_ROOT`, and reject paths that do not exist or escape `PROJECT_ROOT`.
   - Validate `--shard <id>` with `^[A-Za-z0-9_-]+$`.
   - Store `SHARD_ID`, `SCOPE_PATHS`, and `SCOPE_ROOTS`.

7. **Create working directories:**

   ```bash
   mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate"
   mkdir -p "$PROJECT_ROOT/.understand-anything/tmp"
   ```

## Sharded Update

For `/understand --update-diff`, read and follow **`skills/understand/update-diff-workflow.md`** end-to-end.

The executable workflow is:

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT plan
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT assemble-shard --shard <id>
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT commit
```

Only dispatch `file-analyzer` for shards marked `needs-file-analysis`. Run `assemble-shard` without `file-analyzer` for `deleted-only` shards. Stop after the sharded update summary.

## Phase 0.5 — Ignore Configuration

1. Check `$PROJECT_ROOT/.understand-anything/.understandignore`.
2. If it does not exist, generate a starter file from built-in defaults plus project-local suggestions derived from `.gitignore`.
3. If it already exists, use the current file.
4. 自动继续，不等待人工确认。

Report filtered file counts when the scan result includes `filteredByIgnore > 0`.

## Phase 1 — SCAN

Dispatch `project-scanner` using `agents/project-scanner.md`.

Additional context:

```text
Project root: $PROJECT_ROOT
Scope roots: $SCOPE_ROOTS
Output path: $PROJECT_ROOT/.understand-anything/intermediate/scan-result.json
```

The scanner must:

- include only files under `SCOPE_ROOTS`;
- return file paths relative to `PROJECT_ROOT`;
- include code, config, docs, infra, data, script, and markup files;
- build `importMap` keys for scoped files only;
- resolve import targets against the full repository file list so cross-shard imports can be represented.

After the subagent finishes, read `scan-result.json` and keep:

- project name, description, languages, frameworks;
- file list with `path`, `language`, `sizeLines`, and `fileCategory`;
- `importMap`.

If more than 100 scoped files are found, report that the shard is large and suggest narrower scopes for future runs, then 自动继续.

## Phase 2 — ANALYZE

Batch the Phase 1 file list into groups of **20-30 files each**; aim for about 25 files per batch.

Batching rules:

- keep related non-code files together when possible;
- include every file's `path`, `language`, `sizeLines`, and `fileCategory`;
- construct `batchImportData` from `importMap` for every file in the batch.

Dispatch `file-analyzer` for each batch using `agents/file-analyzer.md`, up to **6 subagents concurrently**. The prompt must include:

```text
Analyze these files and produce GraphNode and GraphEdge objects.
Project root: $PROJECT_ROOT
Project: <projectName>
Languages: <languages>
Batch index: <batchIndex>
Skill directory: <SKILL_DIR>
Write output to: $PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json
Pre-resolved import data: <batchImportData JSON>
Files to analyze: <batch file list>
```

Do not skip `file-analyzer`; do not simulate it with scripts.

After all batches complete, run:

```bash
python <SKILL_DIR>/merge-batch-graphs.py "$PROJECT_ROOT" --preserve-external
```

This writes `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json` and preserves cross-shard `imports` edges.

## Phase 3 — ASSEMBLE REVIEW

Dispatch `assemble-reviewer` using `agents/assemble-reviewer.md`.

Prompt parameters:

```text
Review graph: $PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json
Batch files: $PROJECT_ROOT/.understand-anything/intermediate/batch-*.json
Review output: $PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json
Merge script report: <full stderr from merge-batch-graphs.py>
Import map: $IMPORT_MAP
```

Read `assemble-review.json` and add notes to `$PHASE_WARNINGS`.

## Phase 4 — VALIDATE

Assemble the shard graph:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<current commit hash>"
  },
  "shard": {
    "id": "<SHARD_ID>",
    "scopes": ["<SCOPE_PATHS entries>"],
    "updatedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<current commit hash>"
  },
  "nodes": [],
  "edges": []
}
```

Delete `layers` and `tour` if present.

Run deterministic validation:

- `nodes` and `edges` must be arrays;
- no `function` or `class` nodes;
- node ids are unique;
- every non-external edge source and target exists;
- external `imports` edges must have a valid source and `external: true`;
- required node fields are present or filled with deterministic defaults.

Write validation results to `$PROJECT_ROOT/.understand-anything/intermediate/review.json`. If validation still has critical issues after one deterministic fix pass, save with warnings and skip downstream launch.

## Phase 5 — SAVE

1. Write the validated shard graph to:

   ```text
   $PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json
   ```

2. Refresh the root manifest:

   ```bash
   python <SKILL_DIR>/refresh-sharded-manifest.py "$PROJECT_ROOT"
   ```

3. Write shard fingerprints to:

   ```text
   $PROJECT_ROOT/.understand-anything/fingerprints/shards/$SHARD_ID.json
   ```

   Use the core fingerprint module where available; do not write a global `fingerprints.json`.

4. Clean up:

   ```bash
   rm -rf "$PROJECT_ROOT/.understand-anything/intermediate"
   rm -rf "$PROJECT_ROOT/.understand-anything/tmp"
   ```

5. Report in Chinese:

   - shard id and scope paths;
   - project name and description;
   - files analyzed with fileCategory breakdown;
   - node and edge counts by type;
   - validation warnings;
   - shard output path;
   - manifest path.

## Error Handling

- Retry each required subagent once with the same prompt plus failure context.
- If the retry fails, 失败两次后停止.
- Report failing phase, subagent name, expected output path, and last error.
- Do not save a graph that is presented as usable after a required phase failed.
- Never silently drop errors.

## Reference: KnowledgeGraph Schema

### Node Types

Code files produce `file` nodes only.

| Type | Description | ID Convention |
|---|---|---|
| `file` | Source code file | `file:<relative-path>` |
| `config` | Configuration file | `config:<relative-path>` |
| `document` | Documentation file | `document:<relative-path>` |
| `service` | Deployable service | `service:<relative-path>` |
| `table` | Database table or migration | `table:<relative-path>:<table-name>` |
| `endpoint` | API endpoint or route | `endpoint:<relative-path>:<endpoint-name>` |
| `pipeline` | CI/CD pipeline | `pipeline:<relative-path>` |
| `schema` | Schema definition | `schema:<relative-path>` |
| `resource` | Infrastructure resource | `resource:<relative-path>` |

Reserved for downstream agents: `module`, `concept`, `domain`, `flow`, `step`.

### Edge Types

Code files emit file-level `imports`, `depends_on`, and `tested_by` edges. Non-code files may emit `configures`, `documents`, `deploys`, `migrates`, `triggers`, `defines_schema`, `serves`, `provisions`, `routes`, and `related`.
