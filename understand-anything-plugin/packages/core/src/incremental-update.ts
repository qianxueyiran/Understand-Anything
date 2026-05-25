import { analyzeChanges, type FingerprintStore } from "./fingerprint.js";
import type { PluginRegistry } from "./plugins/registry.js";
import type { KnowledgeGraph } from "./types.js";

export interface ChangedFileClassification {
  structuralFiles: string[];
  cosmeticFiles: string[];
  deletedFiles: string[];
  unchangedFiles: string[];
  newFiles: string[];
}

export function normalizeChangedFiles(files: string[]): string[] {
  return [...new Set(files)];
}

export function pruneGraphForChangedFiles(
  graph: KnowledgeGraph,
  structuralFiles: string[],
  deletedFiles: string[],
): KnowledgeGraph {
  const changed = new Set([...structuralFiles, ...deletedFiles]);
  const removedNodeIds = new Set(
    graph.nodes
      .filter((node) => typeof node.filePath === "string" && changed.has(node.filePath))
      .map((node) => node.id),
  );

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !removedNodeIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
    ),
  };
}

export function classifyChangedFiles(
  projectRoot: string,
  changedFiles: string[],
  fingerprintStore: FingerprintStore,
  registry: PluginRegistry,
): ChangedFileClassification {
  const analysis = analyzeChanges(
    projectRoot,
    changedFiles,
    fingerprintStore,
    registry,
  );

  return {
    structuralFiles: [
      ...analysis.structurallyChangedFiles,
      ...analysis.newFiles,
    ],
    cosmeticFiles: analysis.cosmeticOnlyFiles,
    deletedFiles: analysis.deletedFiles,
    unchangedFiles: analysis.unchangedFiles,
    newFiles: analysis.newFiles,
  };
}
