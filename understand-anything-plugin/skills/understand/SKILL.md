---
name: understand
description: Analyze a codebase to produce an interactive knowledge graph for understanding architecture, components, and relationships
argument-hint: ["[path] [--full|--update-diff|--auto-update|--no-auto-update|--review|--language <lang>|--scope <paths>|--shard <id>]"]
---

# /understand

Analyze the current codebase and produce a `knowledge-graph.json` file in `.understand-anything/`. This file powers the interactive dashboard for exploring the project's architecture.

## Mandatory Execution Contract

- Treat this skill as a strict workflow contract: run the required phase subagents (`project-scanner`, `file-analyzer`, `assemble-reviewer`, and `graph-reviewer` when requested). Do not generate `layers` or `tour` — omit both keys from saved `knowledge-graph.json` (and shard graphs).
- Do not replace required subagents with ad hoc scripts, heuristics, or manual JSON assembly. Use scripts only where this skill explicitly names them as phase-internal tools.
- If a required phase fails after the documented retry, stop and report the failure; continue with a reduced workflow only after explicit user approval.
- Before Phase 1, honor `.understandignore` confirmation; before finishing, report which subagents actually ran and the validation result.

## Options

- `$ARGUMENTS` may contain:
  - `--full` — Force a full rebuild, ignoring any existing graph
  - `--update-diff` — 显式根据 git diff 更新既有 graph。普通 `knowledge-graph.json` 复用现有非分片增量路径；当根 graph 为 `kind: "codebase-sharded"` 时，只执行 code shard 的 sharded file-level incremental（分片文件级增量）并一次性更新所有受影响 code shards。
  - `--auto-update` — Enable automatic graph updates on commit (writes `autoUpdate: true` to `.understand-anything/config.json`)
  - `--no-auto-update` — Disable automatic graph updates (writes `autoUpdate: false` to `.understand-anything/config.json`)
  - `--review` — Run full LLM graph-reviewer instead of inline deterministic validation
  - `--language <lang>` — Generate descriptive textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in the specified language. Accepts ISO 639-1 codes (`zh`, `ja`, `ko`, `en`, `es`, `fr`, `de`, etc.) or friendly names (`chinese`, `japanese`, `korean`, `english`, `spanish`, etc.). Locale variants supported: `zh-TW`, `zh-HK`, etc. Defaults to `zh` (Chinese). Stores preference in `.understand-anything/config.json` for consistency across incremental updates. Code identifiers, file paths, API names, framework/library names, schema fields, and standard technical keywords should remain in their original language when that preserves accuracy and searchability.
  - `--scope <paths>` — Only analyze comma-separated project-relative paths; pair with `--shard` to generate a shard.
  - `--shard <id>` — Save scoped analysis to `.understand-anything/shards/<id>.json`; requires `--scope`; id may contain only letters, numbers, `_`, and `-`.
  - A directory path (e.g. `/path/to/repo` or `../other-project`) — Analyze the given directory instead of the current working directory

---

## Phase 0 — Pre-flight

Determine whether to run a full analysis or incremental update.

1. **Resolve `PROJECT_ROOT`:**
   - Parse `$ARGUMENTS` for the first non-flag token that is not the value of a known value-taking flag. When resolving the directory path, ignore these flags and their immediately following values: `--language <lang>`, `--scope <paths>`, and `--shard <id>`. If a remaining non-flag token is found, treat it as the target directory path.
     - If the path is relative, resolve it against the current working directory.
     - Verify the resolved path exists and is a directory (run `test -d <path>`). If it does not exist or is not a directory, report an error to the user and **STOP**.
     - Set `PROJECT_ROOT` to the resolved absolute path.
   - If no directory path argument is found, set `PROJECT_ROOT` to the current working directory.
   - If both a directory path argument and `--scope` are provided, scope entries are still project-relative paths resolved against the final `PROJECT_ROOT`.
   - **Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — `.understand-anything/` written there is destroyed when the session ends, taking the knowledge graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

     ```bash
     COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
     GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
     if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
       COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
       GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
       if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
         MAIN_ROOT=$(dirname "$COMMON_ABS")
         if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
           echo "[understand] Detected git worktree at $PROJECT_ROOT"
           echo "[understand] Redirecting output to main repo root: $MAIN_ROOT"
           echo "[understand] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
           PROJECT_ROOT="$MAIN_ROOT"
         fi
       fi
     fi
     ```

     Set `UNDERSTAND_NO_WORKTREE_REDIRECT=1` if you intentionally want a per-worktree graph (rare — most users want the redirect).
