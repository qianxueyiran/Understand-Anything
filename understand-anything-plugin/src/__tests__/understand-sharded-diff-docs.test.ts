import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..", "..");

describe("understand sharded diff docs", () => {
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

  it("documents the executable sharded update workflow ownership", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "understand", "SKILL.md"),
      "utf-8",
    );
    const shardedSectionStart = skill.indexOf(
      "### Sharded file-level incremental update path",
    );
    const shardedPhase2 = skill.slice(
      shardedSectionStart,
      skill.indexOf("\n---\n\n## Phase 3", shardedSectionStart),
    );

    expect(skill).toContain("skills/understand/update-diff-workflow.md");
    expect(skill).toContain(
      "delegates detailed sharded update rules to `skills/understand/update-diff-workflow.md`",
    );
    expect(skill).toContain("update-diff-workflow.md");
    expect(skill).toContain(
      "do not follow the legacy non-sharded Phase 2 merge/finalize flow",
    );
    expect(shardedPhase2).not.toContain("batch-existing.json");
    expect(shardedPhase2).not.toContain(
      "保存到 `.understand-anything/shards/<id>.json`",
    );
    expect(shardedPhase2).not.toContain("刷新根 `knowledge-graph.json`");
    expect(shardedPhase2).not.toContain("sharded-update-workflow.mjs $PROJECT_ROOT plan");
    expect(shardedPhase2).not.toContain("intermediate/sharded/<shardId>/batch-001.json");
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
    expect(workflow).toContain("Legacy commands");
    expect(workflow).toContain("are removed");
    expect(workflow).not.toContain("sharded-update-workflow.mjs $PROJECT_ROOT prepare");
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

    expect(hookPrompt).toContain("codebase-sharded");
    expect(hookPrompt).toContain("/understand --update-diff");
    expect(hookPrompt).toContain("knowledge-graph.json.update");
  });
});
