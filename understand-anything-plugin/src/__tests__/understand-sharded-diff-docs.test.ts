import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..", "..");

describe("understand sharded diff docs", () => {
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
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );

    expect(skill).toContain("Project README (first 3000 chars)");
    expect(skill).toContain("Package manifest");
    expect(skill).toContain(
      "The README and manifest are authoritative",
    );

    const scannerSection = skill.slice(
      skill.indexOf("## Phase 1"),
      skill.indexOf("## Phase 2"),
    );
    expect(scannerSection).toContain("$LANGUAGE_DIRECTIVE");

    const analyzerSection = skill.slice(
      skill.indexOf("## Phase 2"),
      skill.indexOf("## Phase 3"),
    );
    expect(analyzerSection).toContain("$LANGUAGE_DIRECTIVE");
    expect(analyzerSection).toContain("Project: `<projectName>`");
  });

  it("documents the executable sharded update workflow ownership", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );
    const shardedSectionStart = skill.indexOf("## Sharded Update");
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
    expect(skill).toContain("omit both keys");
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
    expect(workflow).toContain("## Phase 3 — ASSEMBLE SHARDS");
    expect(workflow).toContain("## Phase 4 — COMMIT");
    expect(workflow).toContain("## Report");
    expect(workflow).toContain("## Error Handling");
    expect(workflow).toContain("Extract and keep `runId`, `headCommitHash`, `status`, `warnings`, `unmappedChangedFiles`, and `shards[]`");
    expect(workflow).toContain("MUST READ AND FOLLOW `agents/file-analyzer.md`");
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
    expect(hookPrompt).toContain("只支持 codebase-sharded");
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
