import { describe, it, expect } from "vitest";
import {
  buildExplainContext,
  buildExplainContextFromGraphs,
  formatExplainPrompt,
} from "../explain-builder.js";
import type { KnowledgeGraph } from "@understand-anything/core";

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: ["express"],
    description: "A test project",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/auth.ts", type: "file", name: "auth.ts", filePath: "src/auth.ts", summary: "Auth module", tags: ["auth"], complexity: "complex" },
    { id: "file:src/db.ts", type: "file", name: "db.ts", filePath: "src/db.ts", summary: "Database", tags: ["db"], complexity: "simple" },
  ],
  edges: [
    { source: "file:src/auth.ts", target: "file:src/db.ts", type: "reads_from", direction: "forward", weight: 0.8 },
  ],
  layers: [
    { id: "layer:auth", name: "Auth Layer", description: "Authentication", nodeIds: ["file:src/auth.ts"] },
  ],
  tour: [],
};

describe("explain-builder", () => {
  describe("buildExplainContext", () => {
    it("finds the file node by path", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.targetNode?.id).toBe("file:src/auth.ts");
    });

    it("returns empty childNodes (file-only graphs)", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.childNodes).toEqual([]);
    });

    it("includes connected nodes", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      const allIds = ctx.connectedNodes.map((n) => n.id);
      expect(allIds).toContain("file:src/db.ts");
    });

    it("includes the layer", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.layer?.name).toBe("Auth Layer");
    });

    it("returns null targetNode for unknown paths", () => {
      const ctx = buildExplainContext(sampleGraph, "src/unknown.ts");
      expect(ctx.targetNode).toBeNull();
    });

    it("resolves file path only (no path:function notation)", () => {
      const graph: KnowledgeGraph = {
        version: "1.0.0",
        project: {
          name: "demo",
          description: "",
          languages: [],
          frameworks: [],
          analyzedAt: "2026-03-14T00:00:00Z",
          gitCommitHash: "abc123",
        },
        nodes: [
          { id: "file:src/auth.ts", type: "file", name: "auth.ts", filePath: "src/auth.ts", summary: "Auth", tags: ["auth"], complexity: "moderate" },
        ],
        edges: [],
        layers: [],
        tour: [],
      };

      const byFile = buildExplainContext(graph, "src/auth.ts");
      expect(byFile.targetNode?.id).toBe("file:src/auth.ts");
      expect(byFile.childNodes).toEqual([]);

      const bySymbol = buildExplainContext(graph, "src/auth.ts:login");
      expect(bySymbol.targetNode?.id).toBe("file:src/auth.ts");
      expect(bySymbol.childNodes).toEqual([]);
    });

    it("handles graphs with omitted layers and tour", () => {
      const slimGraph = structuredClone(sampleGraph);
      delete slimGraph.layers;
      delete slimGraph.tour;

      const ctx = buildExplainContext(slimGraph, "src/auth.ts");
      expect(ctx.targetNode?.id).toBe("file:src/auth.ts");
      expect(ctx.layer).toBeNull();
    });

    it("builds context from sharded graphs without requiring a complete root graph", () => {
      const homeShard: KnowledgeGraph = {
        ...sampleGraph,
        project: { ...sampleGraph.project, name: "home-shard" },
        nodes: [sampleGraph.nodes[0]],
        edges: [
          { source: "file:src/auth.ts", target: "file:src/db.ts", type: "reads_from", direction: "forward", weight: 0.8 },
        ],
        layers: [
          { id: "layer:auth", name: "Auth Layer", description: "Authentication", nodeIds: ["file:src/auth.ts"] },
        ],
      };
      const dbShard: KnowledgeGraph = {
        ...sampleGraph,
        project: { ...sampleGraph.project, name: "db-shard" },
        nodes: [sampleGraph.nodes[1]],
        edges: [],
        layers: [],
      };

      const ctx = buildExplainContextFromGraphs([homeShard, dbShard], "src/auth.ts");

      expect(ctx.projectName).toBe("home-shard");
      expect(ctx.targetNode?.id).toBe("file:src/auth.ts");
      expect(ctx.connectedNodes.map((node) => node.id)).toContain("file:src/db.ts");
      expect(ctx.layer?.name).toBe("Auth Layer");
    });
  });

  describe("formatExplainPrompt", () => {
    it("produces structured markdown for valid context", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      const prompt = formatExplainPrompt(ctx);
      expect(prompt).toContain("auth.ts");
      expect(prompt).toContain("Auth Layer");
    });

    it("produces helpful message for unknown path", () => {
      const ctx = buildExplainContext(sampleGraph, "src/unknown.ts");
      const prompt = formatExplainPrompt(ctx);
      expect(prompt).toContain("not found");
    });
  });
});
