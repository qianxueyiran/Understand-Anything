import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skillText = readFileSync(
  new URL("../../skills/understand/SKILL.md", import.meta.url),
  "utf8",
);

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
});
