import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