1.5. **Ensure the plugin is built.** Later phases invoke Node scripts that import `@understand-anything/core`. On a fresh install `packages/core/dist/` does not exist yet — build once.

   **Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/understand` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

   Resolve the plugin root like this:

   ```bash
   SKILL_REAL=$(realpath ~/.agents/skills/understand 2>/dev/null || readlink -f ~/.agents/skills/understand 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand 2>/dev/null || readlink -f ~/.copilot/skills/understand 2>/dev/null || echo "")
   COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

   PLUGIN_ROOT=""
   for candidate in \
     "${CLAUDE_PLUGIN_ROOT}" \
     "$HOME/.understand-anything-plugin" \
     "$SELF_RELATIVE" \
     "$COPILOT_SELF_RELATIVE" \
     "$HOME/.codex/understand-anything/understand-anything-plugin" \
     "$HOME/.opencode/understand-anything/understand-anything-plugin" \
     "$HOME/.pi/understand-anything/understand-anything-plugin" \
     "$HOME/understand-anything/understand-anything-plugin"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
       PLUGIN_ROOT="$candidate"
       break
     fi
   done

   if [ -z "$PLUGIN_ROOT" ]; then
     echo "Error: Cannot find the understand-anything plugin root."
     echo "Checked:"
     echo "  - ${CLAUDE_PLUGIN_ROOT:-<unset CLAUDE_PLUGIN_ROOT>}"
     echo "  - $HOME/.understand-anything-plugin"
     echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand>}"
     echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand>}"
     echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
     echo "  - $HOME/understand-anything/understand-anything-plugin"
     echo "Make sure the plugin is installed correctly."
     exit 1
   fi

   if [ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]; then
     cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @understand-anything/core build
   fi
   ```

   If `pnpm` is missing, report to the user: "Install Node.js ≥ 22 and pnpm ≥ 10, then re-run `/understand`."

2. Get the current git commit hash:
   ```bash
   git rev-parse HEAD
   ```
3. Create the intermediate and temp output directories:
   ```bash
   mkdir -p $PROJECT_ROOT/.understand-anything/intermediate
   mkdir -p $PROJECT_ROOT/.understand-anything/tmp
   ```
3.5. **Auto-update configuration:**
    - If `--auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": true}` to `$PROJECT_ROOT/.understand-anything/config.json`
    - If `--no-auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": false}` to `$PROJECT_ROOT/.understand-anything/config.json`
    - These flags only set the config — analysis proceeds normally regardless.

3.6. **Language configuration:**
    - Parse `$ARGUMENTS` for `--language <lang>` flag. If found, extract the language code.
    - **Language code normalization:** Map friendly names to ISO codes:
      - `chinese` → `zh`, `japanese` → `ja`, `korean` → `ko`, `english` → `en`, `spanish` → `es`, `french` → `fr`, `german` → `de`, `portuguese` → `pt`, `russian` → `ru`, `arabic` → `ar`, etc.
      - Locale variants: `zh-TW`, `zh-HK`, `zh-CN`, `pt-BR`, etc. are preserved as-is.
    - If `--language` is NOT specified:
      - Check `$PROJECT_ROOT/.understand-anything/config.json` for an existing `outputLanguage` field. If present, use that.
      - If no stored preference, default to `zh` (Chinese).
    - If `--language` IS specified:
      - Update `$PROJECT_ROOT/.understand-anything/config.json` with the new language: merge `{"outputLanguage": "<lang>"}` into existing config.
      - Store as `$OUTPUT_LANGUAGE` for use throughout all phases.
    - **Language directive template:** Store as `$LANGUAGE_DIRECTIVE`:
      ```markdown
      > **Language directive**: Generate descriptive textual content (`description`、`summary`、`title`、`tags`、`businessSignals[].text`、`languageNotes`、`languageLesson`, and natural-language explanations) in **{language}**. Maintain technical accuracy while using natural, native-level phrasing in the target language. Keep code identifiers, file paths, schema fields, framework/library names, API names, and standard technical keywords in their original language when that preserves accuracy or searchability (e.g., "middleware", "hook", "barrel"). For Chinese: write `summary`, `tags`, and `businessSignals[].text` in Chinese unless no natural translation exists for a standard technical tag.
      ```

