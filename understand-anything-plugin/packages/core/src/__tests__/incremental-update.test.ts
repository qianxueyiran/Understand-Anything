import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyChangedFiles,
  normalizeChangedFiles,
  pruneGraphForChangedFiles,
} from "../incremental-update.js";
import { contentHash, type FingerprintStore } from "../fingerprint.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { KnowledgeGraph } from "../types.js";

describe("incremental update helpers", () => {
  it("deduplicates and preserves changed file order", () => {
    expect(
      normalizeChangedFiles([
        "src/a.ts",
        "src/b.ts",
        "src/a.ts",
        "src/c.ts",
        "src/b.ts",
      ]),
    ).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("prunes nodes and incident edges for structural and deleted files", () => {
    const graph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "Demo",
        languages: ["ts"],
        frameworks: [],
        description: "Demo",
        analyzedAt: "2026-05-21T00:00:00.000Z",
        gitCommitHash: "base",
      },
      nodes: [
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          filePath: "src/a.ts",
          summary: "A",
          tags: ["a"],
          complexity: "simple",
        },
        {
          id: "function:src/a.ts:run",
          type: "function",
          name: "run",
          filePath: "src/a.ts",
          summary: "run",
          tags: ["fn"],
          complexity: "simple",
        },
        {
          id: "file:src/deleted.ts",
          type: "file",
          name: "deleted.ts",
          filePath: "src/deleted.ts",
          summary: "Deleted",
          tags: ["deleted"],
          complexity: "simple",
        },
        {
          id: "file:src/kept.ts",
          type: "file",
          name: "kept.ts",
          filePath: "src/kept.ts",
          summary: "Kept",
          tags: ["kept"],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/a.ts",
          target: "function:src/a.ts:run",
          type: "contains",
          direction: "forward",
          weight: 1,
        },
        {
          source: "file:src/kept.ts",
          target: "function:src/a.ts:run",
          type: "calls",
          direction: "forward",
          weight: 0.7,
        },
        {
          source: "file:src/kept.ts",
          target: "file:src/deleted.ts",
          type: "imports",
          direction: "forward",
          weight: 0.5,
        },
        {
          source: "file:src/kept.ts",
          target: "file:src/kept.ts",
          type: "imports",
          direction: "forward",
          weight: 0.2,
        },
      ],
      layers: [],
      tour: [],
    };

    const pruned = pruneGraphForChangedFiles(
      graph,
      ["src/a.ts"],
      ["src/deleted.ts"],
    );

    expect(pruned.nodes.map((node) => node.id)).toEqual(["file:src/kept.ts"]);
    expect(pruned.edges).toEqual([
      {
        source: "file:src/kept.ts",
        target: "file:src/kept.ts",
        type: "imports",
        direction: "forward",
        weight: 0.2,
      },
    ]);
  });

  it("classifies structural cosmetic deleted and unchanged files through fingerprint analysis", () => {
    const root = mkdtempSync(join(tmpdir(), "ua-incremental-update-test-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "structural.ts"), "function run() {}\nfunction next() {}\n", "utf-8");
      writeFileSync(join(root, "src", "cosmetic.ts"), "function stable() { return 2; }\n", "utf-8");
      writeFileSync(join(root, "src", "unchanged.ts"), "function same() {}\n", "utf-8");
      writeFileSync(join(root, "src", "new.ts"), "function created() {}\n", "utf-8");

      const fingerprintStore: FingerprintStore = {
        version: "1.0.0",
        gitCommitHash: "base",
        generatedAt: "2026-05-21T00:00:00.000Z",
        files: {
          "src/structural.ts": {
            filePath: "src/structural.ts",
            contentHash: "old-structural",
            functions: [{ name: "run", params: [], exported: false, lineCount: 1 }],
            classes: [],
            imports: [],
            exports: [],
            totalLines: 1,
            hasStructuralAnalysis: true,
          },
          "src/cosmetic.ts": {
            filePath: "src/cosmetic.ts",
            contentHash: "old-cosmetic",
            functions: [{ name: "stable", params: [], exported: false, lineCount: 1 }],
            classes: [],
            imports: [],
            exports: [],
            totalLines: 1,
            hasStructuralAnalysis: true,
          },
          "src/unchanged.ts": {
            filePath: "src/unchanged.ts",
            contentHash: contentHash("function same() {}\n"),
            functions: [{ name: "same", params: [], exported: false, lineCount: 1 }],
            classes: [],
            imports: [],
            exports: [],
            totalLines: 1,
            hasStructuralAnalysis: true,
          },
          "src/deleted.ts": {
            filePath: "src/deleted.ts",
            contentHash: "old-deleted",
            functions: [{ name: "gone", params: [], exported: false, lineCount: 1 }],
            classes: [],
            imports: [],
            exports: [],
            totalLines: 1,
            hasStructuralAnalysis: true,
          },
        },
      };
      const registry = {
        analyzeFile(filePath: string, content: string) {
          const functions = Array.from(
            content.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gu),
          ).map((match) => ({
            name: match[1],
            params: match[2]
              ? match[2].split(",").map((item) => item.trim()).filter(Boolean)
              : [],
            lineRange: [1, 1] as [number, number],
          }));
          return { functions, classes: [], imports: [], exports: [] };
        },
      } as unknown as PluginRegistry;

      const result = classifyChangedFiles(root, [
        "src/structural.ts",
        "src/cosmetic.ts",
        "src/deleted.ts",
        "src/new.ts",
        "src/unchanged.ts",
      ], fingerprintStore, registry);

      expect(result.structuralFiles).toEqual(["src/structural.ts", "src/new.ts"]);
      expect(result.cosmeticFiles).toEqual(["src/cosmetic.ts"]);
      expect(result.deletedFiles).toEqual(["src/deleted.ts"]);
      expect(result.unchangedFiles).toEqual(["src/unchanged.ts"]);
      expect(result.newFiles).toEqual(["src/new.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
