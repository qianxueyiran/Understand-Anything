# Understand Anything

## Project Overview
An open-source tool combining LLM intelligence + static analysis to produce interactive dashboards for understanding codebases.

## Prerequisites
- Node.js >= 22 (developed on v24)
- pnpm >= 10 (pinned via `packageManager` field in root `package.json`)

## Architecture
- **Monorepo** with pnpm workspaces
- **understand-anything-plugin/** — Claude Code plugin containing all source code:
  - **packages/core** — Shared analysis engine (types, persistence, tree-sitter, search, schema, tours, plugins)
  - **src/** — Skill TypeScript source for `/understand-chat`, `/understand-diff`, `/understand-explain`, `/understand-onboard`
  - **skills/** — Skill definitions (`/understand`, `/understand-cold-start`, `/understand-product`, `/understand-refresh`, etc.)
  - **agents/** — Agent definitions (project-scanner, file-analyzer, architecture-analyzer, tour-builder, graph-reviewer)

## Agent Pipeline
- Agents write intermediate results to `.understand-anything/intermediate/` on disk (not returned to context)
- Agent models: all set to `inherit` for cross-platform compatibility (Claude Code, Cursor, opencode, etc.)
- Intermediate files cleaned up after graph assembly

## Key Commands
- `pnpm install` — Install all dependencies
- `pnpm --filter @understand-anything/core build` — Build the core package
- `pnpm --filter @understand-anything/core test` — Run core tests
- `pnpm --filter @understand-anything/skill build` — Build the plugin package
- `pnpm --filter @understand-anything/skill test` — Run plugin tests
- `pnpm lint` — Run ESLint across the project

## Conventions
- TypeScript strict mode everywhere
- Vitest for testing
- ESM modules (`"type": "module"`)
- Knowledge graph JSON lives in `.understand-anything/` directory of analyzed projects
- Core uses subpath exports (`./search`, `./types`, `./schema`) to avoid pulling Node.js modules into browser

## Gotchas
- **tree-sitter**: Uses `web-tree-sitter` (WASM) instead of native `tree-sitter` — native bindings fail on darwin/arm64 + Node 24

## Scripts
- `scripts/generate-large-graph.mjs` — Generates a fake knowledge graph for performance testing (e.g. large-graph layout). Writes to `.understand-anything/knowledge-graph.json`. Usage: `node scripts/generate-large-graph.mjs [nodeCount]` (default: 3000 nodes). Not part of the production pipeline.

## Versioning
When pushing to remote, bump the version in **all five** of these files (keep them in sync):
- `understand-anything-plugin/package.json` → `"version"` field
- `understand-anything-plugin/.claude-plugin/plugin.json` → `"version"` field
- `.claude-plugin/plugin.json` → `"version"` field
- `.cursor-plugin/plugin.json` → `"version"` field
- `.copilot-plugin/plugin.json` → `"version"` field

Note: `.claude-plugin/marketplace.json` does **not** carry a version — the `plugins[]` entry only supports `name` and `source`, and adding other fields causes marketplace schema validation failures.

## 同步本地改动到 Claude Code

本工程已将插件固定在本地缓存路径，Claude Code **不会**再从 marketplace 拉取上游版本。

当前固定版本：`2.7.6`
缓存路径：`~/.claude/plugins/cache/understand-anything/understand-anything/2.7.6/`

**每次修改 skill / agent / src 后，执行以下命令同步：**

```bash
pnpm --filter @understand-anything/core build && \
pnpm --filter @understand-anything/skill build && \
cp -R ./understand-anything-plugin/. \
  ~/.claude/plugins/cache/understand-anything/understand-anything/2.7.6/
```

然后**重新开一个 Claude Code session**（已有 session 会缓存旧的 skill 内容）。

**说明：**
- `~/.claude/plugins/installed_plugins.json` 中 `installPath` 已指向本地缓存路径，版本号 `2.7.6` 高于上游 `2.7.5`，Claude Code 命中缓存后不会联网更新
- 若 Claude Code 版本升级后仍触发重新拉取，重新执行上述 `cp` 命令覆盖缓存即可
