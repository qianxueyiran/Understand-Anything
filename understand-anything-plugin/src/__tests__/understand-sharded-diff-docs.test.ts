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
    expect(skill).toContain("--with-domain");
    expect(skill).toContain("--with-product");
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
