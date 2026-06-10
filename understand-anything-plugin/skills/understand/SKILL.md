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
- `--language <lang>` — 控制自然语言字段输出语言，可与 shard 生成同用。Defaults to `zh` (Chinese).

If the command is not one of the supported forms above, stop and show the supported command list.

## Mandatory Execution Contract

- Treat this skill as a strict workflow contract: run the required phase subagents (`project-scanner`, `file-analyzer`, and `assemble-reviewer`). 
- Do not replace required subagents with ad hoc scripts, heuristics, or manual JSON assembly. Use scripts only where this skill explicitly names them as phase-internal tools.

## Before Work — Pre-flight

1. **Resolve `PROJECT_ROOT`:**
   - Parse `$ARGUMENTS` for the first non-flag token that is not the value of a known value-taking flag. Ignore values following `--language`, `--scope`, and `--shard`.
   - If a directory path is present, resolve it against the current working directory, verify it exists, and set `PROJECT_ROOT` to the absolute path.
   - If no directory path is present, use the current working directory.
   - If `PROJECT_ROOT` is inside a git worktree, redirect output to the main repository root unless `UNDERSTAND_NO_WORKTREE_REDIRECT=1`.

2. **Resolve `PLUGIN_ROOT`:**
   - set `PLUGIN_ROOT` to `$PROJECT_ROOT/.understand-anything-plugin`

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

5. **Collect project context for subagent injection:**
   - Read `README.md` (or `README.rst`, `readme.md`) from `$PROJECT_ROOT` if it exists. Store as `$README_CONTENT` (first 3000 characters).
   - Read the primary package manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`) if it exists. Store as `$MANIFEST_CONTENT`.
   - Check if `$PROJECT_ROOT/docs/business-glossary.md` exists. If it does, read it in full and store as `$BUSINESS_GLOSSARY`. Otherwise set `$BUSINESS_GLOSSARY` to empty string.

6. **Resolve command mode:**
   - If `--scope <paths>` and `--shard <id>` are both present, run shard generation.
   - If exactly one of `--scope` or `--shard` is present, stop with a scoped shard argument error.
   - If `--update-diff` is present, require `.understand-anything/knowledge-graph.json` with top-level `kind: "codebase-sharded"`, then follow `skills/understand/update-diff-workflow.md`.
   - Otherwise stop and show the supported command list.

7. **Validate shard arguments for shard generation:**
   - Split `--scope <paths>` by comma, trim entries, and reject empty entries.
   - Treat every scope as project-relative, resolve it against `PROJECT_ROOT`, and reject paths that do not exist or escape `PROJECT_ROOT`.
   - Validate `--shard <id>` with `^[A-Za-z0-9_-]+$`.
   - Store `SHARD_ID`, `SCOPE_PATHS`, `SCOPE_PATHS_JSON`, and `SCOPE_ROOTS`.
   - Set `SCOPE_PATHS_JSON` by JSON-encoding the validated `SCOPE_PATHS` array. It must be a non-empty JSON array, for example `["app/a_boot"]`; never use `[]` for code shard generation.

8. **Create working directories:**

   ```bash
   mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate"
   mkdir -p "$PROJECT_ROOT/.understand-anything/tmp"
   ```


## If Update Shard

For `/understand --update-diff`, **read and follow `skills/understand/update-diff-workflow.md`** end-to-end.

The executable workflow is:

```bash
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT plan
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT assemble-shard --shard <id>
node <SKILL_DIR>/sharded-update-workflow.mjs $PROJECT_ROOT commit
```

Only dispatch `file-analyzer` for shards marked `needs-file-analysis`. Run `assemble-shard` without `file-analyzer` for `deleted-only` shards. Stop after the sharded update summary.

## IF Generate new Shard

For `/understand --scope <paths> --shard <id>`, **read and execute `skills/understand/code-shard-workflow.md`** in **the main context** after Pre-flight sets:

- `PROJECT_ROOT`
- `PLUGIN_ROOT`
- `SKILL_DIR=$PLUGIN_ROOT/skills/understand`
- `SHARD_ID`
- `SCOPE_PATHS`
- `SCOPE_PATHS_JSON`
- `SCOPE_ROOTS`
- `OUTPUT_LANGUAGE`
- `LANGUAGE_DIRECTIVE`
- `README_CONTENT`
- `MANIFEST_CONTENT`
- `BUSINESS_GLOSSARY`

`skills/understand/code-shard-workflow.md` owns scan, batch analysis, merge, assemble review, validation, save, manifest refresh, `.understandignore` handling, and required-subagent retry rules. Keep those phase details in that shared workflow file instead of duplicating them here.

After the shared workflow completes, report the shard output path and refreshed manifest path in Chinese.

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
