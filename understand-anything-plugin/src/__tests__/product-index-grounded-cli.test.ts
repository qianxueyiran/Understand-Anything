import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { runProductIndexCli } from "../product-index-cli.js";

function writeGraph(projectRoot: string): void {
  const dir = join(projectRoot, ".understand-anything");
  mkdirSync(dir, { recursive: true });
  const graph: KnowledgeGraph = {
    version: "1.0.0",
    project: {
      name: "video-app",
      languages: ["java"],
      frameworks: ["Android"],
      description: "Video app",
      analyzedAt: "2026-05-19T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes: [
      {
        id: "function:BootBroadcastReceiver.java:onReceive",
        type: "function",
        name: "onReceive",
        filePath: "app/BootBroadcastReceiver.java",
        lineRange: [18, 21],
        summary: "Receives boot broadcasts.",
        tags: ["receiver"],
        complexity: "simple",
        businessSignals: [
          { type: "behavior", text: "接收开机广播并启动后续处理" },
        ],
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
  writeFileSync(
    join(dir, "knowledge-graph.json"),
    JSON.stringify(graph, null, 2),
    "utf-8",
  );
}

describe("grounded product index cli", () => {
  it("prepares context packs without writing final facts", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-prepare-"));
    writeGraph(projectRoot);

    const result = await runProductIndexCli([
      projectRoot,
      "--prepare",
      "--platform",
      "android",
    ]);

    expect(result.contextPacks).toBeGreaterThan(0);
    expect(
      existsSync(
        join(
          projectRoot,
          ".understand-anything/intermediate/product-context-packs.json",
        ),
      ),
    ).toBe(true);
  });

  it("finalizes product index from extraction file", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ua-product-finalize-"));
    writeGraph(projectRoot);
    await runProductIndexCli([projectRoot, "--prepare", "--platform", "android"]);

    const packs = JSON.parse(
      readFileSync(
        join(
          projectRoot,
          ".understand-anything/intermediate/product-context-packs.json",
        ),
        "utf-8",
      ),
    );
    writeFileSync(
      join(
        projectRoot,
        ".understand-anything/intermediate/product-index-extractions.json",
      ),
      JSON.stringify(
        [
          {
            topicId: packs[0].topic.id,
            usedFiles: [
              {
                fileId: packs[0].candidateFiles[0].fileId,
                reason: "承载开机广播处理",
              },
            ],
            ignoredFiles: [],
            facts: [
              {
                type: "behavior",
                text: "应用接收开机广播后会启动后续首页初始化处理。",
                conditions: ["系统发出开机广播"],
                evidenceRefs: [packs[0].candidateFiles[0].anchors[0].anchorId],
                confidence: "confirmed",
              },
            ],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    const result = await runProductIndexCli([
      projectRoot,
      "--finalize",
      "--platform",
      "android",
    ]);

    expect(result.topics).toBe(1);
    expect(result.facts).toBe(1);
    expect(result.evidence).toBe(1);
    expect(
      existsSync(
        join(projectRoot, ".understand-anything/product-index.json"),
      ),
    ).toBe(true);
  });
});
