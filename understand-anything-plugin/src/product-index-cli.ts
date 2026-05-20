import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  type ProductBoundaryCandidate,
  type TopicContextPack,
} from "../packages/core/dist/product-index-builder.js";
import {
  applyTopicNormalization,
  buildProductIndexTrace,
  validateProductExtractions,
  validateTopicNormalization,
  type ProductPipelineWarning,
} from "../packages/core/dist/product-index-pipeline.js";

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

  const businessSignalCount = countBusinessSignals(graph);
  const intermediateDir = join(
    options.projectRoot,
    ".understand-anything",
    "intermediate",
  );
  const boundaryCandidatesPath = join(
    intermediateDir,
    "product-boundary-candidates.json",
  );
  const topicNormalizationPath = join(
    intermediateDir,
    "product-topic-normalization.json",
  );
  const contextPacksPath = join(
    intermediateDir,
    "product-context-packs.json",
  );
  const contextPacksByTopicDir = join(
    intermediateDir,
    "product-context-packs-by-topic",
  );
  const extractionsPath = join(
    intermediateDir,
    "product-index-extractions.json",
  );
  const extractionsByTopicDir = join(
    intermediateDir,
    "product-index-extractions-by-topic",
  );

  if (options.stage === "prepare-candidates") {
    const candidates = buildProductBoundaryCandidates(
      graph,
      domainGraph,
      builderOptions,
    );

    mkdirSync(intermediateDir, { recursive: true });
    writeJson(boundaryCandidatesPath, candidates);

    return {
      projectRoot: options.projectRoot,
      productIndexPath: getProductIndexPath(options.projectRoot),
      productSignalsPath: signalsPath,
      topics: 0,
      facts: 0,
      evidence: 0,
      signals: businessSignalCount,
      contextPacks: 0,
    };
  }

  if (options.stage === "build-context-packs") {
    const candidates = readJsonFile<ProductBoundaryCandidate[]>(
      boundaryCandidatesPath,
      "product-boundary-candidates.json not found. 请先运行 /understand-product --prepare-candidates。",
    );
    const normalizationData = readJsonFile<unknown>(
      topicNormalizationPath,
      "product-topic-normalization.json not found. LLM topic normalizer did not write normalization output.",
    );
    const { normalization } = validateTopicNormalization(normalizationData, candidates, graph);
    const topics = applyTopicNormalization(normalization, candidates);
    const contextPacks = buildTopicContextPacks(graph, topics);

    mkdirSync(intermediateDir, { recursive: true });
    writeJson(contextPacksPath, contextPacks);
    writeTopicContextPackFiles(contextPacksByTopicDir, contextPacks);

    return {
      projectRoot: options.projectRoot,
      productIndexPath: getProductIndexPath(options.projectRoot),
      productSignalsPath: signalsPath,
      contextPacksPath,
      topics: topics.length,
      facts: 0,
      evidence: 0,
      signals: businessSignalCount,
      contextPacks: contextPacks.length,
    };
  }

  if (options.stage === "finalize") {
    const candidates = readJsonFile<ProductBoundaryCandidate[]>(
      boundaryCandidatesPath,
      "product-boundary-candidates.json not found. 请先运行 /understand-product --prepare-candidates。",
    );
    const normalizationData = readJsonFile<unknown>(
      topicNormalizationPath,
      "product-topic-normalization.json not found. LLM topic normalizer did not write normalization output.",
    );
    const contextPacks = readJsonFile<TopicContextPack[]>(
      contextPacksPath,
      "product-context-packs.json not found. 请先运行 /understand-product --build-context-packs。",
    );
    const extractionsData = readProductExtractions(
      extractionsByTopicDir,
      extractionsPath,
    );
    writeJson(extractionsPath, extractionsData);
    const topicValidation = validateTopicNormalization(normalizationData, candidates, graph);
    const topics = applyTopicNormalization(topicValidation.normalization, candidates);
    const extractionValidation = validateProductExtractions(extractionsData, contextPacks);
    const validationWarnings = [
      ...topicValidation.warnings,
      ...extractionValidation.warnings,
    ];
    const index = finalizeGroundedProductIndex({
      graph,
      topics,
      contextPacks,
      extractions: extractionValidation.extractions,
      options: builderOptions,
      validationWarnings,
    });
    saveProductIndex(options.projectRoot, index);

    const tracePath = writeProductIndexTrace(
      options.projectRoot,
      buildProductIndexTrace({
        boundaryCandidates: candidates,
        topicNormalization: topicValidation.normalization,
        contextPacks,
        extractions: extractionValidation.extractions,
        warnings: index.coverage.warnings.map(toPipelineWarning),
      }),
    );

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

  const exhaustiveStage: never = options.stage;
  throw new Error(`Unsupported product-index stage: ${exhaustiveStage}`);
}

