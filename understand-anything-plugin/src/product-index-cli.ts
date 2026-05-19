import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, join } from "node:path";
import {
  buildProductSignals,
  loadDomainGraph,
  loadGraph,
  saveProductIndex,
  type KnowledgeGraph,
  type ProductSignal,
  type ProductProfileOptions,
} from "@understand-anything/core";
import {
  buildProductBoundaryCandidates,
  buildTopicContextPacks,
  finalizeGroundedProductIndex,
  normaliseProductTopics,
  type ProductBoundaryCandidate,
  type ProductContextAnchor,
  type ProductTopicExtraction,
  type TopicContextPack,
} from "../packages/core/dist/product-index-builder.js";

export interface ProductIndexCliResult {
  projectRoot: string;
  productIndexPath: string;
  productSignalsPath?: string;
  contextPacksPath?: string;
  tracePath?: string;
  topics: number;
  facts: number;
  evidence: number;
  signals: number;
  contextPacks: number;
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
  const signalsPath = join(
    options.projectRoot,
    ".understand-anything",
    "product-signals.jsonl",
  );
  writeProductSignalsSidecar(signalsPath, signals);

  if (options.prepare && options.finalize) {
    throw new Error("--prepare and --finalize cannot be used together.");
  }

  const businessSignalCount = countBusinessSignals(graph);
  const intermediateDir = join(
    options.projectRoot,
    ".understand-anything",
    "intermediate",
  );
  const contextPacksPath = join(
    intermediateDir,
    "product-context-packs.json",
  );

  if (options.prepare) {
    const { candidates, contextPacks } = prepareGroundedProductContext(
      graph,
      domainGraph,
      builderOptions,
      signals,
    );

    mkdirSync(intermediateDir, { recursive: true });
    writeJson(
      join(intermediateDir, "product-boundary-candidates.json"),
      candidates,
    );
    writeJson(contextPacksPath, contextPacks);

    return {
      projectRoot: options.projectRoot,
      productIndexPath: getProductIndexPath(options.projectRoot),
      productSignalsPath: signalsPath,
      contextPacksPath,
      topics: contextPacks.length,
      facts: 0,
      evidence: 0,
      signals: businessSignalCount,
      contextPacks: contextPacks.length,
    };
  }

  if (options.finalize) {
    const contextPacks = readJson<TopicContextPack[]>(contextPacksPath);
    const extractions = readJson<ProductTopicExtraction[]>(
      join(intermediateDir, "product-index-extractions.json"),
    );
    const topics = contextPacks.map((pack) => pack.topic);
    const index = finalizeGroundedProductIndex({
      graph,
      topics,
      contextPacks,
      extractions,
      options: builderOptions,
    });
    saveProductIndex(options.projectRoot, index);

    const tracePath = join(
      options.projectRoot,
      ".understand-anything",
      "product-index-trace.json",
    );
    writeJson(tracePath, {
      contextPacks,
      extractions,
      warnings: index.coverage.warnings,
    });

    return {
      projectRoot: options.projectRoot,
      productIndexPath: getProductIndexPath(options.projectRoot),
      productSignalsPath: signalsPath,
      contextPacksPath,
      tracePath,
      topics: index.topics.length,
      facts: index.facts.length,
      evidence: index.evidence.length,
      signals: businessSignalCount,
      contextPacks: contextPacks.length,
    };
  }

  const { contextPacks } = prepareGroundedProductContext(
    graph,
    domainGraph,
    builderOptions,
    signals,
  );
  const topics = contextPacks.map((pack) => pack.topic);
  const extractions = buildFallbackProductExtractions(contextPacks);
  const index = finalizeGroundedProductIndex({
    graph,
    topics,
    contextPacks,
    extractions,
    options: builderOptions,
  });

  saveProductIndex(options.projectRoot, index);

  return {
    projectRoot: options.projectRoot,
    productIndexPath: getProductIndexPath(options.projectRoot),
    productSignalsPath: signalsPath,
    topics: index.topics.length,
    facts: index.facts.length,
    evidence: index.evidence.length,
    signals: businessSignalCount,
    contextPacks: contextPacks.length,
  };
}

