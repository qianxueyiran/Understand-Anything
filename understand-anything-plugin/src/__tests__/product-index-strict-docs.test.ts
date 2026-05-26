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

function skillPhase(title: string) {
  const start = skill.indexOf(title);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = skill.indexOf("\n## Phase ", start + title.length);
  return next === -1 ? skill.slice(start) : skill.slice(start, next);
}

describe("understand-product strict docs", () => {
  it("documents shard-only product generation contract", () => {
    expect(skill).toContain("正式流程是 shard-only");
    expect(skill).toContain("/understand-product --shard <id>");
    expect(skill).toContain("/understand-product --refresh-shards");
    expect(skill).toContain("product-shards/<id>.json");
    expect(skill).toContain("product-traces/<id>.json");
    expect(skill).toContain("product-shards/<id>.signals.jsonl");
    expect(skill).not.toContain("非 shard 模式");
    expect(skill).not.toContain("product-index-trace.json");
    expect(skill).not.toContain("product-signals.jsonl");
  });

  it("documents strict phase order and removes fast fallback usage", () => {
    expect(skill).toContain("product-topic-normalizer.md");
    expect(skill).toContain("--prepare-candidates");
    expect(skill).toContain("--build-context-packs");
    expect(skill).toContain("--finalize");
    expect(skill).not.toContain("node \"$PLUGIN_ROOT/dist/product-index-cli.js\" \"$PROJECT_ROOT\" --fast");
    expect(skill).not.toContain("跳过 LLM 抽取");
    expect(skill).toContain("不要使用 `--fast`");
  });

  it("documents sharded product prompt flow", () => {
    expect(skill).toContain("--shard <id>");
    expect(skill).toContain("--refresh-shards");
    expect(skill).toContain("product-shards/<id>.json");
    expect(skill).toContain("intermediate/product-shards/<id>");
    expect(skill).toContain("product-traces/<id>.json");
    expect(skill).toContain("--finalize --shard <id>");
    expect(skill).toContain("CLI 会自动刷新");
    expect(skill).toContain("--refresh-shards` 仍可用于重新扫描");
  });

  it("documents shard-specific paths in each product phase", () => {
    const phase1 = skillPhase("## Phase 1: Prepare Boundary Candidates");
    expect(phase1).toContain("intermediate/product-shards/<id>/product-boundary-candidates.json");

    const phase2 = skillPhase("## Phase 2: LLM Topic Normalization");
    expect(phase2).toContain("intermediate/product-shards/<id>/product-boundary-candidates.json");
    expect(phase2).toContain("intermediate/product-shards/<id>/product-topic-normalization.json");

    const phase3 = skillPhase("## Phase 3: Build Context Packs");
    expect(phase3).toContain("intermediate/product-shards/<id>/product-boundary-candidates.json");
    expect(phase3).toContain("intermediate/product-shards/<id>/product-topic-normalization.json");
    expect(phase3).toContain("shards/<id>.json");
    expect(phase3).toContain("domain-shards/<id>.json");
    expect(phase3).toContain("intermediate/product-shards/<id>/product-context-packs.json");
    expect(phase3).toContain("intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json");

    const phase4 = skillPhase("## Phase 4: LLM Fact + Evidence Extraction");
    expect(phase4).toContain("intermediate/product-shards/<id>/product-context-packs-by-topic/<topic-file>.json");
    expect(phase4).toContain("intermediate/product-shards/<id>/product-index-extractions-by-topic/<topic-file>.json");

    const phase5 = skillPhase("## Phase 5: Finalize Product Index");
    expect(phase5).toContain("intermediate/product-shards/<id>/product-boundary-candidates.json");
    expect(phase5).toContain("intermediate/product-shards/<id>/product-topic-normalization.json");
    expect(phase5).toContain("intermediate/product-shards/<id>/product-context-packs.json");
    expect(phase5).toContain("intermediate/product-shards/<id>/product-index-extractions-by-topic/*.json");
    expect(phase5).toContain("product-shards/<id>.json");
    expect(phase5).toContain("product-traces/<id>.json");
    expect(phase5).toContain("CLI 会自动刷新");
    expect(phase5).toContain("--refresh-shards");
  });

  it("requires topic normalization before context packs", () => {
    expect(normalizer).toContain("product-boundary-candidates.json");
    expect(normalizer).toContain("product-topic-normalization.json");
    expect(normalizer).toContain("输入路径");
    expect(normalizer).toContain("输出路径");
    expect(normalizer).toContain("调度 prompt");
    expect(normalizer).toContain("`capability`");
    expect(normalizer).toContain("`surface`");
    expect(normalizer).toContain("`integration`");
    expect(normalizer).toContain("`data`");
    expect(normalizer).toContain("`process`");
    expect(normalizer).not.toContain("`intergration`");
    expect(normalizer).not.toContain("`element`");
    expect(normalizer).toContain("不能抽取 facts");
    expect(normalizer).toContain("不能全项目搜索源码");
    expect(normalizer).toContain("file:app/BootBroadcastReceiver.java");
    expect(normalizer).not.toContain("candidate:class:BootBroadcastReceiver");
  });

  it("requires fact analyzer source reads and bounded evidence refs", () => {
    expect(analyzer).toContain("sourceReads");
    expect(analyzer).toContain("product-context-packs-by-topic/<topic-file>.json");
    expect(analyzer).toContain("product-index-extractions-by-topic/<topic-file>.json");
    expect(analyzer).toContain("输入路径");
    expect(analyzer).toContain("输出路径");
    expect(analyzer).toContain("调度 prompt");
    expect(skill).toContain("逐个 topic 派发");
    expect(analyzer).toContain("读取你认为与当前 topic 相关的 `candidateFiles[].filePath` 源码");
    expect(analyzer).toContain("只能读取当前 topic 的 `candidateFiles`");
    expect(analyzer).toContain("`behavior`、`rule`、`display`、`data`、`integration`、`mapping`、`lifecycle`");
    expect(analyzer).toContain("anchors[].signalType");
    expect(analyzer).toContain("禁止");
    expect(analyzer).not.toContain("`target`、`entry`");
    expect(analyzer).toContain("anchor:file:app/BootBroadcastReceiver.java:0");
  });

  it("passes explicit paths to product agents in shard mode", () => {
    const phase2 = skillPhase("## Phase 2: LLM Topic Normalization");
    const phase4 = skillPhase("## Phase 4: LLM Fact + Evidence Extraction");

    expect(phase2).toContain("输入路径");
    expect(phase2).toContain("输出路径");
    expect(phase2).toContain("必须以调度 prompt 传入的路径为准");
    expect(phase4).toContain("输入路径");
    expect(phase4).toContain("输出路径");
    expect(phase4).toContain("必须以调度 prompt 传入的路径为准");
  });
});
