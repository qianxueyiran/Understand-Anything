import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, isAbsolute, relative, basename } from "node:path";
import type { KnowledgeGraph, AnalysisMeta, ProjectConfig } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";
import type { EvidenceRef, ProductKnowledge } from "../product-knowledge.js";
import { validateGraph } from "../schema.js";
import { validateProductKnowledge } from "../product-knowledge.js";

const UA_DIR = ".understand-anything";
const GRAPH_FILE = "knowledge-graph.json";
const PRODUCT_KNOWLEDGE_FILE = "product-knowledge.json";
const META_FILE = "meta.json";
const FINGERPRINT_FILE = "fingerprints.json";
const CONFIG_FILE = "config.json";

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

function sanitiseProductKnowledgeFilePaths(
  knowledge: ProductKnowledge,
  projectRoot: string,
): ProductKnowledge {
  return {
    ...knowledge,
    productAreas: knowledge.productAreas.map((area) => ({
      ...area,
      codeRefs: sanitiseEvidenceRefs(area.codeRefs, projectRoot),
    })),
    concepts: knowledge.concepts.map((concept) => ({
      ...concept,
      evidence: sanitiseEvidenceRefs(concept.evidence, projectRoot),
      displayRules: concept.displayRules.map((rule) => ({
        ...rule,
        evidence: sanitiseEvidenceRefs(rule.evidence, projectRoot),
      })),
      dataFields: concept.dataFields.map((field) => ({
        ...field,
        evidence: sanitiseEvidenceRefs(field.evidence, projectRoot),
      })),
    })),
  };
}

function sanitiseEvidenceRefs(
  evidenceRefs: EvidenceRef[],
  projectRoot: string,
): EvidenceRef[] {
  return evidenceRefs.map((evidence) => {
    if (typeof evidence.filePath !== "string") return evidence;

    return {
      ...evidence,
      filePath: sanitisePath(evidence.filePath, projectRoot),
    };
  });
}

function sanitisePath(filePath: string, projectRoot: string): string {
  if (!isAbsolute(filePath)) {
    return filePath;
  }

  const normalRoot = projectRoot.endsWith("/")
    ? projectRoot
    : projectRoot + "/";

  if (filePath === projectRoot || filePath.startsWith(normalRoot)) {
    return relative(projectRoot, filePath);
  }

  return basename(filePath);
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

export function saveProductKnowledge(
  projectRoot: string,
  knowledge: ProductKnowledge,
  options?: { validate?: boolean },
): void {
  if (options?.validate !== false) {
    const result = validateProductKnowledge(knowledge);
    if (!result.success) {
      throw new Error(`Invalid product knowledge: ${formatProductKnowledgeError(result.error)}`);
    }
    knowledge = result.data;
  }

  const dir = ensureDir(projectRoot);
  const sanitised = sanitiseProductKnowledgeFilePaths(knowledge, projectRoot);
  writeFileSync(
    join(dir, PRODUCT_KNOWLEDGE_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadProductKnowledge(
  projectRoot: string,
  options?: { validate?: boolean },
): ProductKnowledge | null {
  const filePath = join(projectRoot, UA_DIR, PRODUCT_KNOWLEDGE_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateProductKnowledge(data);
    if (!result.success) {
      throw new Error(`Invalid product knowledge: ${formatProductKnowledgeError(result.error)}`);
    }
    return result.data;
  }

  return data as ProductKnowledge;
}

function formatProductKnowledgeError(error: string): string {
  if (error.includes("confirmed concepts")) {
    return `confirmed product concept validation failed: ${error}`;
  }

  return error;
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

const DEFAULT_CONFIG: ProjectConfig = { autoUpdate: false, outputLanguage: "en" };

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