function writeProductIndexTrace(
  projectRoot: string,
  trace: unknown,
): string {
  const tracePath = join(
    projectRoot,
    ".understand-anything",
    "product-index-trace.json",
  );
  writeJson(tracePath, trace);
  return tracePath;
}

function writeTopicContextPackFiles(
  outputDir: string,
  contextPacks: TopicContextPack[],
): void {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  for (const pack of contextPacks) {
    writeJson(join(outputDir, `${topicFileName(pack.topic.id)}.json`), pack);
  }
}

function readProductExtractions(
  extractionsByTopicDir: string,
  extractionsPath: string,
): unknown[] {
  const fragmentPaths = listJsonFiles(extractionsByTopicDir);
  if (fragmentPaths.length > 0) {
    return fragmentPaths.flatMap((path) => {
      const data = readJsonFile<unknown>(path, "Invalid per-topic extraction file.");
      return Array.isArray(data) ? data : [data];
    });
  }

  if (existsSync(extractionsPath)) {
    const data = readJsonFile<unknown>(
      extractionsPath,
      "product-index-extractions.json not found. LLM analyzer did not write extraction output.",
    );
    return Array.isArray(data) ? data : [data];
  }

  throw new Error(
    `${extractionsByTopicDir}/*.json or ${extractionsPath}: product-index-extractions-by-topic/*.json or product-index-extractions.json not found. LLM analyzer did not write extraction output.`,
  );
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(dir, name));
}

function topicFileName(topicId: string): string {
  return topicId.replace(/[^a-zA-Z0-9._-]+/gu, "_");
}

function toPipelineWarning(warning: {
  code: string;
  message: string;
  severity?: "info" | "warning" | "error";
  stage?: string;
  topicId?: string;
  candidateId?: string;
  fileId?: string;
  evidenceRef?: string;
}): ProductPipelineWarning {
  return {
    code: warning.code,
    severity: warning.severity ?? "warning",
    stage: warning.stage ?? "finalize",
    message: warning.message,
    ...(warning.topicId ? { topicId: warning.topicId } : {}),
    ...(warning.candidateId ? { candidateId: warning.candidateId } : {}),
    ...(warning.fileId ? { fileId: warning.fileId } : {}),
    ...(warning.evidenceRef ? { evidenceRef: warning.evidenceRef } : {}),
  };
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

function readJsonFile<T>(path: string, missingMessage: string): T {
  if (!existsSync(path)) {
    throw new Error(`${path}: ${missingMessage}`);
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${path}: ${message}`);
  }
}

function getProductIndexPath(projectRoot: string): string {
  return join(projectRoot, ".understand-anything", "product-index.json");
}

interface ParsedArgs {
  projectRoot: string;
  platform: string;
  stage: "prepare-candidates" | "build-context-packs" | "finalize";
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

const BOOLEAN_FLAGS = new Set([
  "--prepare",
  "--prepare-candidates",
  "--build-context-packs",
  "--finalize",
]);
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
      "Usage: product-index-cli <project-root> (--prepare-candidates | --build-context-packs | --finalize) [--platform android]",
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
  const selectedModes = [
    booleans.has("--prepare") || booleans.has("--prepare-candidates"),
    booleans.has("--build-context-packs"),
    booleans.has("--finalize"),
  ].filter(Boolean).length;
  if (selectedModes > 1) {
    throw new Error("Choose only one of --prepare-candidates, --build-context-packs, or --finalize.");
  }

  const maxDepth = getNumberFlagValue(values, "--max-depth", 8);
  const maxNodesPerTopic = getNumberFlagValue(values, "--max-nodes-per-topic", 240);
  const maxFrontierPerDepth = getNumberFlagValue(
    values,
    "--max-frontier-per-depth",
    40,
  );
  const maxEvidencePerTopic = getNumberFlagValue(
    values,
    "--max-evidence-per-topic",
    50,
  );
  const hubDegreeThreshold = getNumberFlagValue(
    values,
    "--hub-degree-threshold",
    80,
  );
  const stage = parseStage(booleans);
  if (!stage) {
    throw new Error(
      "Please run through /understand-product or specify one stage: --prepare-candidates | --build-context-packs | --finalize",
    );
  }

  return {
    projectRoot,
    platform: values.get("--platform") ?? "android",
    stage,
    entryPatterns: entryPatternsValue
      ? entryPatternsValue
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
    maxDepth,
    maxNodesPerTopic,
    maxFrontierPerDepth,
    maxEvidencePerTopic,
    hubDegreeThreshold,
  };
}

function parseStage(
  booleans: Set<string>,
): ParsedArgs["stage"] | undefined {
  if (booleans.has("--prepare") || booleans.has("--prepare-candidates")) {
    return "prepare-candidates";
  }
  if (booleans.has("--build-context-packs")) {
    return "build-context-packs";
  }
  if (booleans.has("--finalize")) {
    return "finalize";
  }
  return undefined;
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
