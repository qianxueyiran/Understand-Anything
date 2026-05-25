import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FingerprintStore } from "./fingerprint.js";
import { classifyChangedFiles } from "./incremental-update.js";
import type { PluginRegistry } from "./plugins/registry.js";
import type { DomainShardedManifest, ProductShardedManifest } from "./sharded-manifest.js";
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

function getValidManifestShards(
  manifest: CodebaseShardedManifest,
  warnings: string[],
): CodebaseShardedManifestShard[] {
  const validShards: CodebaseShardedManifestShard[] = [];

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

    validShards.push(shard);
  }

  return validShards;
}

export function buildCodeManifestUpdate(
  projectRoot: string,
  manifest: CodebaseShardedManifest,
  gitCommitHash: string,
  now = new Date().toISOString(),
): ManifestUpdateMetadata {
  const warnings: string[] = [];
  const shards: Record<string, ShardUpdateMetadata> = {};

  for (const shard of getValidManifestShards(manifest, warnings)) {
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

export interface TransactionalCodeManifestUpdateInput {
  projectRoot: string;
  manifest: CodebaseShardedManifest;
  headCommitHash: string;
  successfulShardIds: string[];
  failedShardIds: string[];
  warnings?: string[];
  now?: string;
}

export function buildTransactionalCodeManifestUpdate(
  input: TransactionalCodeManifestUpdateInput,
): ManifestUpdateMetadata {
  const now = input.now ?? new Date().toISOString();
  const warnings = [...(input.warnings ?? [])];
  const successfulShardIds = new Set(input.successfulShardIds);
  const failedShardIds = new Set(input.failedShardIds);
  const shards: Record<string, ShardUpdateMetadata> = {
    ...(input.manifest.update?.shards ?? {}),
  };

  for (const shard of getValidManifestShards(input.manifest, warnings)) {
    if (!successfulShardIds.has(shard.id)) {
      continue;
    }

    const shardPath = join(input.projectRoot, ".understand-anything", shard.path);
    if (!existsSync(shardPath)) {
      warnings.push(`${shard.path} is missing; update metadata skipped`);
      continue;
    }

    shards[shard.id] = {
      ...shards[shard.id],
      artifactHash: hashArtifactFile(shardPath),
      fingerprintPath:
        shards[shard.id]?.fingerprintPath ?? `fingerprints/shards/${shard.id}.json`,
      lastPatchedAt: now,
    };
  }

  return {
    gitCommitHash:
      failedShardIds.size === 0
        ? input.headCommitHash
        : input.manifest.update?.gitCommitHash,
    updatedAt: now,
    shards,
    warnings,
  };
}

export function buildDomainManifestUpdate(
  projectRoot: string,
  manifest: DomainShardedManifest,
  rebuiltShardIds: string[],
  codeUpdate: ManifestUpdateMetadata,
  now = new Date().toISOString(),
): ManifestUpdateMetadata {
  const rebuilt = new Set(rebuiltShardIds);
  const warnings: string[] = [];
  const shards: Record<string, ShardUpdateMetadata> = {
    ...(manifest.update?.shards ?? {}),
  };

  for (const shard of manifest.shards) {
    if (!rebuilt.has(shard.id)) {
      continue;
    }

    const artifactPath = join(projectRoot, ".understand-anything", shard.path);
    if (!existsSync(artifactPath)) {
      warnings.push(`${shard.path} is missing; domain update metadata skipped`);
      continue;
    }

    shards[shard.id] = {
      ...shards[shard.id],
      artifactHash: hashArtifactFile(artifactPath),
      sourceCodeArtifactHash: codeUpdate.shards[shard.id]?.artifactHash,
      lastRebuiltAt: now,
    };
  }

  return {
    updatedAt: now,
    shards,
    warnings,
  };
}

export function buildProductManifestUpdate(
  projectRoot: string,
  manifest: ProductShardedManifest,
  rebuiltShardIds: string[],
  codeUpdate: ManifestUpdateMetadata,
  domainUpdate: ManifestUpdateMetadata | undefined,
  now = new Date().toISOString(),
): ManifestUpdateMetadata {
  const rebuilt = new Set(rebuiltShardIds);
  const warnings: string[] = [];
  const shards: Record<string, ShardUpdateMetadata> = {
    ...(manifest.update?.shards ?? {}),
  };

  for (const shard of manifest.shards) {
    if (!rebuilt.has(shard.id)) {
      continue;
    }

    const artifactPath = join(projectRoot, ".understand-anything", shard.path);
    if (!existsSync(artifactPath)) {
      warnings.push(`${shard.path} is missing; product update metadata skipped`);
      continue;
    }

    const update: ShardUpdateMetadata = {
      ...shards[shard.id],
      artifactHash: hashArtifactFile(artifactPath),
      sourceCodeArtifactHash: codeUpdate.shards[shard.id]?.artifactHash,
      sourceDomainArtifactHash: domainUpdate?.shards[shard.id]?.artifactHash,
      lastRebuiltAt: now,
    };

    if (shard.tracePath) {
      const tracePath = join(projectRoot, ".understand-anything", shard.tracePath);
      if (existsSync(tracePath)) {
        update.traceArtifactHash = hashArtifactFile(tracePath);
      } else {
        warnings.push(`${shard.tracePath} is missing; trace update metadata skipped`);
      }
    }

    shards[shard.id] = update;
  }

  return {
    updatedAt: now,
    shards,
    warnings,
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
  baseCommitHash?: string;
  headCommitHash?: string;
  changedFiles: string[];
  affectedCodeShards: AffectedCodeShard[];
  unmappedChangedFiles: string[];
  warnings: string[];
}

export interface ShardedUpdatePlanInput extends AffectedShardPlanInput {
  baseCommitHash: string;
  headCommitHash: string;
}

export function buildAffectedShardPlan(input: AffectedShardPlanInput): ShardedUpdatePlan {
  const affected = new Map<string, AffectedCodeShard>();
  const unmappedChangedFiles: string[] = [];
  const warnings: string[] = [];
  const changedFiles = [...new Set(input.changedFiles)];
  const shards = getValidManifestShards(input.manifest, warnings);

  for (const filePath of changedFiles) {
    const matches = shards.filter((shard) =>
      (shard.scopes ?? []).some((scope) => filePath === scope || filePath.startsWith(`${scope}/`)),
    );

    const fallbackMatches =
      matches.length > 0
        ? []
        : shards.filter((shard) =>
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
    changedFiles,
    affectedCodeShards: [...affected.values()],
    unmappedChangedFiles,
    warnings,
  };
}

export function buildShardedUpdatePlan(input: ShardedUpdatePlanInput): ShardedUpdatePlan {
  const plan = buildAffectedShardPlan(input);
  return {
    ...plan,
    baseCommitHash: input.baseCommitHash,
    headCommitHash: input.headCommitHash,
  };
}

export function saveShardedUpdatePlan(
  projectRoot: string,
  plan: ShardedUpdatePlan,
): string {
  const path = join(
    projectRoot,
    ".understand-anything",
    "intermediate",
    "sharded-update-plan.json",
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(plan, null, 2), "utf-8");
  return path;
}

export interface ClassifyAffectedShardChangesInput {
  projectRoot: string;
  shard: AffectedCodeShard;
  fingerprintStore: FingerprintStore;
  registry: PluginRegistry;
}

export function classifyAffectedShardChanges(
  input: ClassifyAffectedShardChangesInput,
): AffectedCodeShard {
  const classification = classifyChangedFiles(
    input.projectRoot,
    input.shard.changedFiles,
    input.fingerprintStore,
    input.registry,
  );

  return {
    ...input.shard,
    structuralFiles: classification.structuralFiles,
    cosmeticFiles: classification.cosmeticFiles,
    deletedFiles: classification.deletedFiles,
  };
}

