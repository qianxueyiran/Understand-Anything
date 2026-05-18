import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, join } from "node:path";
import {
  buildDeterministicProductIndex,
  buildProductSignals,
  loadDomainGraph,
  loadGraph,
  saveProductIndex,
  type KnowledgeGraph,
  type ProductSignal,
  type ProductProfileOptions,
} from "@understand-anything/core";

export interface ProductIndexCliResult {
  projectRoot: string;
  productIndexPath: string;
  productSignalsPath: string;
  topics: number;
  evidence: number;
  signals: number;
}

export async function runProductIndexCli(
  argv: string[],
): Promise<ProductIndexCliResult> {
  const options = parseArgs(argv);
  const graphPath = join(
    options.projectRoot,
    ".understand-anything",
    "knowledge-graph.json",
  );

  if (!existsSync(graphPath)) {
    throw new Error(
      ".understand-anything/knowledge-graph.json not found. 请先运行 /understand。",
    );
  }

  const loadedGraph = loadGraph(options.projectRoot);
  if (!loadedGraph) {
    throw new Error("Failed to load knowledge graph.");
  }

  const loadedDomainGraph =
    loadDomainGraph(options.projectRoot, { validate: false }) ?? undefined;
  const graph = sanitiseKnowledgeGraphFilePaths(loadedGraph, options.projectRoot);
  const domainGraph = loadedDomainGraph
    ? sanitiseKnowledgeGraphFilePaths(loadedDomainGraph, options.projectRoot)
    : undefined;

  const builderOptions: ProductProfileOptions = {
    platform: options.platform,
    entryPatterns: options.entryPatterns,
    analyzedAt: new Date().toISOString(),
    maxDepth: options.maxDepth,
    maxNodesPerTopic: options.maxNodesPerTopic,
    maxFrontierPerDepth: options.maxFrontierPerDepth,
    maxEvidencePerTopic: options.maxEvidencePerTopic,
    hubDegreeThreshold: options.hubDegreeThreshold,
  };

  const signals = sanitiseProductSignals(
    buildProductSignals(graph, builderOptions),
    options.projectRoot,
  );
  const index = buildDeterministicProductIndex(
    graph,
    domainGraph,
    builderOptions,
  );

  const signalsPath = join(
    options.projectRoot,
    ".understand-anything",
    "product-signals.jsonl",
  );
  writeFileSync(
    signalsPath,
    signals.map((signal) => JSON.stringify(signal)).join("\n") +
      (signals.length > 0 ? "\n" : ""),
    "utf-8",
  );

  saveProductIndex(options.projectRoot, index);

  return {
    projectRoot: options.projectRoot,
    productIndexPath: join(
      options.projectRoot,
      ".understand-anything",
      "product-index.json",
    ),
    productSignalsPath: signalsPath,
    topics: index.topics.length,
    evidence: index.evidence.length,
    signals: signals.length,
  };
}

interface ParsedArgs {
  projectRoot: string;
  platform: string;
  fast: boolean;
  entryPatterns?: string[];
  maxDepth: number;
  maxNodesPerTopic: number;
  maxFrontierPerDepth: number;
  maxEvidencePerTopic: number;
  hubDegreeThreshold: number;
}

const VALUE_FLAGS = new Set([
  "--platform",
  "--entry-patterns",
  "--max-depth",
  "--max-nodes-per-topic",
  "--max-frontier-per-depth",
  "--max-evidence-per-topic",
  "--hub-degree-threshold",
]);

const BOOLEAN_FLAGS = new Set(["--fast"]);
const NUMERIC_FLAGS = new Set([
  "--max-depth",
  "--max-nodes-per-topic",
  "--max-frontier-per-depth",
  "--max-evidence-per-topic",
  "--hub-degree-threshold",
]);