3.7. **Scoped shard configuration:**
    - Parse `$ARGUMENTS` for `--scope <paths>` and `--shard <id>`.
    - If exactly one of `--scope` or `--shard` is present, report an error and **STOP**. Scoped shard mode requires both flags.
    - If neither flag is present, set `SCOPED_SHARD_MODE=false` and continue the existing full/incremental flow.
    - If both flags are present:
      - Split `--scope <paths>` by comma, trim each item, and reject empty items.
      - Treat every scope item as project-relative, resolve it against `$PROJECT_ROOT`, and store the original trimmed values as `$SCOPE_PATHS`.
      - Reject any scope whose resolved path does not exist.
      - Reject any scope whose resolved path is outside `$PROJECT_ROOT`.
      - Validate `$SHARD_ID` with `^[A-Za-z0-9_-]+$`; if it fails, report an error and **STOP**.
      - Set `SCOPED_SHARD_MODE=true`, `SHARD_ID=<id>`, `SCOPE_PATHS=<trimmed comma-separated project-relative paths>`, and `SCOPE_ROOTS=<absolute resolved scope roots>`.
      - Scoped shard mode runs scoped full analysis, restricts scanning to the configured scope roots, and saves to the shard output path in Phase 5.

4. **Check for subdomain knowledge graphs to merge:**
   List all `*knowledge-graph*.json` files in `$PROJECT_ROOT/.understand-anything/` **excluding** `knowledge-graph.json` itself (e.g. `frontend-knowledge-graph.json`, `backend-knowledge-graph.json`). If any subdomain graphs exist, run the merge script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
   ```bash
   python <SKILL_DIR>/merge-subdomain-graphs.py $PROJECT_ROOT
   ```
   The script discovers subdomain graphs, loads the existing `knowledge-graph.json` as a base (if present), and merges everything into `knowledge-graph.json` (deduplicating nodes and edges). Report the merge summary to the user, then continue with the merged graph.

