# Code Shard Workflow

This file is a shared workflow fragment, Do not invoke it as `/understand` and do not dispatch a subagent to execute the whole workflow. The main context reads this file and executes the phases inline.

## Inputs

- `PROJECT_ROOT` — absolute project root.
- `PLUGIN_ROOT` — absolute Understand Anything plugin root.
- `SKILL_DIR` — `$PLUGIN_ROOT/skills/understand`.
- `SHARD_ID` — validated shard id matching `^[A-Za-z0-9_-]+$`.
- `SCOPE_PATHS` — project-relative scope paths from config or arguments.
- `SCOPE_PATHS_JSON` — non-empty JSON array form of `SCOPE_PATHS`. Code shard generation must never use `[]`.
- `SCOPE_ROOTS` — absolute scope roots resolved under `PROJECT_ROOT`.
- `OUTPUT_LANGUAGE` — selected output language.
- `LANGUAGE_DIRECTIVE` — language directive passed to subagents.
- `README_CONTENT` — first 3000 chars of project README when present.
- `MANIFEST_CONTENT` — primary package manifest content when present.
- `BUSINESS_GLOSSARY` — full content of `docs/business-glossary.md` when present; empty string otherwise.

## Outputs

- `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json`
- refreshed `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`
- optional `$PROJECT_ROOT/.understand-anything/fingerprints/shards/$SHARD_ID.json`

## Phase 0 — Ignore Configuration

1. Check `$PROJECT_ROOT/.understand-anything/.understandignore`.
2. If it does not exist, generate a starter file from built-in defaults plus project-local suggestions derived from `.gitignore`.
3. If it already exists, use the current file.

Report filtered file counts when the scan result includes `filteredByIgnore > 0`.

## Phase 1 — SCAN

**Create the intermediate directory and run deterministic scanner scripts in the main context before dispatching `project-scanner`**:

### Step 1 — Validate scope input

Before running the scripts, verify `SCOPE_PATHS_JSON` is a non-empty JSON array. If it is missing, invalid, or `[]`, stop; do not run a full-project scan for a scoped shard.

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate"
node "$SKILL_DIR/scan-project.mjs" "$PROJECT_ROOT" "$PROJECT_ROOT/.understand-anything/intermediate/scan-files.json" --scope-json "$SCOPE_PATHS_JSON" --require-scope --repository-output "$PROJECT_ROOT/.understand-anything/intermediate/repository-files.json"
node "$SKILL_DIR/extract-import-map.mjs" "$PROJECT_ROOT/.understand-anything/intermediate/scan-files.json" "$PROJECT_ROOT/.understand-anything/intermediate/import-map.json" --repository-input "$PROJECT_ROOT/.understand-anything/intermediate/repository-files.json"
```

If either deterministic script fails, retry the failed command once with the same arguments after reading stderr. If the retry also fails, dispatch `project-scanner` in fallback mode and require the final `scan-result.json` to include `warnings: ["deterministic-scan-fallback-used"]`. If fallback fails twice, stop.

### Step 2 — Dispatch `project-scanner`

**Dispatch `project-scanner` using `$PLUGIN_ROOT/agents/project-scanner.md`**.

Additional context:

```markdown
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
```

Prompt parameters:

```text
Read deterministic scan inputs and produce the scoped shard inventory.**YOU MUST READ AND FOLLOW `$PLUGIN_ROOT/agents/project-scanner.md` BEFORE WORK**
Project root: $PROJECT_ROOT
Scope roots: $SCOPE_ROOTS
Deterministic scan input: $PROJECT_ROOT/.understand-anything/intermediate/scan-files.json
Deterministic import input: $PROJECT_ROOT/.understand-anything/intermediate/import-map.json
Output path: $PROJECT_ROOT/.understand-anything/intermediate/scan-result.json
```

**The scanner must**:

- read `scan-files.json` and `import-map.json`;
- do not read `repository-files.json`; it is only for import-map extraction;
- copy structural fields from deterministic inputs without rewriting them;
- `scan-files.json` contains scoped `files` only and must not contain `repositoryFiles`;
- synthesize only project name, description, and conservative framework notes from README, manifest, and scan summaries.

### Step 3 — Consume and validate `scan-result.json`

After the subagent finishes, read `scan-result.json` and keep:

- project name, description, languages, frameworks;
- file list with `path`, `language`, `sizeLines`, and `fileCategory`;
- `importMap`.

`importMap` comes from the final `scan-result.json`, where `project-scanner` has already normalized the canonical `import-map.json.importMap` object produced by `extract-import-map.mjs`. Do not consume top-level path keys from `import-map.json`, and do not infer an alternate import-map shape from one observed JSON file. If `scan-result.importMap` is missing or not an object, stop and rerun Phase 1 fixed scripts; after two failures, stop with an error.

## Phase 2 — ANALYZE

### Step 1 — Build batch source and import alignment

Batch the Phase 1 file list into groups of **20-30 files each**; aim for about 25 files per batch.

Before batching, build `scanFileSet = new Set(scan-result.files.map(f => f.path))` and validate:

- `scan-result.files` is the only source of batch files; do not read `repository-files.json`, scan the repo again, or reuse any tmp `ua-file-analyzer-input-*.json`;
- every batch file path must be in `scanFileSet`;
- every batch file must have `fileCategory` in `code|config|docs|infra|data|script|markup`;
- reject `image`, `resource`, `binary`, or any file category/language outside the scanner contract;
- `batchImportData` keys must exactly equal the batch file paths, and values must come from `scan-result.importMap[path] ?? []`.

If any validation fails, stop and report the invalid paths/categories. Do not dispatch `file-analyzer` with a broadened or manually discovered file list.

Batching rules:

- keep related non-code files together when possible;
- include every file's `path`, `language`, `sizeLines`, and `fileCategory`;
- construct `batchImportData` from `scan-result.importMap` for every file in the batch.

### Step 2 — Pre-extract structure in main context

run deterministic structural extraction in the main context for each batch:

1. Write `batchFiles` and `batchImportData` (verbatim) to:
   - `$PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<batchIndex>.json`
2. Run:

```bash
node "$SKILL_DIR/extract-structure.mjs" \
  "$PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<batchIndex>.json" \
  "$PROJECT_ROOT/.understand-anything/tmp/ua-file-extract-results-<batchIndex>.json"
