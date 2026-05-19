import { describe, expect, it } from "vitest";
import { validateGraph } from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

function graphWithNode(node: Record<string, unknown>): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "video-app",
      languages: ["java"],
      frameworks: ["android"],
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
        ...node,
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

describe("businessSignals", () => {
  it("accepts minimal business signals on graph nodes", () => {
    const result = validateGraph(
      graphWithNode({
        businessSignals: [
          { type: "entry", text: "开机广播接收入口" },
          { type: "behavior", text: "接收开机广播并启动后续处理" },
        ],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.nodes[0].businessSignals).toEqual([
      { type: "entry", text: "开机广播接收入口" },
      { type: "behavior", text: "接收开机广播并启动后续处理" },
    ]);
  });

  it("drops malformed business signals during graph validation", () => {
    const result = validateGraph(
      graphWithNode({
        businessSignals: [
          { type: "display", text: "首页退出确认弹窗" },
          { type: "unknown", text: "错误类型" },
          { type: "data", text: "" },
          { type: "rule", text: "  " },
        ],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.nodes[0].businessSignals).toEqual([
      { type: "display", text: "首页退出确认弹窗" },
    ]);
    expect(result.issues.some((issue) => issue.category === "invalid-business-signal")).toBe(true);
  });
});