5. Check if `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` exists. If it does, read it.
6. Check if `$PROJECT_ROOT/.understand-anything/meta.json` exists. If it does, read it to get `gitCommitHash`.
7. **Decision logic:**

   | Condition | Action |
   |---|---|
   | `SCOPED_SHARD_MODE=true` | Always run scoped full analysis for the requested scope roots. Ignore existing main `knowledge-graph.json` / `meta.json` state for unchanged, incremental, and review-only decisions. `--review` does not change this scoped shard rebuild decision; it only controls whether Phase 4 uses the LLM reviewer. |
   | `--full` flag in `$ARGUMENTS` | Full analysis (all phases) |
   | `--update-diff` + existing graph `kind !== "codebase-sharded"` | Existing non-sharded incremental update path |
   | `--update-diff` + existing graph `kind === "codebase-sharded"` | Sharded file-level incremental update. Compute one global git diff, map changed files to affected code shards, patch every affected code shard, refresh the code manifest, and advance `knowledge-graph.json.update.gitCommitHash` after code shard work succeeds. Product/domain refresh is handled by `/understand-refresh`, not by `/understand`. |
   | No existing graph or meta | Full analysis (all phases) |
   | `--review` flag + existing graph + unchanged commit hash | Skip to Phase 4 (review-only — reuse existing assembled graph) |
   | Existing graph + unchanged commit hash | Ask the user: "The graph is up to date at this commit. Would you like to: **(a)** run a full rebuild (`--full`), **(b)** run the LLM graph reviewer (`--review`), or **(c)** do nothing?" Then follow their choice. If they pick (c), STOP. |
   | Existing graph + changed files | Incremental update (re-analyze changed files only) |

   The review-only and incremental paths below apply only when `SCOPED_SHARD_MODE=false`.

   **Sharded file-level incremental path (`--update-diff` + `kind: "codebase-sharded"`):** This branch is separate from the existing non-sharded incremental flow. Do not run the legacy non-sharded Phase 3 merge/finalize path for a sharded root manifest. `/understand` delegates detailed sharded update rules to `skills/understand/update-diff-workflow.md`.

   Read and follow **`skills/understand/update-diff-workflow.md`** end-to-end (orchestration steps, dispatch prompts, status contracts). STOP after the sharded update summary. Do not continue into the non-sharded phases below.

   **Review-only path:** Copy the existing `knowledge-graph.json` to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`, then jump directly to Phase 4 step 3.

   For incremental updates, get the changed file list:
   ```bash
   git diff <lastCommitHash>..HEAD --name-only
   ```
   If this returns no files, report "Graph is up to date" and STOP.

8. **Collect project context for subagent injection:**
   - Read `README.md` (or `README.rst`, `readme.md`) from `$PROJECT_ROOT` if it exists. Store as `$README_CONTENT` (first 3000 characters).
   - Read the primary package manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`) if it exists. Store as `$MANIFEST_CONTENT`.
   - Capture the top-level directory tree:
     ```bash
     find $PROJECT_ROOT -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -100
     ```
     Store as `$DIR_TREE`.
   - Detect the project entry point by checking for common patterns (in order): `src/index.ts`, `src/main.ts`, `src/App.tsx`, `index.js`, `main.py`, `manage.py`, `app.py`, `wsgi.py`, `asgi.py`, `run.py`, `__main__.py`, `main.go`, `cmd/*/main.go`, `src/main.rs`, `src/lib.rs`, `src/main/java/**/Application.java`, `Program.cs`, `config.ru`, `index.php`. Store first match as `$ENTRY_POINT`.

---

## Phase 0.5 — Ignore Configuration

Set up and verify the `.understandignore` file before scanning.

1. Check if `$PROJECT_ROOT/.understand-anything/.understandignore` exists.
2. **If it does NOT exist**, generate a starter file:
   - Run the following Node.js one-liner in `$PROJECT_ROOT` (reads `.gitignore` and deduplicates against built-in defaults):
     ```bash
     node -e "
     const fs = require('fs');
     const path = require('path');
     const root = process.cwd();
     const defaults = ['node_modules/','node_modules','.git/','vendor/','venv/','.venv/','__pycache__/','dist/','dist','build/','build','out/','coverage/','coverage','.next/','.cache/','.turbo/','target/','obj/','*.lock','package-lock.json','yarn.lock','pnpm-lock.yaml','*.png','*.jpg','*.jpeg','*.gif','*.svg','*.ico','*.woff','*.woff2','*.ttf','*.eot','*.mp3','*.mp4','*.pdf','*.zip','*.tar','*.gz','*.min.js','*.min.css','*.map','*.generated.*','.idea/','.vscode/','LICENSE','.gitignore','.editorconfig','.prettierrc','.eslintrc*','*.log'];
     const norm = p => p.replace(/\/+$/, '');
     const defaultSet = new Set(defaults.map(norm));
     const header = '# .understandignore — patterns for files/dirs to exclude from analysis\n# Syntax: same as .gitignore (globs, # comments, ! negation, trailing / for dirs)\n# Lines below are suggestions — uncomment to activate.\n# Use ! prefix to force-include something excluded by defaults.\n#\n# Built-in defaults (always excluded unless negated):\n#   node_modules/, .git/, dist/, build/, obj/, *.lock, *.min.js, etc.\n#\n';
     let body = '';
     const gitignorePath = path.join(root, '.gitignore');
     if (fs.existsSync(gitignorePath)) {
       const gi = fs.readFileSync(gitignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).filter(p => !defaultSet.has(norm(p)));
       if (gi.length) { body += '# --- From .gitignore (uncomment to exclude) ---\n\n' + gi.map(p => '# ' + p).join('\n') + '\n\n'; }
     }
     const dirs = ['__tests__','test','tests','fixtures','testdata','docs','examples','scripts','migrations','.storybook'];
     const found = dirs.filter(d => fs.existsSync(path.join(root, d)));
     if (found.length) { body += '# --- Detected directories (uncomment to exclude) ---\n\n' + found.map(d => '# ' + d + '/').join('\n') + '\n\n'; }
     body += '# --- Test file patterns (uncomment to exclude) ---\n\n# *.test.*\n# *.spec.*\n# *.snap\n';
     const outDir = path.join(root, '.understand-anything');
     if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
     fs.writeFileSync(path.join(outDir, '.understandignore'), header + body);
     "
     ```
   - Report to the user:
     > Generated `.understand-anything/.understandignore` with suggested exclusions based on your project structure. Please review it and uncomment any patterns you'd like to exclude from analysis. When ready, confirm to continue.
   - **Wait for user confirmation before proceeding.**
