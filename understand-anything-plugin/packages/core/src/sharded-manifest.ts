export const SHARD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface DomainShardedManifest {
  kind: "domain-sharded";
  source: {
    codeManifest: "knowledge-graph.json";
  };
  shards: Array<{
    id: string;
    path: string;
    sourceCodeShard: string;
  }>;
}

export interface ProductShardedManifest {
  kind: "product-sharded";
  shards: Array<{
    id: string;
    path: string;
    sourceDomainShard?: string;
    tracePath?: string;
  }>;
  warnings: string[];
}

export interface ProductShardedManifestInput {
  productShardFiles: string[];
  domainShardFiles: string[];
  traceFiles: string[];
}

export function isValidShardId(shardId: string): boolean {
  return SHARD_ID_PATTERN.test(shardId);
}

export function validateShardId(shardId: string): string {
  if (!isValidShardId(shardId)) {
    throw new Error(`Invalid shard id: ${shardId}`);
  }

  return shardId;
}

export function getTopLevelKind(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }

  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && kind.length > 0 ? kind : undefined;
}

export function buildDomainShardedManifest(shardFiles: string[]): DomainShardedManifest {
  return {
    kind: "domain-sharded",
    source: {
      codeManifest: "knowledge-graph.json",
    },
    shards: shardFiles.map((fileName) => {
      const shardId = getShardIdFromFileName(fileName);
      return {
        id: shardId,
        path: `domain-shards/${shardId}.json`,
        sourceCodeShard: `shards/${shardId}.json`,
      };
    }),
  };
}

export function buildProductShardedManifest(
  input: ProductShardedManifestInput
): ProductShardedManifest {
  const domainShardIds = new Set(input.domainShardFiles.map(getShardIdFromFileName));
  const traceShardIds = new Set(input.traceFiles.map(getShardIdFromFileName));
  const warnings: string[] = [];

  const shards = input.productShardFiles.map((fileName) => {
    const shardId = getShardIdFromFileName(fileName);
    const path = `product-shards/${shardId}.json`;
    const shard: ProductShardedManifest["shards"][number] = {
      id: shardId,
      path,
    };

    if (domainShardIds.has(shardId)) {
      shard.sourceDomainShard = `domain-shards/${shardId}.json`;
    }

    if (traceShardIds.has(shardId)) {
      shard.tracePath = `product-traces/${shardId}.json`;
    } else {
      warnings.push(`${path} has no matching product-traces/${shardId}.json`);
    }

    return shard;
  });

  return {
    kind: "product-sharded",
    shards,
    warnings,
  };
}

function getShardIdFromFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const shardId = baseName.endsWith(".json") ? baseName.slice(0, -".json".length) : baseName;
  return validateShardId(shardId);
}
