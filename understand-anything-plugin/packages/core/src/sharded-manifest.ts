export const SHARD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface DomainShardedManifest {
  version: "1.0.0";
  kind: "domain-sharded";
  source: {
    codeManifest: "knowledge-graph.json";
  };
  shards: Array<{
    id: string;
    path: string;
    sourceCodeShard: string;
  }>;
  warnings: string[];
}

export interface ProductShardedManifest {
  version: "1.0.0";
  kind: "product-sharded";
  source: {
    codeManifest: "knowledge-graph.json";
    domainManifest: "domain-graph.json";
  };
  shards: Array<{
    id: string;
    path: string;
    sourceCodeShard: string;
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
    version: "1.0.0",
    kind: "domain-sharded",
    source: {
      codeManifest: "knowledge-graph.json",
    },
    shards: shardFiles.flatMap((fileName) => {
      const shardId = parseShardIdFromFileName(fileName);
      if (shardId === undefined) {
        return [];
      }

      return [
        {
          id: shardId,
          path: `domain-shards/${shardId}.json`,
          sourceCodeShard: `shards/${shardId}.json`,
        },
      ];
    }),
    warnings: [],
  };
}

export function buildProductShardedManifest(
  input: ProductShardedManifestInput
): ProductShardedManifest {
  const domainShardIds = new Set(input.domainShardFiles.flatMap(parseShardIdToArray));
  const traceShardIds = new Set(input.traceFiles.flatMap(parseShardIdToArray));
  const warnings: string[] = [];

  const shards = input.productShardFiles.flatMap((fileName) => {
    const shardId = parseShardIdFromFileName(fileName);
    if (shardId === undefined) {
      return [];
    }

    const path = `product-shards/${shardId}.json`;
    const shard: ProductShardedManifest["shards"][number] = {
      id: shardId,
      path,
      sourceCodeShard: `shards/${shardId}.json`,
    };

    if (domainShardIds.has(shardId)) {
      shard.sourceDomainShard = `domain-shards/${shardId}.json`;
    }

    if (traceShardIds.has(shardId)) {
      shard.tracePath = `product-traces/${shardId}.json`;
    } else {
      warnings.push(`${path} has no matching product-traces/${shardId}.json`);
    }

    return [shard];
  });

  return {
    version: "1.0.0",
    kind: "product-sharded",
    source: {
      codeManifest: "knowledge-graph.json",
      domainManifest: "domain-graph.json",
    },
    shards,
    warnings,
  };
}

function parseShardIdToArray(fileName: string): string[] {
  const shardId = parseShardIdFromFileName(fileName);
  return shardId === undefined ? [] : [shardId];
}

function parseShardIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(".json") || fileName.includes("/") || fileName.includes("\\")) {
    return undefined;
  }

  const shardId = fileName.slice(0, -".json".length);
  return isValidShardId(shardId) ? shardId : undefined;
}