function prepareGroundedProductContext(
  graph: KnowledgeGraph,
  domainGraph: KnowledgeGraph | undefined,
  builderOptions: ProductProfileOptions,
  signals: ProductSignal[],
) {
  const boundaryCandidates = buildProductBoundaryCandidates(
    graph,
    domainGraph,
    builderOptions,
  );
  const needsFallbackSignals =
    boundaryCandidates.length === 0 ||
    boundaryCandidates.every(
      (candidate) => candidate.businessSignals.length === 0,
    );
  const contextGraph = needsFallbackSignals
    ? addFallbackBusinessSignals(graph, signals)
    : graph;
  const candidates =
    boundaryCandidates.length > 0
      ? boundaryCandidates
      : buildFallbackBoundaryCandidates(contextGraph, signals);
  const topics = normaliseProductTopics(candidates);
  const contextPacks = buildTopicContextPacks(contextGraph, topics);

  return { candidates, topics, contextPacks };
}

function addFallbackBusinessSignals(
  graph: KnowledgeGraph,
  signals: ProductSignal[],
): KnowledgeGraph {
  const signalByNodeId = new Map(signals.map((signal) => [signal.nodeId, signal]));

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if ((node.businessSignals?.length ?? 0) > 0) {
        return node;
      }

      const signal = signalByNodeId.get(node.id);
      const type = normaliseSignalType(signal?.types[0]);
      if (!signal || !type) {
        return node;
      }

      return {
        ...node,
        businessSignals: [
          {
            type,
            text: node.summary || node.name,
          },
        ],
      };
    }),
  };
}

function normaliseSignalType(
  type: string | undefined,
): "entry" | "behavior" | "rule" | "display" | "data" | "integration" | undefined {
  if (
    type === "entry" ||
    type === "behavior" ||
    type === "rule" ||
    type === "display" ||
    type === "data" ||
    type === "integration"
  ) {
    return type;
  }

  return undefined;
}

function buildFallbackBoundaryCandidates(
  graph: KnowledgeGraph,
  signals: ProductSignal[],
): ProductBoundaryCandidate[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return signals.map((signal) => {
    const node = nodeById.get(signal.nodeId);
    return {
      id: `candidate:${signal.nodeId}`,
      rootNodeId: signal.nodeId,
      name: signal.symbol || node?.name || signal.nodeId,
      entryKind: signal.types[0] ?? "entry",
      ...(signal.filePath ? { filePath: signal.filePath } : {}),
      businessSignals: node?.businessSignals ?? [],
      neighborNodeIds: [],
      domainRefs: [],
    };
  });
}

function buildFallbackProductExtractions(
  contextPacks: TopicContextPack[],
): ProductTopicExtraction[] {
  return contextPacks.map((pack) => {
    const anchor = findFirstFileAnchor(pack);
    return {
      topicId: pack.topic.id,
      usedFiles: anchor
        ? [{ fileId: anchor.file.fileId, reason: "deterministic fallback" }]
        : [],
      ignoredFiles: [],
      facts: anchor
        ? [
            {
              type:
                anchor.anchor.type === "entry" ? "behavior" : anchor.anchor.type,
              text: `${pack.topic.name} 包含 ${anchor.anchor.text}。`,
              conditions: [],
              evidenceRefs: [anchor.anchor.anchorId],
              confidence: "inferred",
            },
          ]
        : [],
    };
  });
}

function findFirstFileAnchor(
  pack: TopicContextPack,
):
  | {
      file: TopicContextPack["candidateFiles"][number];
      anchor: ProductContextAnchor;
    }
  | undefined {
  for (const file of pack.candidateFiles) {
    const anchor = file.anchors[0];
    if (anchor) {
      return { file, anchor };
    }
  }
  return undefined;
}

function countBusinessSignals(graph: KnowledgeGraph): number {
  return graph.nodes.reduce(
    (count, node) => count + (node.businessSignals?.length ?? 0),
    0,
  );
}

function writeProductSignalsSidecar(
  signalsPath: string,
  signals: ProductSignal[],
): void {
  writeFileSync(
    signalsPath,
    signals.map((signal) => JSON.stringify(signal)).join("\n") +
      (signals.length > 0 ? "\n" : ""),
    "utf-8",
  );
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function getProductIndexPath(projectRoot: string): string {
  return join(projectRoot, ".understand-anything", "product-index.json");
}

interface ParsedArgs {
  projectRoot: string;
  platform: string;
  fast: boolean;
  prepare: boolean;
  finalize: boolean;
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

const BOOLEAN_FLAGS = new Set(["--fast", "--prepare", "--finalize"]);
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
    prepare: booleans.has("--prepare"),
    finalize: booleans.has("--finalize"),
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