function parseArgs(argv: string[]): ParsedArgs {
  const projectRoot = argv[0];
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error(
      "Usage: product-index-cli <project-root> [--platform android] [--fast]",
    );
  }

  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      throw new Error(`Unexpected argument: ${item}`);
    }

    if (BOOLEAN_FLAGS.has(item)) {
      booleans.add(item);
      continue;
    }

    if (!VALUE_FLAGS.has(item)) {
      throw new Error(`Unknown option: ${item}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${item}`);
    }

    values.set(item, value);
    index += 1;
  }

  const entryPatternsValue = values.get("--entry-patterns") ?? "";

  return {
    projectRoot,
    platform: values.get("--platform") ?? "android",
    fast: booleans.has("--fast"),
    entryPatterns: entryPatternsValue
      ? entryPatternsValue
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
    maxDepth: getNumberFlagValue(values, "--max-depth", 8),
    maxNodesPerTopic: getNumberFlagValue(values, "--max-nodes-per-topic", 240),
    maxFrontierPerDepth: getNumberFlagValue(
      values,
      "--max-frontier-per-depth",
      40,
    ),
    maxEvidencePerTopic: getNumberFlagValue(
      values,
      "--max-evidence-per-topic",
      50,
    ),
    hubDegreeThreshold: getNumberFlagValue(
      values,
      "--hub-degree-threshold",
      80,
    ),
  };
}

function getNumberFlagValue(
  values: Map<string, string>,
  flag: string,
  fallback: number,
): number {
  if (!NUMERIC_FLAGS.has(flag)) {
    throw new Error(`Internal error: ${flag} is not a numeric flag`);
  }

  const raw = values.get(flag) ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer: ${raw}`);
  }
  return value;
}

function sanitiseKnowledgeGraphFilePaths(
  graph: KnowledgeGraph,
  projectRoot: string,
): KnowledgeGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (typeof node.filePath !== "string") {
        return node;
      }

      const safeFilePath = getSafeSignalFilePath(node.filePath, projectRoot);
      if (safeFilePath) {
        return safeFilePath === node.filePath
          ? node
          : { ...node, filePath: safeFilePath };
      }

      if (node.id) {
        const { filePath: _filePath, ...rest } = node;
        return rest;
      }

      throw new Error(`Invalid knowledge graph node filePath: ${node.filePath}`);
    }),
  };
}

function sanitiseProductSignals(
  signals: ProductSignal[],
  projectRoot: string,
): ProductSignal[] {
  return signals.map((signal) => sanitiseProductSignal(signal, projectRoot));
}

function sanitiseProductSignal(
  signal: ProductSignal,
  projectRoot: string,
): ProductSignal {
  if (typeof signal.filePath !== "string") {
    return signal;
  }

  const safeFilePath = getSafeSignalFilePath(signal.filePath, projectRoot);
  if (safeFilePath) {
    return safeFilePath === signal.filePath
      ? signal
      : { ...signal, filePath: safeFilePath };
  }

  if (signal.nodeId) {
    const { filePath: _filePath, ...rest } = signal;
    return rest;
  }

  throw new Error(`Invalid product signal filePath: ${signal.filePath}`);
}

function getSafeSignalFilePath(
  filePath: string,
  projectRoot: string,
): string | null {
  if (
    hasWindowsPathSyntax(filePath) ||
    filePath.includes("\\") ||
    filePath.includes("\0")
  ) {
    return null;
  }

  if (isAbsolute(filePath)) {
    const relativePath = relative(resolve(projectRoot), filePath);
    if (!relativePath || isUnsafeRelativePath(relativePath)) {
      return null;
    }
    return relativePath;
  }

  if (isUnsafeRelativePath(filePath)) {
    return null;
  }

  return filePath;
}

function hasWindowsPathSyntax(filePath: string): boolean {
  return /^[a-zA-Z]:/.test(filePath) || filePath.startsWith("\\\\");
}

function isUnsafeRelativePath(filePath: string): boolean {
  const parts = filePath.split("/");
  return (
    filePath.startsWith("/") ||
    parts.some((part) => part === "" || part === "..")
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProductIndexCli(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
