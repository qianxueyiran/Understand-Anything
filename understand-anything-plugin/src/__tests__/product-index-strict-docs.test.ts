import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  new URL("../../skills/understand-product/SKILL.md", import.meta.url),
  "utf-8",
);
const analyzer = readFileSync(
  new URL("../../agents/product-index-analyzer.md", import.meta.url),
  "utf-8",
);
const normalizer = readFileSync(
  new URL("../../agents/product-topic-normalizer.md", import.meta.url),
  "utf-8",
);

describe("understand-product strict docs", () => {
  it("documents strict phase order and removes fast fallback usage", () => {
    expect(skill).toContain("product-topic-normalizer.md");
    expect(skill).toContain("--prepare-candidates");
    expect(skill).toContain("--build-context-packs");
    expect(skill).toContain("--finalize");
    expect(skill).not.toContain("node \"$PLUGIN_ROOT/dist/product-index-cli.js\" \"$PROJECT_ROOT\" --fast");
    expect(skill).not.toContain("跳过 LLM 抽取");
    expect(skill).toContain("不要使用 `--fast`");
  });

  it("requires topic normalization before context packs", () => {
    expect(normalizer).toContain("product-boundary-candidates.json");
    expect(normalizer).toContain("product-topic-normalization.json");
    expect(normalizer).toContain("`capability`");
    expect(normalizer).toContain("`surface`");
    expect(normalizer).toContain("`integration`");
    expect(normalizer).toContain("`data`");
    expect(normalizer).toContain("`process`");
    expect(normalizer).not.toContain("`intergration`");
    expect(normalizer).not.toContain("`element`");
    expect(normalizer).toContain("不能抽取 facts");
    expect(normalizer).toContain("不能全项目搜索源码");
  });

  it("requires fact analyzer source reads and bounded evidence refs", () => {
    expect(analyzer).toContain("sourceReads");
    expect(analyzer).toContain("product-context-packs-by-topic/<topic-file>.json");
    expect(analyzer).toContain("product-index-extractions-by-topic/<topic-file>.json");
    expect(skill).toContain("逐个 topic 派发");
    expect(analyzer).toContain("必须读取你认为与当前 topic 相关的 `candidateFiles[].filePath` 源码");
    expect(analyzer).toContain("不能读取 `overflowFiles`");
    expect(analyzer).toContain("`behavior`、`rule`、`display`、`data`、`integration`、`mapping`、`lifecycle`");
    expect(analyzer).not.toContain("`target`、`entry`");
  });
});
