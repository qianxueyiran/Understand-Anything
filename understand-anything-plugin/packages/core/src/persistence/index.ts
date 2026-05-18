import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, isAbsolute, relative, basename, resolve } from "node:path";
import type { KnowledgeGraph, AnalysisMeta, ProjectConfig } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";
import { validateGraph } from "../schema.js";
import {
  validateProductIndex,
  type ProductEvidence,
  type ProductIndex,
} from "../product-index.js";

const UA_DIR = ".understand-anything";
const GRAPH_FILE = "knowledge-graph.json";
const META_FILE = "meta.json";
const FINGERPRINT_FILE = "fingerprints.json";
const CONFIG_FILE = "config.json";
const PRODUCT_INDEX_FILE = "product-index.json";

function ensureDir(projectRoot: string): string {
  const dir = join(projectRoot, UA_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitise every node's filePath before writing to disk.
 *
 * The analysis agent produces absolute paths like:
 *   /Users/alice/company/src/auth.ts
 *
 * We convert them to paths relative to projectRoot:
 *   src/auth.ts
 *
 * Three cases are handled:
 *   1. Path is inside projectRoot      → make it relative
 *   2. Path is absolute but outside    → keep only the filename (last segment)
 *   3. Path is already relative        → leave it untouched
 *
 * This means the developer's home directory, username, and company
 * directory layout are never written to knowledge-graph.json.
 */
function sanitiseFilePaths(
  graph: KnowledgeGraph,
  projectRoot: string,
): KnowledgeGraph {
  const normalRoot = projectRoot.endsWith("/")
    ? projectRoot
    : projectRoot + "/";

  const sanitisedNodes = graph.nodes.map((node) => {
    if (typeof node.filePath !== "string") return node;

    const fp = node.filePath;

    if (!isAbsolute(fp)) {
      // Already relative — nothing to do.
      return node;
    }

    if (fp.startsWith(normalRoot) || fp.startsWith(projectRoot)) {
      // Inside the project root — make it relative.
      return { ...node, filePath: relative(projectRoot, fp) };
    }

    // Absolute but outside the project root — use only the filename
    // so we leak as little as possible.
    return { ...node, filePath: basename(fp) };
  });

  return { ...graph, nodes: sanitisedNodes };
}

export function saveGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);

  // FIX — sanitise absolute file paths before persisting.
  // Without this, absolute paths like /Users/alice/company/src/auth.ts
  // are written verbatim into knowledge-graph.json and later served
  // by the dashboard server, leaking the developer's directory layout.
  const sanitised = sanitiseFilePaths(graph, projectRoot);

  writeFileSync(
    join(dir, GRAPH_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadGraph(
  projectRoot: string,
  options?: { validate?: boolean },
): KnowledgeGraph | null {
  const filePath = join(projectRoot, UA_DIR, GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateGraph(data);
    if (!result.success) {
      throw new Error(
        `Invalid knowledge graph: ${result.fatal ?? "unknown error"}`,
      );
    }
    return result.data as KnowledgeGraph;
  }

  return data as KnowledgeGraph;
}

export function saveMeta(projectRoot: string, meta: AnalysisMeta): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), "utf-8");
}

export function loadMeta(projectRoot: string): AnalysisMeta | null {
  const filePath = join(projectRoot, UA_DIR, META_FILE);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as AnalysisMeta;
}

export function saveFingerprints(projectRoot: string, store: FingerprintStore): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, FINGERPRINT_FILE), JSON.stringify(store, null, 2), "utf-8");
}

export function loadFingerprints(projectRoot: string): FingerprintStore | null {
  const filePath = join(projectRoot, UA_DIR, FINGERPRINT_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as FingerprintStore;
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG: ProjectConfig = { autoUpdate: false, outputLanguage: "zh" };

export function saveConfig(projectRoot: string, config: ProjectConfig): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), "utf-8");
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const filePath = join(projectRoot, UA_DIR, CONFIG_FILE);
  if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ProjectConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

const DOMAIN_GRAPH_FILE = "domain-graph.json";

export function saveDomainGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);
  const sanitised = sanitiseFilePaths(graph, projectRoot);
  writeFileSync(
    join(dir, DOMAIN_GRAPH_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadDomainGraph(
  projectRoot: string,
  options?: { validate?: boolean },
): KnowledgeGraph | null {
  const filePath = join(projectRoot, UA_DIR, DOMAIN_GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateGraph(data);
    if (!result.success) {
      throw new Error(
        `Invalid domain graph: ${result.fatal ?? "unknown error"}`,
      );
    }
    return result.data as KnowledgeGraph;
  }

  return data as KnowledgeGraph;
}

export function saveProductIndex(projectRoot: string, index: ProductIndex): void {
  const initialResult = validateProductIndex(index);
  if (!initialResult.success) {
    throw new Error(`Invalid product index: ${initialResult.error}`);
  }

  const sanitised = sanitiseProductEvidenceFilePaths(initialResult.data, projectRoot);
  const finalResult = validateProductIndex(sanitised);
  if (!finalResult.success) {
    throw new Error(`Invalid product index after path sanitisation: ${finalResult.error}`);
  }

  const dir = ensureDir(projectRoot);
  writeFileSync(
    join(dir, PRODUCT_INDEX_FILE),
    JSON.stringify(finalResult.data, null, 2),
    "utf-8",
  );
}

export function loadProductIndex(
  projectRoot: string,
  options?: { validate?: boolean },
): ProductIndex | null {
  const filePath = join(projectRoot, UA_DIR, PRODUCT_INDEX_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateProductIndex(data);
    if (!result.success) {
      throw new Error(`Invalid product index: ${result.error}`);
    }
    return result.data;
  }

  return data as ProductIndex;
}

function sanitiseProductEvidenceFilePaths(
  index: ProductIndex,
  projectRoot: string,
): ProductIndex {
  const evidence = index.evidence.map((item) =>
    sanitiseProductEvidenceFilePath(item, projectRoot),
  );
  return { ...index, evidence };
}

function sanitiseProductEvidenceFilePath(
  evidence: ProductEvidence,
  projectRoot: string,
): ProductEvidence {
  if (typeof evidence.filePath !== "string") {
    return evidence;
  }

  const safeFilePath = getSafeProductEvidenceFilePath(evidence.filePath, projectRoot);
  if (safeFilePath) {
    return safeFilePath === evidence.filePath
      ? evidence
      : { ...evidence, filePath: safeFilePath };
  }

  if (evidence.nodeId) {
    const { filePath: _filePath, ...rest } = evidence;
    return rest;
  }

  throw new Error(`Invalid product evidence filePath: ${evidence.filePath}`);
}

function getSafeProductEvidenceFilePath(
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
    const root = resolve(projectRoot);
    const relativePath = relative(root, filePath);
    if (!relativePath || isUnsafeRelativeProductPath(relativePath)) {
      return null;
    }
    return relativePath;
  }

  if (isUnsafeRelativeProductPath(filePath)) {
    return null;
  }

  return filePath;
}

function hasWindowsPathSyntax(filePath: string): boolean {
  return /^[a-zA-Z]:/.test(filePath) || filePath.startsWith("\\\\");
}

function isUnsafeRelativeProductPath(filePath: string): boolean {
  const parts = filePath.split("/");
  return (
    filePath.startsWith("/") ||
    parts.some((part) => part === "" || part === "..")
  );
}
