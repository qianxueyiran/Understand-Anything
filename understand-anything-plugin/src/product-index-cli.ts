import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDeterministicProductIndex,
  buildProductSignals,
  loadDomainGraph,
  loadGraph,
  saveProductIndex,
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

  const graph = loadGraph(options.projectRoot);
  if (!graph) {
    throw new Error("Failed to load knowledge graph.");
  }

  const domainGraph =
    loadDomainGraph(options.projectRoot, { validate: false }) ?? undefined;

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

  const signals = buildProductSignals(graph, builderOptions);
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

function parseArgs(argv: string[]): ParsedArgs {
  const projectRoot = argv[0];
  if (!projectRoot) {
    throw new Error(
      "Usage: product-index-cli <project-root> [--platform android] [--fast]",
    );
  }

  const entryPatternsValue = getFlagValue(argv, "--entry-patterns", "");

  return {
    projectRoot,
    platform: getFlagValue(argv, "--platform", "android"),
    fast: argv.includes("--fast"),
    entryPatterns: entryPatternsValue
      ? entryPatternsValue
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
    maxDepth: getNumberFlagValue(argv, "--max-depth", 8),
    maxNodesPerTopic: getNumberFlagValue(argv, "--max-nodes-per-topic", 240),
    maxFrontierPerDepth: getNumberFlagValue(
      argv,
      "--max-frontier-per-depth",
      40,
    ),
    maxEvidencePerTopic: getNumberFlagValue(
      argv,
      "--max-evidence-per-topic",
      50,
    ),
    hubDegreeThreshold: getNumberFlagValue(
      argv,
      "--hub-degree-threshold",
      80,
    ),
  };
}

function getFlagValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function getNumberFlagValue(
  argv: string[],
  flag: string,
  fallback: number,
): number {
  const raw = getFlagValue(argv, flag, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
  }
  return value;
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