```

3. Validate extraction output:
   - `scriptCompleted === true`;
   - `results` is an array;
   - every `results[].path` is in the batch file path set.
4. If extraction fails, retry once with the same arguments after reading stderr. If retry fails, stop and report batch index + error.

### Step 3 — Dispatch `file-analyzer` subagents

**After extraction files are ready, dispatch `file-analyzer` subagent for each batch using `$PLUGIN_ROOT/agents/file-analyzer.md`**, up to **8 subagents concurrently**.

Additional context:

```markdown
> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE
>
> Business Glossary (project-specific terms — use these standard names in `tags`, `summary`, and `businessSignals` to ensure alignment with product vocabulary):
> ```
> $BUSINESS_GLOSSARY
> ```
> (If empty, ignore this section.)
```

**The prompt must include**:

```text
Analyze these files and produce GraphNode and GraphEdge objects.**MUST READ AND FOLLOW `$PLUGIN_ROOT/agents/file-analyzer.md` BEFORE WORK**
Project root: $PROJECT_ROOT
Project: <projectName>
Languages: <languages>
Batch index: <batchIndex>
Write output to: $PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json
Pre-extracted structure path: $PROJECT_ROOT/.understand-anything/tmp/ua-file-extract-results-<batchIndex>.json
Pre-resolved import data: <batchImportData JSON>
Files to analyze: <batch file list — path, language, sizeLines, fileCategory each>

Field constraints:
- Process: read and use `Pre-extracted structure path` . Do not run or create scripts.
- Granularity: one node per batch file. `code`/`script`/`markup` → `file:<path>` only — never `function:`/`class:` IDs or type function/class. Non-code: parent node per file (`config`, `document`, `service`, `pipeline`, `schema`, `table`, `endpoint`, `resource`); optional children from non-empty services/endpoints/steps/resources only.
- Node required: 
   - `id` : type-prefixed, e.g. file:src/a.ts — no project prefix, no bare paths
   - `type`:  file|config|document|service|table|endpoint|pipeline|schema|resource
   - `name`
   - `summary`: non-empty,follow language directive
   - `tags`: 3–5, non-empty; follow language directive
   - `complexity`:  simple|moderate|complex
   - `filePath`: = batchFiles[].path
   - `businessSignals`: 0–5个, 有业务信号时生成, follow language directive, [{type: entry|behavior|rule|display|data|integration, text: 关键业务逻辑，使用产品语言描述}] 
- Edge required: `source`, `target`, `type`, `direction` "forward", `weight` (number).
- Code edges only: imports 0.7, depends_on 0.6, tested_by 0.5 — no contains/calls/exports/inherits. For path P, imports edge count MUST equal batchImportData[P].length (one edge per entry; keys use batchFiles[].path).
- Non-code edges when justified: configures 0.6, documents 0.5, deploys 0.7, migrates 0.7, triggers 0.6, defines_schema 0.8, serves 0.7, provisions 0.7, routes 0.6, related 0.5, depends_on 0.6.
- Self-check before writing:
  - imports edge count equals `sum(batchImportData[path].length)` across code files;
  - no `function`/`class` nodes and no `function:`/`class:` ids;
  - at least has 1 businessSignals node;
  - every non-external edge target/source exists in produced nodes.
- Output: valid JSON {nodes, edges} to path above; one node per file; no duplicate ids; no self-edges; reply with counts only (no full JSON in chat).
```

**Do not skip `file-analyzer`; do not simulate it with scripts.**

### Step 5 — Merge batch outputs

After all batches complete, run:

```bash
python3 <SKILL_DIR>/merge-batch-graphs.py "$PROJECT_ROOT" --preserve-external
```

This writes `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json` and preserves cross-shard `imports` edges.

## Phase 3 — ASSEMBLE REVIEW

Dispatch `assemble-reviewer` using `$PLUGIN_ROOT/agents/assemble-reviewer.md`.

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
   python3 <SKILL_DIR>/refresh-sharded-manifest.py "$PROJECT_ROOT"
   ```

3. Write shard fingerprints to:

   ```text
   $PROJECT_ROOT/.understand-anything/fingerprints/shards/$SHARD_ID.json
   ```

   Use the core fingerprint module where available, and keep fingerprints shard-scoped.

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
