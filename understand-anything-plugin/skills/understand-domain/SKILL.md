---
name: understand-domain
description: Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing /understand knowledge graph.
argument-hint: [--full] [--shard <id>] [--refresh-shards]
---

# /understand-domain

Extracts business domain knowledge — domains, business flows, and process steps — from a codebase and produces an interactive horizontal flow graph in the dashboard.

## How It Works

- If a knowledge graph already exists (`.understand-anything/knowledge-graph.json`), derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists, performs a lightweight scan: file tree + entry point detection + sampled files
- Use `--full` flag to force a fresh scan even if a knowledge graph exists

## Instructions

### Phase 0: Resolve `PROJECT_ROOT`

Set `PROJECT_ROOT` to the current working directory.

**Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — `.understand-anything/` written there is destroyed when the session ends, taking the domain graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      echo "[understand-domain] Detected git worktree at $PROJECT_ROOT"
      echo "[understand-domain] Redirecting output to main repo root: $MAIN_ROOT"
      echo "[understand-domain] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi
```

Use `$PROJECT_ROOT` (not the bare CWD) for every reference to "the current project" / `<project-root>` in subsequent phases.

**Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/understand-domain` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

Resolve the plugin root like this:

```bash
SKILL_REAL=$(realpath ~/.agents/skills/understand-domain 2>/dev/null || readlink -f ~/.agents/skills/understand-domain 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand-domain 2>/dev/null || readlink -f ~/.copilot/skills/understand-domain 2>/dev/null || echo "")
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
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand-domain>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand-domain>}"
  echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
  echo "  - $HOME/understand-anything/understand-anything-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi
```

Use `$PLUGIN_ROOT` for every reference to agent definitions in subsequent phases.

### Phase 0.5: Parse Shard Mode

解析参数并确定是否进入分片模式：

- `--shard <id>`：只从 `$PROJECT_ROOT/.understand-anything/shards/<id>.json` 派生一个 domain shard。
- `--refresh-shards`：只运行 `python "$PLUGIN_ROOT/skills/understand-domain/refresh-domain-sharded-manifest.py" "$PROJECT_ROOT"` 后停止；不要运行 LLM，也不要读取任何 shard 内容。
- shard id 必须匹配 `^[A-Za-z0-9_-]+$`；不匹配时停止并提示用户传入合法 id。
- 分片模式读取 `knowledge-graph.json` 时，先 raw JSON 读取并检查顶层 `kind`，不要先按完整 `KnowledgeGraph` 解析。

### Phase 1: Detect Existing Graph

1. Check if `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` exists
2. If `--refresh-shards` was passed → run `python "$PLUGIN_ROOT/skills/understand-domain/refresh-domain-sharded-manifest.py" "$PROJECT_ROOT"` and stop
3. If it exists, raw JSON read only the top-level `kind` before any full graph parsing
4. If root kind is `codebase-sharded` and neither `--shard` nor `--refresh-shards` was passed → tell the user to rerun with `--shard <id>` or `--refresh-shards`; do not load all shards
5. If `--shard <id>` was passed → proceed to Phase 3 using only `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json`
6. If it exists AND `--full` was NOT passed → proceed to Phase 3 (derive from graph)
7. Otherwise → proceed to Phase 2 (lightweight scan)

### Phase 2: Lightweight Scan (Path 1)

The preprocessing script does NOT produce a domain graph — it produces **raw material** (file tree, entry points, exports/imports) so the domain-analyzer agent can focus on the actual domain analysis instead of spending dozens of tool calls exploring the codebase. Think of it as a cheat sheet: cheap Python preprocessing → expensive LLM gets a clean, small input → better results for less cost.

1. Run the preprocessing script bundled with this skill, passing `$PROJECT_ROOT` from Phase 0:
   ```
   python ./extract-domain-context.py "$PROJECT_ROOT"
   ```
   This outputs `$PROJECT_ROOT/.understand-anything/intermediate/domain-context.json` containing:
   - File tree (respecting `.gitignore`)
   - Detected entry points (HTTP routes, CLI commands, event handlers, cron jobs, exported handlers)
   - File signatures (exports, imports per file)
   - Code snippets for each entry point (signature + first few lines)
   - Project metadata (package.json, README, etc.)
2. Read the generated `domain-context.json` as context for Phase 4
3. Proceed to Phase 4

### Phase 3: Derive from Existing Graph (Path 2)

1. Read `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`; in shard mode, read only `$PROJECT_ROOT/.understand-anything/shards/$SHARD_ID.json`
2. Format the graph data as structured context:
   - All nodes with their types, names, summaries, and tags
   - All edges with their types (especially `calls`, `imports`, `contains`)
   - All layers with their descriptions
   - Tour steps if available
3. This is the context for the domain analyzer — no file reading needed
4. Proceed to Phase 4

### Phase 4: Domain Analysis

1. Read the domain-analyzer agent prompt from `$PLUGIN_ROOT/agents/domain-analyzer.md`
2. Dispatch a subagent with the domain-analyzer prompt + the context from Phase 2 or 3
3. The agent writes its output to `$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json`
4. In shard mode, the agent writes its output to `$PROJECT_ROOT/.understand-anything/intermediate/domain-shards/$SHARD_ID/domain-analysis.json`

### Phase 5: Validate and Save

1. Read the domain analysis output
2. Validate using the standard graph validation pipeline (the schema now supports domain/flow/step types)
3. If validation fails, log warnings but save what's valid (error tolerance)
4. Save to `$PROJECT_ROOT/.understand-anything/domain-graph.json`
5. In shard mode, save to `$PROJECT_ROOT/.understand-anything/domain-shards/$SHARD_ID.json`, then run `python "$PLUGIN_ROOT/skills/understand-domain/refresh-domain-sharded-manifest.py" "$PROJECT_ROOT"` to refresh `$PROJECT_ROOT/.understand-anything/domain-graph.json`
6. Clean up `$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json` and `$PROJECT_ROOT/.understand-anything/intermediate/domain-context.json`; in shard mode, clean up `$PROJECT_ROOT/.understand-anything/intermediate/domain-shards/$SHARD_ID/domain-analysis.json`

### Phase 6: Launch Dashboard

1. Auto-trigger `/understand-dashboard` to visualize the domain graph
2. The dashboard will detect `domain-graph.json` and show the domain view by default
3. In shard mode, do not automatically launch the dashboard
