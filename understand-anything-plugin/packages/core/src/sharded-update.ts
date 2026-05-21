import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeGraph } from "./types.js";

const SHARD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface CodebaseShardedManifestShard {
  id: string;
  path: string;
  scopes?: string[];
  updatedAt?: string;
  gitCommitHash?: string;
  nodeCount?: number;
  edgeCount?: number;
}

export interface ShardUpdateMetadata {
  artifactHash: string;
  fingerprintPath?: string;
  lastPatchedAt?: string;
  lastRebuiltAt?: string;
  traceArtifactHash?: string;
  sourceCodeArtifactHash?: string;
  sourceDomainArtifactHash?: string;
}

export interface ManifestUpdateMetadata {
  gitCommitHash?: string;
  updatedAt: string;
  shards: Record<string, ShardUpdateMetadata>;
  warnings: string[];
}

export interface CodebaseShardedManifest {
  version: string;
  kind: "codebase-sharded";
  project?: Record<string, unknown>;
  overview?: Record<string, unknown>;
  shards: CodebaseShardedManifestShard[];
  warnings?: string[];
  update?: ManifestUpdateMetadata;
}

export function hashArtifactFile(path: string): string {
  const content = readFileSync(path);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function buildCodeManifestUpdate(
  projectRoot: string,
  manifest: CodebaseShardedManifest,
  gitCommitHash: string,
  now = new Date().toISOString(),
): ManifestUpdateMetadata {
  const warnings: string[] = [];
  const shards: Record<string, ShardUpdateMetadata> = {};

  for (const shard of manifest.shards) {
    if (!SHARD_ID_PATTERN.test(shard.id)) {
      warnings.push(`Skipped invalid shard id: ${shard.id}`);
      continue;
    }

    const expectedShardPath = `shards/${shard.id}.json`;
    if (shard.path !== expectedShardPath) {
      warnings.push(
        `Skipped invalid shard metadata for ${shard.id}: expected path ${expectedShardPath}`,
      );
      continue;
    }

    const shardPath = join(projectRoot, ".understand-anything", shard.path);
    if (!existsSync(shardPath)) {
      warnings.push(`${shard.path} is missing; update metadata skipped`);
      continue;
    }
    shards[shard.id] = {
      artifactHash: hashArtifactFile(shardPath),
      fingerprintPath: `fingerprints/shards/${shard.id}.json`,
      lastPatchedAt: now,
    };
  }

  return {
    gitCommitHash,
    updatedAt: now,
    shards,
    warnings,
  };
}

export function withCodeManifestUpdate(
  manifest: CodebaseShardedManifest,
  update: ManifestUpdateMetadata,
): CodebaseShardedManifest {
  return {
    ...manifest,
    update,
  };
}

export interface AffectedShardPlanInput {
  manifest: CodebaseShardedManifest;
  changedFiles: string[];
  knownShardGraphs: Record<string, KnowledgeGraph>;
  sourceFileExtensions: string[];
}

export interface AffectedCodeShard {
  id: string;
  path: string;
  scopes: string[];
  changedFiles: string[];
  structuralFiles: string[];
  cosmeticFiles: string[];
  deletedFiles: string[];
  reason: string;
}

export interface ShardedUpdatePlan {
  changedFiles: string[];
  affectedCodeShards: AffectedCodeShard[];
  unmappedChangedFiles: string[];
  warnings: string[];
}

export function buildAffectedShardPlan(input: AffectedShardPlanInput): ShardedUpdatePlan {
  const affected = new Map<string, AffectedCodeShard>();
  const unmappedChangedFiles: string[] = [];
  const warnings: string[] = [];

  for (const filePath of input.changedFiles) {
    const matches = input.manifest.shards.filter((shard) =>
      (shard.scopes ?? []).some((scope) => filePath === scope || filePath.startsWith(`${scope}/`)),
    );

    const fallbackMatches =
      matches.length > 0
        ? []
        : input.manifest.shards.filter((shard) =>
            (input.knownShardGraphs[shard.id]?.nodes ?? []).some(
              (node) => node.filePath === filePath,
            ),
          );

    const selected = matches.length > 0 ? matches : fallbackMatches;
    if (selected.length === 0) {
      if (input.sourceFileExtensions.some((ext) => filePath.endsWith(ext))) {
        unmappedChangedFiles.push(filePath);
      }
      warnings.push(`${filePath} did not match any shard`);
      continue;
    }

    for (const shard of selected) {
      const existing = affected.get(shard.id);
      const reason =
        matches.length > 0
          ? "changed file matched shard scope"
          : "changed file matched existing shard node";
      if (existing) {
        existing.changedFiles.push(filePath);
        continue;
      }
      affected.set(shard.id, {
        id: shard.id,
        path: shard.path,
        scopes: shard.scopes ?? [],
        changedFiles: [filePath],
        structuralFiles: [],
        cosmeticFiles: [],
        deletedFiles: [],
        reason,
      });
    }
  }

  return {
    changedFiles: input.changedFiles,
    affectedCodeShards: [...affected.values()],
    unmappedChangedFiles,
    warnings,
  };
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
