import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skillText = readFileSync(
  new URL("../../skills/understand/SKILL.md", import.meta.url),
  "utf8",
);
const workflowText = readFileSync(
  new URL("../../skills/understand/code-shard-workflow.md", import.meta.url),
  "utf8",
);
const combinedText = `${skillText}\n${workflowText}`;

describe("/understand output language defaults", () => {
  it("defaults descriptive output to Chinese while preserving technical terms", () => {
    expect(skillText).toContain("Defaults to `zh` (Chinese)");
    expect(skillText).toContain("default to `zh` (Chinese)");
    expect(skillText).toContain("`description`");
    expect(skillText).toContain("`summary`");
    expect(skillText).toContain("`title`");
    expect(skillText).toContain("`languageNotes`");
    expect(skillText).toContain("`languageLesson`");
    expect(skillText).toContain("code identifiers");
    expect(skillText).toContain("technical keywords");
  });

  it("does not require manual confirmation during analysis", () => {
    expect(combinedText).not.toContain("Wait for user confirmation");
    expect(combinedText).not.toContain("Proceed only if user confirms");
    expect(combinedText).not.toContain("Ask the user:");
  });

  it("stops after required subagent retry failure instead of continuing partial output", () => {
    expect(combinedText).toContain("失败两次后停止");
    expect(combinedText).toContain("Do not save a graph that is presented as usable after a required phase failed");
    expect(combinedText).not.toContain("skip that phase and continue with partial results");
    expect(combinedText).not.toContain("ALWAYS save partial results");
  });
});
