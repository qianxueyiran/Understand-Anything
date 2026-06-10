import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..", "..");

describe("understand sharded diff docs", () => {
  it("shares code shard generation workflow between understand and cold-start", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );
    const coldStart = readFileSync(
      join(pluginRoot, "skills", "understand-cold-start", "SKILL.md"),
      "utf-8",
    );
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand", "code-shard-workflow.md"),
      "utf-8",
    );

    expect(skill).toContain("skills/understand/code-shard-workflow.md");
    expect(skill).toContain("SCOPE_PATHS_JSON");
    expect(skill).toContain("JSON array");
    expect(coldStart).toContain("skills/understand/code-shard-workflow.md");
    expect(coldStart).toContain("SCOPE_PATHS_JSON");
    expect(coldStart).toContain("主上下文内联执行 Code Shard Workflow");
    expect(coldStart).not.toContain("对每个 shard 使用understand技能执行");
    expect(coldStart).not.toContain("/understand --scope <scopeArg> --shard <id>");
    expect(workflow).toContain("# Code Shard Workflow");
    expect(workflow).toContain("PROJECT_ROOT");
    expect(workflow).toContain("SHARD_ID");
    expect(workflow).toContain("SCOPE_PATHS");
    expect(workflow).toContain("SCOPE_PATHS_JSON");
    expect(workflow).toContain("SCOPE_ROOTS");
    expect(workflow).toContain("Phase 1 — SCAN");
    expect(workflow).toContain("Phase 5 — SAVE");
    expect(workflow).toContain("--require-scope");
    expect(workflow).toContain("using `$PLUGIN_ROOT/agents/project-scanner.md`");
    expect(workflow).toContain("MUST READ AND FOLLOW `$PLUGIN_ROOT/agents/file-analyzer.md`");
    expect(workflow).toContain("using `$PLUGIN_ROOT/agents/assemble-reviewer.md`");
    expect(workflow).not.toContain("using `agents/project-scanner.md`");
    expect(workflow).not.toContain("MUST READ AND FOLLOW `agents/file-analyzer.md`");
    expect(workflow).not.toContain("using `agents/assemble-reviewer.md`");
  });

  it("documents deterministic project-scanner contract", () => {
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand", "code-shard-workflow.md"),
      "utf-8",
    );
    const projectScanner = readFileSync(
      join(pluginRoot, "agents", "project-scanner.md"),
      "utf-8",
    );

    expect(workflow).toContain("scan-project.mjs");
    expect(workflow).toContain("extract-import-map.mjs");
    expect(workflow).toContain("scan-files.json");
    expect(workflow).toContain("import-map.json");
    expect(workflow).toContain("scan-result.json");
    expect(workflow).toContain("using `$PLUGIN_ROOT/agents/project-scanner.md`");

    expect(projectScanner).toContain("Deterministic Scan Inputs");
    expect(projectScanner).toContain("scan-files.json");
    expect(projectScanner).toContain("import-map.json");
    expect(projectScanner).toContain("Canonical format is the script contract");
    expect(projectScanner).toContain("import-map.json.importMap");
    expect(projectScanner).toContain("Do **not** treat top-level path keys");
    expect(projectScanner).toContain("deterministic-scan-fallback-used");
    expect(projectScanner).toContain("Do not rewrite");
    expect(projectScanner).not.toContain("Write a script");
    expect(projectScanner).not.toContain("tmp/ua-project-scan.js");
  });

  it("guards file-analyzer dispatch against non-scan files", () => {
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand", "code-shard-workflow.md"),
      "utf-8",
    );
    const fileAnalyzer = readFileSync(
      join(pluginRoot, "agents", "file-analyzer.md"),
      "utf-8",
    );

    expect(workflow).toContain("scanFileSet");
    expect(workflow).toContain("scan-result.files` is the only source of batch files");
    expect(workflow).toContain("reject `image`, `resource`, `binary`");
    expect(workflow).toContain("batchImportData` keys must exactly equal the batch file paths");
    expect(workflow).toContain("scan-result.importMap");
    expect(workflow).not.toContain("construct `batchImportData` from `importMap`");

    expect(fileAnalyzer).toContain("Before semantic analysis, validate");
    expect(fileAnalyzer).toContain("Pre-extracted structure path");
    expect(fileAnalyzer).toContain("Do NOT execute `extract-structure.mjs` from this subagent");
    expect(fileAnalyzer).toContain("batchImportData` keys exactly match");
  });

  it("shares product shard generation workflow between product and cold-start", () => {
    const productSkill = readFileSync(
      join(pluginRoot, "skills", "understand-product", "SKILL.md"),
      "utf-8",
    );
    const coldStart = readFileSync(
      join(pluginRoot, "skills", "understand-cold-start", "SKILL.md"),
      "utf-8",
    );
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand-product", "product-shard-workflow.md"),
      "utf-8",
    );

    expect(productSkill).toContain("skills/understand-product/product-shard-workflow.md");
    expect(coldStart).toContain("skills/understand-product/product-shard-workflow.md");
    expect(coldStart).toContain("主上下文内联执行 Product Shard Workflow");
    expect(coldStart).not.toContain("/understand-product --shard <id> --platform <platform>");
    expect(workflow).toContain("# Product Shard Workflow");
    expect(workflow).toContain("Phase 1: Prepare Boundary Candidates");
    expect(workflow).toContain("Phase 5: Finalize Product Index");
  });

  it("keeps cold-start plugin root resolution platform-neutral", () => {
    const coldStart = readFileSync(
      join(pluginRoot, "skills", "understand-cold-start", "SKILL.md"),
      "utf-8",
    );

    expect(coldStart).toContain("优先使用运行时注入的 plugin root");
    expect(coldStart).toContain("从当前 skill 文件位置解析出的 plugin root");
    expect(coldStart).not.toContain("按 `/understand-domain` 的策略解析");
    expect(coldStart).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("prevents /understand from being executed inside a subagent", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );

    expect(skill).toContain("Mandatory Execution Contract");
    expect(skill).toContain("Do not replace required subagents");
  });

  it("documents shard-only understand generation contract", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );

    expect(skill).toContain("shard-only");
    expect(skill).toContain("/understand --scope <paths> --shard <id>");
    expect(skill).toContain("/understand --update-diff");
    expect(skill).toContain('kind: "codebase-sharded"');
    expect(skill).toContain("根 `knowledge-graph.json` 是 sharded manifest");
    expect(skill).not.toContain("Existing non-sharded incremental update path");
    expect(skill).not.toContain("Full analysis (all phases)");
    expect(skill).not.toContain("Review-only path");
    expect(skill).not.toContain("legacy non-sharded");
    expect(skill).not.toContain("automatically launch the dashboard");
  });

  it("documents update-diff and sharded decision logic", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );

    expect(skill).toContain("--update-diff");
    expect(skill).toContain("codebase-sharded");
    expect(skill).toContain("sharded file-level incremental");
    expect(skill).not.toContain("--with-domain");
    expect(skill).not.toContain("--with-product");
  });

  it("preserves language and project context injection for shard output quality", () => {
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand", "code-shard-workflow.md"),
      "utf-8",
    );

    expect(workflow).toContain("Project README (first 3000 chars)");
    expect(workflow).toContain("Package manifest");
    expect(workflow).toContain(
      "The README and manifest are authoritative",
    );

    const scannerSection = workflow.slice(
      workflow.indexOf("## Phase 1"),
      workflow.indexOf("## Phase 2"),
    );
    expect(scannerSection).toContain("$LANGUAGE_DIRECTIVE");

    const analyzerSection = workflow.slice(
      workflow.indexOf("## Phase 2"),
      workflow.indexOf("## Phase 3"),
    );
    expect(analyzerSection).toContain("$LANGUAGE_DIRECTIVE");
    expect(analyzerSection).toContain("Project: `<projectName>`");
  });

  it("documents the executable sharded update workflow ownership", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );
    const shardedSectionStart = skill.indexOf("## If Update Shard");
    const shardedSection = skill.slice(
      shardedSectionStart,
      skill.indexOf("\n## Phase 0.5", shardedSectionStart),
    );

    expect(skill).toContain("skills/understand/update-diff-workflow.md");
    expect(skill).toContain("update-diff-workflow.md");
    expect(skill).toContain("sharded update summary");
    expect(shardedSection).toContain("sharded-update-workflow.mjs $PROJECT_ROOT plan");
    expect(shardedSection).toContain("assemble-shard --shard <id>");
    expect(shardedSection).toContain("commit");
    expect(shardedSection).not.toContain("batch-existing.json");
    expect(shardedSection).not.toContain(
      "保存到 `.understand-anything/shards/<id>.json`",
    );
    expect(shardedSection).not.toContain("刷新根 `knowledge-graph.json`");
    expect(shardedSection).not.toContain("intermediate/sharded/<shardId>/batch-001.json");
  });

  it("documents sharded file-analyzer output contract", () => {
    const fileAnalyzer = readFileSync(
      join(pluginRoot, "agents", "file-analyzer.md"),
      "utf-8",
    );

    expect(fileAnalyzer).toContain("Sharded `--update-diff`");
    expect(fileAnalyzer).toContain("intermediate/sharded/<shardId>/batch-001.json");
    expect(fileAnalyzer).toContain("runId");
    expect(fileAnalyzer).toContain("headCommitHash");
    expect(fileAnalyzer).toContain("shardId");
    expect(fileAnalyzer).toContain('"status": "success"');
    expect(fileAnalyzer).toContain("assemble-shard");
    expect(fileAnalyzer).toContain(
      "Phase 1 的 `functions` / `classes` 只用于丰富文件节点",
    );
    expect(fileAnalyzer).toContain("Pre-write symbol-node check");
  });

  it("documents the simplified sharded update transaction workflow", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand", "update-diff-workflow.md"),
      "utf-8",
    );

    expect(skill).toContain("update-diff-workflow.md");
    expect(workflow).toContain("plan");
    expect(workflow).toContain("assemble-shard");
    expect(workflow).toContain("commit");
    expect(workflow).toContain("runId");
    expect(workflow).toContain("headCommitHash");
    expect(workflow).toContain("shardId");
    expect(workflow).toContain("file-analyzer");
    expect(workflow).toContain("needs-file-analysis");
    expect(workflow).toContain("must not include `layers` or `tour` keys");
    expect(workflow).not.toContain("architecture-analyzer");
    expect(workflow).not.toContain("tour-builder");
    expect(workflow).toContain("assemble-shard --shard <id>");
    expect(workflow).toContain("commit");
    expect(workflow).toContain("knowledge-graph.json.update.gitCommitHash");
    expect(workflow).toContain("candidate-shard.json");
    expect(workflow).toContain("rejects");
    expect(workflow).toContain("stale");
    expect(workflow).toContain("missing");
    expect(workflow).toContain("failed");
    expect(workflow).not.toContain(
      "keeps `knowledge-graph.json.update.gitCommitHash` at the previous commit while downstream work is pending",
    );
    expect(workflow).not.toContain("product-update-result.json");
    expect(workflow).not.toContain("domain-update-result.json");
    expect(workflow).toContain("### Run Status Contract");
    expect(workflow).toContain("### Shard Status Contract");
    expect(workflow).toContain("### Assemble Result Status Contract");
    expect(workflow).toContain("| `ready` |");
    expect(workflow).toContain("| `blocked` |");
    expect(workflow).toContain("| `needs-file-analysis` |");
    expect(workflow).toContain("| `deleted-only` |");
    expect(workflow).toContain(
      "The shard has structural or new-file changes (any existing file in the diff), possibly alongside deletions.",
    );
    expect(workflow).not.toContain(
      "run architecture/tour refresh before commit",
    );
    expect(workflow).toContain("| `noop` |");
    expect(workflow).toContain("| `success` |");
    expect(workflow).toContain("| `failed` |");
    expect(workflow).not.toContain("| `cosmetic-only` |");
    expect(workflow).not.toContain("| `skipped-cosmetic` |");
    expect(workflow).toContain("unmappedChangedFiles");
    expect(workflow).not.toContain("downstream-pending");
    expect(workflow).not.toContain("| `unmapped` |");
    expect(workflow).not.toContain("| `succeeded` |");
    expect(workflow).not.toContain(
      "before publishing any shard or manifest changes",
    );
    expect(workflow).toContain("### Orchestration (`/understand`)");
    expect(workflow).toContain("sharded-update-workflow.mjs $PROJECT_ROOT plan");
    expect(workflow).toContain("assemble-shard --shard <id>");
    expect(workflow).toContain("intermediate/sharded/<shardId>/batch-001.json");
    expect(workflow).toContain("candidate-shard.json");
    expect(workflow).not.toContain("sharded-downstream-plan.json");
    expect(workflow).toContain("file-analyzer` dispatch (sharded update-diff only)");
    expect(workflow).toContain("Pre-extracted structure path");
    expect(workflow).toContain("extract-structure.mjs");
    expect(workflow).toContain("structuralFileSet");
    expect(workflow).not.toContain("Skill directory: `<SKILL_DIR>`");
    expect(workflow).not.toContain("code-shard-workflow");
    expect(workflow).not.toContain("architecture-analyzer` / `tour-builder` dispatch");
    expect(skill).not.toContain("architecture-analyzer");
    expect(skill).not.toContain("tour-builder");
    expect(workflow).toContain("Supported workflow commands only");
    expect(workflow).not.toContain("sharded-update-workflow.mjs $PROJECT_ROOT prepare");
    expect(workflow).not.toContain("Non-Sharded Graphs");
    expect(workflow).not.toContain("non-sharded");
    expect(workflow).not.toContain("legacy");
    expect(workflow).not.toContain("ordinary graphs");
    expect(workflow).not.toContain("Do not follow");
  });

  it("keeps update-diff overview and status contracts non-duplicative", () => {
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand", "update-diff-workflow.md"),
      "utf-8",
    );
    const overview = workflow.slice(
      workflow.indexOf("## Sharded Update"),
      workflow.indexOf("## Phase 1"),
    );
    const runStatusSection = workflow.slice(
      workflow.indexOf("### Run Status Contract"),
      workflow.indexOf("### Shard Status Contract"),
    );
    const shardStatusSection = workflow.slice(
      workflow.indexOf("### Shard Status Contract"),
      workflow.indexOf("### Assemble Result Status Contract"),
    );
    const assembleStatusSection = workflow.slice(
      workflow.indexOf("### Assemble Result Status Contract"),
    );

    expect(overview).not.toContain("1. Run `plan`");
    expect(overview).not.toContain("2. Dispatch `file-analyzer`");
    expect(overview).not.toContain("3. Run `assemble-shard");
    expect(overview).not.toContain("4. Run `commit`");
    expect(runStatusSection).toContain("| Status | Meaning |");
    expect(shardStatusSection).toContain("| Status | Meaning |");
    expect(assembleStatusSection).toContain("| Status | Meaning |");
    expect(runStatusSection).not.toContain("Dispatch/commit handling");
    expect(shardStatusSection).not.toContain("Dispatch/commit handling");
    expect(assembleStatusSection).not.toContain("Dispatch/commit handling");
  });

  it("documents update-diff as an executable phase workflow", () => {
    const workflow = readFileSync(
      join(pluginRoot, "skills", "understand", "update-diff-workflow.md"),
      "utf-8",
    );

    expect(workflow).toContain("## Inputs");
    expect(workflow).toContain("## Outputs");
    expect(workflow).toContain("## Phase 1 — PLAN");
    expect(workflow).toContain("## Phase 2 — ANALYZE AFFECTED SHARDS");
    expect(workflow).toContain("### Step 2 — Pre-extract structure in main context");
    expect(workflow).toContain("Pre-extracted structure path");
    expect(workflow).toContain('"projectRoot": "$PROJECT_ROOT"');
    expect(workflow).toContain("structuralFileSet");
    expect(workflow).toContain("LANGUAGE_DIRECTIVE");
    expect(workflow).toContain("runId: <runId from sharded-update-run.json>");
    expect(workflow).toContain("intermediate/scan-result.json");
    expect(workflow).toContain("## Phase 3 — ASSEMBLE SHARDS");
    expect(workflow).toContain("## Phase 4 — COMMIT");
    expect(workflow).toContain("## Report");
    expect(workflow).toContain("## Error Handling");
    expect(workflow).toContain("Extract and keep `runId`, `headCommitHash`, `status`, `warnings`, `unmappedChangedFiles`, and `shards[]`");
    expect(workflow).toContain("MUST READ AND FOLLOW `$PLUGIN_ROOT/agents/file-analyzer.md`");
    expect(workflow).not.toContain("MUST READ AND FOLLOW `agents/file-analyzer.md`");
    expect(workflow).toContain("Read the batch output before assembling");
    expect(workflow).toContain("Read the assemble result");
    expect(workflow).toContain("Read the refreshed manifest");
    expect(workflow).toContain("Affected shard ids");
  });

  it("documents product/domain refresh orchestration in a separate skill", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand-refresh", "SKILL.md"),
      "utf-8",
    );

    expect(skill).toContain("/understand --update-diff");
    expect(skill).toContain("/understand-domain --shard <id>");
    expect(skill).toContain("/understand-product --shard <id>");
    expect(skill).toContain("/understand-domain --refresh-shards");
    expect(skill).toContain("/understand-product --refresh-shards");
    expect(skill).toContain("不要求 `/understand` 等待 product/domain current-run result");
  });

  it("documents the hook sharded branch", () => {
    const hookPrompt = readFileSync(
      join(pluginRoot, "hooks", "auto-update-prompt.md"),
      "utf-8",
    );
    const hookConfig = readFileSync(
      join(pluginRoot, "hooks", "hooks.json"),
      "utf-8",
    );

    expect(hookPrompt).toContain("codebase-sharded");
    expect(hookPrompt).toContain("/understand --update-diff");
    expect(hookPrompt).toContain("knowledge-graph.json.update");
    expect(hookPrompt).toContain("Pre-extracted structure path");
    expect(hookPrompt).toContain("extract-structure.mjs");
    expect(hookPrompt).toContain("update-diff-workflow.md");
    expect(hookPrompt).not.toContain("code-shard-workflow");
    expect(hookPrompt).not.toContain("meta.json");
    expect(hookPrompt).not.toContain("fingerprints.json");
    expect(hookPrompt).not.toContain("PARTIAL_UPDATE");
    expect(hookPrompt).not.toContain("FULL_UPDATE");
    expect(hookConfig).toContain("codebase-sharded");
    expect(hookConfig).toContain("knowledge-graph.json");
    expect(hookConfig).toContain("update?.gitCommitHash");
    expect(hookConfig).not.toContain("meta.json");
  });
});