3. **If it already exists**, report:
   > Found `.understand-anything/.understandignore`. Review it if needed, then confirm to continue.
   - **Wait for user confirmation before proceeding.**
4. After confirmation, proceed to Phase 1.

---

## Phase 1 — SCAN (Full rebuild and scoped shard only)

Dispatch a subagent using the `project-scanner` agent definition (at `agents/project-scanner.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Package manifest:
> ```
> $MANIFEST_CONTENT
> ```
>
> Use this context to produce more accurate project name, description, and framework detection. The README and manifest are authoritative — prefer their information over heuristics.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Scan this project directory to discover all project files (including non-code files like configs, docs, infrastructure), detect languages and frameworks.
> Project root: `$PROJECT_ROOT`
> Scope mode: `$SCOPED_SHARD_MODE`
> Scope roots: `$SCOPE_ROOTS`
> If scope mode is true, include only files under these scope roots in `files`. Returned file paths must still be relative to `$PROJECT_ROOT`.
> In scope mode, build `importMap` keys for scope files only, but resolve import targets against the **full repository** file list so cross-scope dependencies appear in `importMap` values.
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` to get:
- Project name, description
- Languages, frameworks
- File list with line counts and `fileCategory` per file (`code`, `config`, `docs`, `infra`, `data`, `script`, `markup`)
- Complexity estimate
- Import map (`importMap`): pre-resolved project-internal imports per file (non-code files have empty arrays)

Store `importMap` in memory as `$IMPORT_MAP` for use in Phase 2 batch construction.
Store the file list as `$FILE_LIST` with `fileCategory` metadata for use in Phase 2 batch construction.

**Gate check:** If >100 files, inform the user and suggest scoping with a subdirectory argument. Proceed only if user confirms or add guidance that this may take a while.

If the scan result includes `filteredByIgnore > 0`, report:
> Excluded {filteredByIgnore} files via `.understandignore`.

---

## Phase 2 — ANALYZE

### Full analysis path

Batch the file list from Phase 1 into groups of **20-40 files each** (aim for ~30 files per batch for balanced sizes).

**Batching strategy for non-code files:**
- Group related non-code files together in the same batch when possible:
  - Dockerfile + docker-compose.yml + .dockerignore → same batch
  - SQL migration files → same batch (ordered by filename)
  - CI/CD config files (.github/workflows/*) → same batch
  - Documentation files (docs/*.md) → same batch
- This allows the file-analyzer to create cross-file edges (e.g., docker-compose `depends_on` Dockerfile)
- Non-code files can be mixed with code files in the same batch if batch sizes are small
- Each file's `fileCategory` from Phase 1 must be included in the batch file list

**注意：无论什么原因，不允许跳过使用subagent执行file-analyzer的步骤！如果运行遇到问题，尝试解决，如果无法解决，停下来寻求帮助！不允许使用脚本模拟执行！**

For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Run up to **8 subagents concurrently** using parallel dispatch. Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Before dispatching each batch, construct `batchImportData` from `$IMPORT_MAP`:
```json
batchImportData = {}
for each file in this batch:
  batchImportData[file.path] = $IMPORT_MAP[file.path] ?? []
```

Fill in batch-specific parameters below and dispatch:

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch index: `<batchIndex>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json`
>
> Pre-resolved import data for this batch (use this for all import edge creation — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...

After ALL batches complete, run the merge-and-normalize script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):

Full mode:
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

Scoped shard mode (same staging path as full mode; retain cross-shard `imports` edges):
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT --preserve-external
```

Both modes write Phase 2 output to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`. Do **not** pass `--output` to `shards/$SHARD_ID.json` here — Phase 3/4 review and validate the intermediate staging file; Phase 5 publishes the final shard graph.

This script reads all `batch-*.json` files from `$PROJECT_ROOT/.understand-anything/intermediate/`, then in one pass:
- Combines all nodes and edges across batches
- Normalizes node IDs (strips double prefixes, project-name prefixes, adds missing prefixes)
- Normalizes complexity values (`low`→`simple`, `medium`→`moderate`, `high`→`complex`, etc.)
- Rewrites edge references to match corrected node IDs
- Deduplicates nodes by ID (keeps last occurrence) and edges by `(source, target, type)`
- Drops dangling edges referencing missing nodes (except cross-shard `imports` when `--preserve-external` is set)
- Logs all corrections and dropped items to stderr

The merge script also runs a `tested_by` linker that canonicalizes test-coverage edges in two passes. **Pass 1** walks LLM-emitted `tested_by` edges and flips inverted ones in place (the LLM systematically emits `test → production` because it sees the import only when analyzing the test file); semantically broken edges (test↔test, prod↔prod, orphan endpoints) are dropped. **Pass 2** supplements with path-convention pairings (`X.ts` ↔ `X.test.ts`, JS/TS `__tests__/` and `<dir>/test/` walk-out, Python in-package `tests/`, Go `_test.go` sibling, Maven/Gradle `src/test/...` ↔ `src/main/...`, .NET `<svc>/tests/` ↔ `<svc>/src/...` and `<App>.Tests/` ↔ `<App>/`). Production nodes that end up sourcing any `tested_by` edge get a `"tested"` tag. All resulting edges run `production → test`.

Output: `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`

Include the script's warnings in `$PHASE_WARNINGS` for the reviewer.

### Incremental update path

This path applies only when `SCOPED_SHARD_MODE=false`. Scoped shard mode always runs scoped full analysis for the requested scope roots and does not use the main graph incremental update path.

Use the changed files list from Phase 0. Batch and dispatch file-analyzer subagents using the same process as above (20-30 files per batch, up to 5 concurrent, with batchImportData constructed from $IMPORT_MAP), but only for changed files.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the same merge script — it will combine `batch-existing.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```

### Sharded file-level incremental update path

For sharded `--update-diff`, do not follow the legacy non-sharded Phase 2 merge/finalize flow. Read and follow **`skills/understand/update-diff-workflow.md`** end-to-end, then stop after the sharded update summary.

---

## Phase 3 — ASSEMBLE REVIEW

Dispatch a subagent using the `assemble-reviewer` agent definition (at `agents/assemble-reviewer.md`).

Pass these parameters in the dispatch prompt:

> Review the assembled graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Batch files are at: `$PROJECT_ROOT/.understand-anything/intermediate/batch-*.json`
> Write review output to: `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json`
>
> **Merge script report:**
> ```
> <paste the full stderr output from merge-batch-graphs.py>
> ```
>
> **Import map for cross-batch edge verification:**
> ```json
> $IMPORT_MAP
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json` and add any notes to `$PHASE_WARNINGS`.

---

## Phase 4 — REVIEW

Assemble the full KnowledgeGraph JSON object:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  },
  "nodes": [<all nodes from assembled-graph.json after Phase 3 review>],
  "edges": [<all edges from assembled-graph.json after Phase 3 review>]
}
```

Do not include `layers` or `tour` top-level keys.

In scoped shard mode, add top-level shard metadata before saving:

```json
{
  "shard": {
    "id": "<SHARD_ID>",
    "scopes": ["<SCOPE_PATHS entries>"],
    "updatedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  }
}
```

1. Before writing the assembled graph, **delete** top-level `layers` and `tour` if present (from older graphs or review-only copies). Saved graphs must contain only `version`, `project`, `nodes`, and `edges` (plus `shard` metadata in scoped shard mode).

   Validate `nodes` and `edges` only. If validation fails, automatically normalize and rewrite the graph before saving. If the graph still fails final validation after the normalization pass, save it with warnings but mark dashboard auto-launch as skipped.

2. Write the assembled graph to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.

3. **Check `$ARGUMENTS` for `--review` flag.** Then run the appropriate validation path:

---

#### Default path (no `--review`): inline deterministic validation

Write the following Node.js script to `$PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.cjs`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (n.type === 'function' || n.type === 'class') {
      issues.push(`Symbol node '${n.id}' (type: ${n.type}) must not exist in file-only graphs`);
    }
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  delete graph.layers;
  delete graph.tour;
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
  };
  fs.writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));
  process.exit(0);
} catch (err) { process.stderr.write(err.message + '\n'); process.exit(1); }
```

Execute it:
```bash
node $PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.cjs \
  "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/review.json"
```

If the script exits non-zero, read stderr, fix the script, and retry once.

---

#### `--review` path: full LLM reviewer

If `--review` IS in `$ARGUMENTS`, dispatch the LLM graph-reviewer subagent as follows:

Dispatch a subagent using the `graph-reviewer` agent definition (at `agents/graph-reviewer.md`). Append the following additional context:

> **Additional context from main session:**
>
> Phase 1 scan results (file inventory):
> ```json
> [list of {path, sizeLines} from scan-result.json]
> ```
>
> Phase warnings/errors accumulated during analysis:
> - [list any batch failures, skipped files, or warnings from Phases 2-3]
>
> Cross-validate: every file in the scan inventory should have a corresponding node in the graph (node types may vary: `file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`). Flag any missing files. Also flag any graph nodes whose `filePath` doesn't appear in the scan inventory.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Validate the knowledge graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Read the file and validate it for completeness and correctness.
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/review.json`

---

4. Read `$PROJECT_ROOT/.understand-anything/intermediate/review.json`.

5. **If `issues` array is non-empty:**
   - Review the `issues` list
   - Apply automated fixes where possible:
     - Remove edges with dangling references
     - Fill missing required fields with sensible defaults (e.g., empty `tags` -> `["untagged"]`, empty `summary` -> `"No summary available"`)
     - Remove nodes with invalid types
   - Re-run the final graph validation after automated fixes
   - If critical issues remain after one fix attempt, save the graph anyway but include the warnings in the final report and mark dashboard auto-launch as skipped

6. **If `issues` array is empty:** Proceed to Phase 5.

---

## Phase 5 — SAVE

1. Write the final knowledge graph:
   - Full mode: write to `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.
   - Scoped shard mode: write to `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json`, then refresh the sharded manifest:
     ```bash
     python <SKILL_DIR>/refresh-sharded-manifest.py $PROJECT_ROOT
     ```

2. **Metadata persistence:**
   - Full mode: write metadata to `$PROJECT_ROOT/.understand-anything/meta.json`:
     ```json
     {
       "lastAnalyzedAt": "<ISO 8601 timestamp>",
       "gitCommitHash": "<commit hash>",
       "version": "1.0.0",
       "analyzedFiles": <number of files analyzed>
     }
     ```
   - Scoped shard mode: does not write global `$PROJECT_ROOT/.understand-anything/meta.json`. The shard's `scopes`, `updatedAt`, and `gitCommitHash` are recorded in top-level `shard` metadata in `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json` and in the root manifest generated by `refresh-sharded-manifest.py`.

3. **Generate structural fingerprints**:
   - Full mode: generate structural fingerprints for all analyzed files and save to `$PROJECT_ROOT/.understand-anything/fingerprints.json`. This creates the baseline for future automatic incremental updates.
   - Scoped shard mode: does not write global `$PROJECT_ROOT/.understand-anything/fingerprints.json` and does not update the global automatic incremental-update baseline.

   Write and execute a Node.js script that uses the core fingerprint module (tree-sitter-based, not regex):
   ```javascript
   import { buildFingerprintStore } from '@understand-anything/core';
   import { saveFingerprints } from '@understand-anything/core';

   const store = await buildFingerprintStore('<PROJECT_ROOT>', sourceFilePaths);
   saveFingerprints('<PROJECT_ROOT>', store);
   ```
   Where `sourceFilePaths` is the list of all analyzed source file paths from Phase 1. This uses the same tree-sitter analysis pipeline as the main fingerprint engine, ensuring the baseline matches the comparison logic used during auto-updates. Skip this script in scoped shard mode.

4. Clean up intermediate files:
   ```bash
   rm -rf $PROJECT_ROOT/.understand-anything/intermediate
   rm -rf $PROJECT_ROOT/.understand-anything/tmp
   ```

5. Report a summary to the user containing:
   - Project name and description
   - Files analyzed / total files (with breakdown by fileCategory: code, config, docs, infra, data, script, markup)
   - Nodes created (broken down by type: file, config, document, service, table, endpoint, pipeline, schema, resource — code files emit `file` nodes only, not `function`/`class`)
   - Edges created (broken down by type)
   - Any warnings from the reviewer
   - Path to the output file (`$PROJECT_ROOT/.understand-anything/knowledge-graph.json` in full mode, or `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json` in scoped shard mode)

6. Dashboard launch:
   - Full mode: automatically launch the dashboard by invoking the `/understand-dashboard` skill if final graph validation passed after normalization/review fixes.
   - Scoped shard mode: do not automatically launch `/understand-dashboard`; report the shard output path and manifest refresh result instead.
   - If final validation did not pass, report that the graph was saved with warnings and dashboard launch was skipped.

---

## Error Handling

- If any subagent dispatch fails, retry **once** with the same prompt plus additional context about the failure.
- Track all warnings and errors from each phase in a `$PHASE_WARNINGS` list. When using `--review`, pass this list to the graph-reviewer in Phase 4. On the default path, include accumulated warnings in the Phase 5 final report.
- If it fails a second time, skip that phase and continue with partial results.
- ALWAYS save partial results — a partial graph is better than no graph.
- Report any skipped phases or errors in the final summary so the user knows what happened.
- NEVER silently drop errors. Every failure must be visible in the final report.

---

## Reference: KnowledgeGraph Schema

### Node Types (file-analyzer output)

Code files produce **`file`** nodes only. The pipeline does not emit `function` or `class` symbol nodes.

| Type | Description | ID Convention |
|---|---|---|
| `file` | Source code file | `file:<relative-path>` |
| `config` | Configuration file | `config:<relative-path>` |
| `document` | Documentation file | `document:<relative-path>` |
| `service` | Deployable service (Dockerfile, K8s) | `service:<relative-path>` |
| `table` | Database table or migration | `table:<relative-path>:<table-name>` |
| `endpoint` | API endpoint or route | `endpoint:<relative-path>:<endpoint-name>` |
| `pipeline` | CI/CD pipeline | `pipeline:<relative-path>` |
| `schema` | Schema definition | `schema:<relative-path>` |
| `resource` | Infrastructure resource | `resource:<relative-path>` |

Reserved for other agents (not emitted by file-analyzer): `module`, `concept`, `domain`, `flow`, `step`. Legacy graphs may still contain `function`/`class` until re-analyzed.

### Edge Types (file-analyzer code files)

Code files emit **`imports`**, **`depends_on`**, and **`tested_by`** only (file-level endpoints). Symbol edges (`contains`, `exports`, `calls`, `inherits`, `implements`) are not emitted.

Non-code files may also emit: `configures`, `documents`, `deploys`, `migrates`, `triggers`, `defines_schema`, `serves`, `provisions`, `routes`, `related`.

### Edge Weight Conventions (file-analyzer)
| Edge Type | Weight |
|---|---|
| `defines_schema` | 0.8 |
| `imports`, `deploys`, `migrates` | 0.7 |
| `depends_on`, `configures`, `triggers` | 0.6 |
| `tested_by`, `documents`, `provisions`, `serves`, `routes`, `related` | 0.5 |
