import type { GraphEdge, GraphNode, KnowledgeGraph } from "./types.js";
import type { FrameworkConfig, LanguageConfig } from "./languages/index.js";
import { FrameworkRegistry, LanguageRegistry } from "./languages/index.js";
import type {
  ProductEvidence,
  ProductEvidenceRole,
  ProductFact,
  ProductIndex,
  ProductCoverageWarning,
  ProductSignal,
  ProductSignalType,
  ProductTopic,
  ProductTopicKind,
} from "./product-index.js";

export interface ProductProfileOptions {
  platform: "android" | string;
  entryPatterns?: string[];
  analyzedAt?: string;
  maxDepth?: number;
  maxNodesPerTopic?: number;
  maxFrontierPerDepth?: number;
  maxEvidencePerTopic?: number;
  hubDegreeThreshold?: number;
}

export interface ProductEntrySeed {
  id: string;
  source: "entry-point";
  entryKind: string;
  nameCandidates: string[];
  entryNodeId: string;
  score: number;
}

export interface ProductBoundaryCandidate {
  id: string;
  rootNodeId: string;
  name: string;
  entryKind: string;
  filePath?: string;
  businessSignals: NonNullable<GraphNode["businessSignals"]>;
  neighborNodeIds: string[];
  domainRefs: string[];
}

export interface NormalizedProductTopic {
  id: string;
  name: string;
  summary: string;
  kind: ProductTopicKind;
  sourceCandidateIds: string[];
  rootNodeIds: string[];
  domainRefs: string[];
}

export interface ProductContextAnchor {
  anchorId: string;
  nodeId: string;
  type: "entry" | "behavior" | "rule" | "display" | "data" | "integration";
  text: string;
  symbol?: string;
  lineRange?: [number, number];
  snippetSummary: string;
}

export interface ProductContextFile {
  fileId: string;
  filePath: string;
  nodeSummaries: string[];
  businessSignals: Array<{ type: string; text: string; nodeId: string }>;
  structuralReasons: string[];
  anchors: ProductContextAnchor[];
}

export interface TopicContextPack {
  topic: NormalizedProductTopic;
  roots: string[];
  candidateFiles: ProductContextFile[];
  overflowFiles: string[];
}

export interface ProductExtractionFact {
  type: "behavior" | "rule" | "display" | "data" | "integration" | "mapping" | "lifecycle";
  text: string;
  conditions: string[];
  evidenceRefs: string[];
  confidence: "confirmed" | "inferred" | "uncertain";
}

export interface ProductTopicExtraction {
  topicId: string;
  sourceReads?: Array<{ fileId?: string; filePath: string; reason: string }>;
  usedFiles: Array<{ fileId: string; reason: string }>;
  ignoredFiles: Array<{ fileId: string; reason: string }>;
  facts: ProductExtractionFact[];
  warnings?: Array<{ code: string; message: string }>;
}

export interface FinalizeGroundedProductIndexInput {
  graph: KnowledgeGraph;
  topics: NormalizedProductTopic[];
  contextPacks: TopicContextPack[];
  extractions: ProductTopicExtraction[];
  options: ProductProfileOptions;
  validationWarnings?: ProductCoverageWarning[];
}

export interface ProductBoundaryCandidateOptions {
  entryPatterns?: string[];
  platform?: string;
  maxNeighborNodeIds?: number;
}

export interface TopicContextPackOptions {
  maxFilesPerTopic?: number;
  maxAnchorsPerFile?: number;
}

interface WeightedNeighbor {
  nodeId: string;
  type: GraphEdge["type"];
  weight: number;
}

interface FrontierItem {
  nodeId: string;
  score: number;
}

interface ScoredCandidate {
  nodeId: string;
  score: number;
  signalScore: number;
  productScore: number;
  topicTokenScore: number;
}

type ProductEntryPatternOptions = {
  entryPatterns?: string[];
  platform?: string;
};

const DEFAULT_ENTRY_PATTERNS = [
  /Activity$/i,
  /Fragment$/i,
  /DialogFragment$/i,
  /ActivityProxy$/i,
  /Router$/i,
  /RouteTable$/i,
  /Service$/i,
  /Receiver$/i,
  /Worker$/i,
  /Job$/i,
  /Scheduler$/i,
  /Handler$/i,
];

const NON_ENTRY_NAME_PATTERNS = [/^Base[A-Z]/, /^Abstract[A-Z]/, /^Core[A-Z]/];

const SIGNAL_KEYWORDS: Array<{
  role: ProductEvidenceRole;
  keywords: string[];
  baseScore: number;
}> = [
  {
    role: "entry",
    keywords: ["activity", "fragment", "router", "route", "service", "receiver", "worker"],
    baseScore: 0.75,
  },
  {
    role: "copy",
    keywords: ["string", "message", "text", "title", "subtitle", "label", "toast", "dialog"],
    baseScore: 0.55,
  },
  {
    role: "ui",
    keywords: [
      "show",
      "hide",
      "visible",
      "gone",
      "enabled",
      "disabled",
      "click",
      "button",
      "view",
      "入口",
      "按钮",
    ],
    baseScore: 0.62,
  },
  {
    role: "rule",
    keywords: [
      "allowed",
      "enable",
      "enabled",
      "disable",
      "disabled",
      "vip",
      "member",
      "permission",
      "policy",
      "guard",
      "可用",
    ],
    baseScore: 0.68,
  },
  {
    role: "data",
    keywords: ["dto", "model", "response", "field", "enum", "config", "status", "type", "字段"],
    baseScore: 0.58,
  },
  {
    role: "lifecycle",
    keywords: ["start", "stop", "pause", "resume", "callback", "listener", "schedule"],
    baseScore: 0.46,
  },
  {
    role: "network",
    keywords: ["api", "request", "upload", "sync", "retry", "http"],
    baseScore: 0.5,
  },
  {
    role: "storage",
    keywords: ["cache", "store", "database", "dao", "queue", "record"],
    baseScore: 0.46,
  },
  {
    role: "analytics",
    keywords: ["track", "event", "exposure", "click", "analytics"],
    baseScore: 0.5,
  },
  {
    role: "integration",
    keywords: ["sdk", "cast", "dlna", "push", "payment", "bluetooth", "system", "投屏"],
    baseScore: 0.72,
  },
];

const EDGE_TYPE_MULTIPLIERS: Partial<Record<GraphEdge["type"], number>> = {
  calls: 1,
  contains: 0.95,
  routes: 0.95,
  reads_from: 0.9,
  writes_to: 0.9,
  configures: 0.82,
  defines_schema: 0.78,
  triggers: 0.76,
  publishes: 0.72,
  subscribes: 0.72,
  implements: 0.68,
  inherits: 0.56,
  imports: 0.42,
  depends_on: 0.4,
  documents: 0.32,
  related: 0.22,
  similar_to: 0.2,
};

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_NODES_PER_TOPIC = 160;
const DEFAULT_MAX_FRONTIER_PER_DEPTH = 32;
const DEFAULT_MAX_EVIDENCE_PER_TOPIC = 50;
const DEFAULT_HUB_DEGREE_THRESHOLD = 80;
const DEFAULT_MAX_BOUNDARY_NEIGHBORS = 16;
const DEFAULT_MAX_FILES_PER_TOPIC = 30;
const DEFAULT_MAX_ANCHORS_PER_FILE = 5;
const STRONG_HUB_PRODUCT_SCORE = 0.7;
const HUB_SCORE_PENALTY = 0.25;
const BOUNDARY_SIGNAL_TYPES = new Set(["entry", "display", "rule", "data", "integration"]);
const COMMON_DOMAIN_TOKENS = new Set([
  "activity",
  "fragment",
  "service",
  "receiver",
  "worker",
  "router",
  "player",
  "playback",
  "screen",
  "page",
  "view",
  "common",
  "base",
  "helper",
  "manager",
  "controller",
  "feature",
  "android",
  "kotlin",
  "java",
  "main",
  "app",
  "src",
  "model",
]);

export function enumerateProductEntrySeeds(
  graph: KnowledgeGraph,
  options: ProductProfileOptions,
): ProductEntrySeed[] {
  const patterns = compileEntryPatterns(graph, options);

  return graph.nodes
    .filter((node) => isEntryCandidate(node, patterns))
    .map((node) => {
      const nameCandidates = buildNameCandidates(node);
      return {
        id: `seed:${node.id}`,
        source: "entry-point" as const,
        entryKind: inferEntryKind(node),
        nameCandidates,
        entryNodeId: node.id,
        score: Math.max(scoreTextForProductSignals(nodeSearchText(node)), 0.65),
      };
    })
    .sort((a, b) => b.score - a.score || a.entryNodeId.localeCompare(b.entryNodeId));
}

export function buildProductSignals(
  graph: KnowledgeGraph,
  options: ProductProfileOptions,
): ProductSignal[] {
  const entryNodeIds = new Set(
    enumerateProductEntrySeeds(graph, options).map((seed) => seed.entryNodeId),
  );
  const signals: ProductSignal[] = [];

  for (const node of graph.nodes) {
    const text = nodeSearchText(node);
    const roles = inferSignalRoles(text);
    if (entryNodeIds.has(node.id) && !roles.includes("entry")) {
      roles.unshift("entry");
    }

    const score = Math.max(
      scoreTextForProductSignals(text),
      entryNodeIds.has(node.id) ? 0.82 : 0,
    );

    if (roles.length === 0 || score < 0.25) {
      continue;
    }

    signals.push({
      id: `sig:${signals.length + 1}`,
      nodeId: node.id,
      ...(node.filePath ? { filePath: node.filePath } : {}),
      symbol: node.name,
      ...(node.lineRange ? { lineRange: node.lineRange } : {}),
      types: roles.slice(0, 5),
      tokens: extractTokens(text).slice(0, 16),
      score,
    });
  }

  return signals;
}

export function buildProductBoundaryCandidates(
  graph: KnowledgeGraph,
  domainGraph?: KnowledgeGraph,
  options: ProductBoundaryCandidateOptions = {},
): ProductBoundaryCandidate[] {
  const patterns = compileEntryPatterns(graph, options);
  const adjacency = buildAdjacency(graph.edges);
  const maxNeighbors = options.maxNeighborNodeIds ?? DEFAULT_MAX_BOUNDARY_NEIGHBORS;

  return graph.nodes
    .map((node) => {
      const businessSignals = node.businessSignals ?? [];
      const boundarySignals = businessSignals.filter((signal) => BOUNDARY_SIGNAL_TYPES.has(signal.type));
      const entryCandidate = isEntryCandidate(node, patterns);
      if (!entryCandidate && boundarySignals.length === 0) {
        return undefined;
      }

      const entryKind = entryCandidate ? inferEntryKind(node) : boundarySignals[0]?.type ?? "entry";
      if (businessSignals.length === 0 && entryKind === "entry") {
        return undefined;
      }

      const domainCandidates = [
        node.name,
        node.filePath,
        ...businessSignals.map((signal) => signal.text),
      ].filter(isString);

      return {
        id: `candidate:${node.id}`,
        rootNodeId: node.id,
        name: node.name,
        entryKind,
        ...(node.filePath ? { filePath: node.filePath } : {}),
        businessSignals,
        neighborNodeIds: uniqueStrings(
          (adjacency.get(node.id) ?? [])
            .sort((a, b) => b.weight - a.weight || a.nodeId.localeCompare(b.nodeId))
            .map((neighbor) => neighbor.nodeId),
        ).slice(0, maxNeighbors),
        domainRefs: collectDomainRefs(domainGraph, domainCandidates),
      } satisfies ProductBoundaryCandidate;
    })
    .filter((candidate): candidate is ProductBoundaryCandidate => candidate !== undefined)
    .sort(
      (a, b) =>
        boundaryCandidateRank(b) - boundaryCandidateRank(a) ||
        a.rootNodeId.localeCompare(b.rootNodeId),
    );
}

export function normaliseProductTopics(
  candidates: ProductBoundaryCandidate[],
): NormalizedProductTopic[] {
  const seenIds = new Set<string>();

  return candidates.map((candidate, index) => {
    const name = candidate.businessSignals[0]?.text || candidate.name || candidate.rootNodeId;
    const baseSlug = slugifyTopicId(name) || slugifyTopicId(candidate.rootNodeId) || `candidate-${index + 1}`;
    const id = uniqueTopicId(`topic:${baseSlug}`, seenIds);

    return {
      id,
      name,
      summary: `${name} 相关产品主题。`,
      kind: topicKindForEntry(candidate.entryKind),
      sourceCandidateIds: [candidate.id],
      rootNodeIds: [candidate.rootNodeId],
      domainRefs: uniqueStrings(candidate.domainRefs),
    };
  });
}

export function buildTopicContextPacks(
  graph: KnowledgeGraph,
  topics: NormalizedProductTopic[],
  options: TopicContextPackOptions = {},
): TopicContextPack[] {
  const maxFiles = options.maxFilesPerTopic ?? DEFAULT_MAX_FILES_PER_TOPIC;
  const maxAnchors = options.maxAnchorsPerFile ?? DEFAULT_MAX_ANCHORS_PER_FILE;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(graph.edges);

  return topics.map((topic) => {
    const recalled = recallTopicNodes(topic.rootNodeIds, nodeById, adjacency);
    const fileGroups = new Map<string, Array<{ node: GraphNode; reasons: Set<string> }>>();

    for (const [nodeId, reasons] of recalled) {
      const node = nodeById.get(nodeId);
      if (!node?.filePath || isCommonInfrastructureNode(node)) {
        continue;
      }

      const group = fileGroups.get(node.filePath) ?? [];
      group.push({ node, reasons });
      fileGroups.set(node.filePath, group);
    }

    const files = Array.from(fileGroups.entries())
      .map(([filePath, items]) => buildProductContextFile(filePath, items, maxAnchors))
      .sort((a, b) => contextFileRank(b) - contextFileRank(a) || a.filePath.localeCompare(b.filePath));

    return {
      topic,
      roots: topic.rootNodeIds.filter((rootNodeId) => nodeById.has(rootNodeId)),
      candidateFiles: files.slice(0, maxFiles),
      overflowFiles: files.slice(maxFiles).map((file) => file.filePath),
    };
  });
}

export function finalizeGroundedProductIndex(input: FinalizeGroundedProductIndexInput): ProductIndex {
  const { graph, topics: inputTopics, contextPacks, extractions, options } = input;
  const analyzedAt = options.analyzedAt ?? graph.project.analyzedAt;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const packByTopicId = new Map(contextPacks.map((pack) => [pack.topic.id, pack]));
  const extractionByTopicId = new Map(extractions.map((extraction) => [extraction.topicId, extraction]));
  const evidenceById = new Map<string, ProductEvidence>();
  const facts: ProductFact[] = [];
  const outputTopics: ProductTopic[] = [];
  const warnings: ProductIndex["coverage"]["warnings"] = [...(input.validationWarnings ?? [])];

  for (const topic of inputTopics) {
    const pack = packByTopicId.get(topic.id);
    const extraction = extractionByTopicId.get(topic.id);
    if (!pack || !extraction) {
      continue;
    }

    const anchorById = indexAnchorsById(pack);
    const factIds: string[] = [];
    const topicEvidenceIds: string[] = [];
    const entryEvidenceIds: string[] = [];

    extraction.facts.forEach((extractionFact, factIndex) => {
      const anchors: ProductContextAnchor[] = [];
      for (const evidenceRef of uniqueStrings(extractionFact.evidenceRefs)) {
        const anchor = anchorById.get(evidenceRef);
        if (!anchor) {
          warnings.push({
            code: "invalid-evidence-ref",
            severity: "warning",
            stage: "finalize",
            message: `Dropped invalid evidence ref ${evidenceRef}.`,
            topicId: topic.id,
            evidenceRef,
          });
          continue;
        }
        anchors.push(anchor);
        if (anchors.length >= 3) {
          break;
        }
      }

      if (anchors.length === 0) {
        warnings.push({
          code: "fact-without-evidence",
          severity: "warning",
          stage: "finalize",
          message: `Dropped fact for ${topic.id} because it did not reference valid evidence anchors.`,
          topicId: topic.id,
        });
        return;
      }

      const evidenceIds = anchors.map((anchor) => {
        const evidence = buildEvidenceFromAnchor(anchor, nodeById.get(anchor.nodeId), extractionFact.confidence);
        const existingEvidence = evidenceById.get(evidence.id);
        if (existingEvidence) {
          existingEvidence.confidence = highestEvidenceConfidence(
            existingEvidence.confidence,
            evidence.confidence,
          );
        } else {
          evidenceById.set(evidence.id, evidence);
        }
        return evidence.id;
      });
      const fact: ProductFact = {
        id: `fact:${topic.id}:${factIndex + 1}`,
        topicIds: [topic.id],
        type: extractionFact.type,
        text: extractionFact.text,
        conditions: extractionFact.conditions,
        evidenceIds: uniqueStrings(evidenceIds),
        confidence: extractionFact.confidence,
        maturity: "summarized",
      };

      facts.push(fact);
      factIds.push(fact.id);
      topicEvidenceIds.push(...fact.evidenceIds);
      entryEvidenceIds.push(
        ...anchors
          .filter((anchor) => anchor.type === "entry" || topic.rootNodeIds.includes(anchor.nodeId))
          .map((anchor) => evidenceIdForAnchor(anchor)),
      );
    });

    if (factIds.length === 0) {
      warnings.push({
        code: "topic-without-facts",
        severity: "warning",
        stage: "finalize",
        message: `Dropped topic ${topic.id} because it had no facts with valid evidence.`,
        topicId: topic.id,
      });
      continue;
    }

    outputTopics.push({
      id: topic.id,
      kind: topic.kind,
      name: topic.name,
      aliases: [],
      summary: topic.summary,
      status: "summarized",
      sourceCandidateIds: topic.sourceCandidateIds,
      factIds: uniqueStrings(factIds),
      entryEvidenceIds: uniqueStrings(entryEvidenceIds).filter((evidenceId) => evidenceById.has(evidenceId)),
      evidenceIds: uniqueStrings(topicEvidenceIds),
      domainRefs: topic.domainRefs,
    });
  }

  const outputFactIds = new Set(outputTopics.flatMap((topic) => topic.factIds));
  const outputFacts = facts.filter((fact) => outputFactIds.has(fact.id));
  const outputEvidenceIds = new Set([
    ...outputTopics.flatMap((topic) => topic.entryEvidenceIds),
    ...outputTopics.flatMap((topic) => topic.evidenceIds),
    ...outputFacts.flatMap((fact) => fact.evidenceIds),
  ]);
  const evidence = Array.from(evidenceById.values()).filter((item) => outputEvidenceIds.has(item.id));

  return {
    version: "1.0.0",
    kind: "product-index",
    project: {
      name: graph.project.name,
      platforms: [options.platform],
      languages: graph.project.languages,
      frameworks: graph.project.frameworks,
      analyzedAt,
      gitCommitHash: graph.project.gitCommitHash,
    },
    sources: {
      knowledgeGraph: {
        path: ".understand-anything/knowledge-graph.json",
        gitCommitHash: graph.project.gitCommitHash,
        required: true,
      },
    },
    topics: outputTopics,
    facts: outputFacts,
    evidence,
    coverage: {
      platformProfiles: [options.platform],
      entryPoints: inputTopics.filter((topic) => topic.rootNodeIds.length > 0).length,
      indexedTopics: outputTopics.length,
      confirmedEvidence: evidence.filter((item) => item.confidence === "confirmed").length,
      generatedFacts: outputFacts.length,
      warnings,
    },
    quality: {
      groundedFacts: outputFacts.length,
      ignoredFiles: extractions.reduce((count, extraction) => count + extraction.ignoredFiles.length, 0),
      overflowFiles: contextPacks.reduce((count, pack) => count + pack.overflowFiles.length, 0),
    },
  };
}

export function buildDeterministicProductIndex(
  graph: KnowledgeGraph,
  domainGraph: KnowledgeGraph | undefined,
  options: ProductProfileOptions,
): ProductIndex {
  const analyzedAt = options.analyzedAt ?? graph.project.analyzedAt;
  const seeds = enumerateProductEntrySeeds(graph, options);
  const signals = buildProductSignals(graph, options);
  const signalByNodeId = groupSignalsByNodeId(signals);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(graph.edges);
  const degreeByNodeId = buildDegreeMap(graph.edges);
  const evidenceById = new Map<string, ProductEvidence>();
  const topics: ProductTopic[] = [];

  for (const seed of seeds) {
    const expandedNodeIds = expandFromSeed(
      seed,
      graph,
      adjacency,
      degreeByNodeId,
      signalByNodeId,
      options,
    );
    const evidenceIds: string[] = [];
    const entryEvidenceIds: string[] = [];

    for (const nodeId of expandedNodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) {
        continue;
      }

      const signalsForNode = signalByNodeId.get(nodeId) ?? [];
      if (signalsForNode.length === 0 && nodeId !== seed.entryNodeId) {
        continue;
      }

      const evidence = buildEvidenceFromNode(node, signalsForNode, nodeId === seed.entryNodeId);
      if (!evidenceById.has(evidence.id)) {
        evidenceById.set(evidence.id, evidence);
      }

      evidenceIds.push(evidence.id);
      if (nodeId === seed.entryNodeId) {
        entryEvidenceIds.push(evidence.id);
      }

      if (evidenceIds.length >= (options.maxEvidencePerTopic ?? DEFAULT_MAX_EVIDENCE_PER_TOPIC)) {
        break;
      }
    }

    if (evidenceIds.length === 0) {
      continue;
    }

    const topicName = seed.nameCandidates[0] ?? seed.entryNodeId;
    topics.push({
      id: `topic:${seed.entryNodeId}`,
      kind: topicKindForEntry(seed.entryKind),
      name: topicName,
      aliases: seed.nameCandidates.slice(1, 6),
      summary: `${topicName} 相关产品入口，已索引 ${evidenceIds.length} 条代码证据。`,
      status: evidenceIds.length > 1 ? "indexed" : "seeded",
      sourceCandidateIds: [],
      factIds: [],
      entryEvidenceIds: uniqueStrings(entryEvidenceIds),
      evidenceIds: uniqueStrings(evidenceIds),
      domainRefs: collectDomainRefs(domainGraph, seed.nameCandidates),
    });
  }

  const evidence = Array.from(evidenceById.values());
  return {
    version: "1.0.0",
    kind: "product-index",
    project: {
      name: graph.project.name,
      platforms: [options.platform],
      languages: graph.project.languages,
      frameworks: graph.project.frameworks,
      analyzedAt,
      gitCommitHash: graph.project.gitCommitHash,
    },
    sources: {
      knowledgeGraph: {
        path: ".understand-anything/knowledge-graph.json",
        gitCommitHash: graph.project.gitCommitHash,
        required: true,
      },
      domainGraph: domainGraph
        ? {
            path: ".understand-anything/domain-graph.json",
            available: true,
            required: false,
          }
        : undefined,
      signals: {
        path: ".understand-anything/product-signals.jsonl",
        available: signals.length > 0,
        count: signals.length,
        indexedNodes: new Set(signals.map((signal) => signal.nodeId)).size,
        truncated: false,
      },
    },
    topics,
    facts: [],
    evidence,
    coverage: {
      platformProfiles: [options.platform],
      entryPoints: seeds.length,
      indexedTopics: topics.length,
      confirmedEvidence: evidence.filter((item) => item.confidence === "confirmed").length,
      generatedFacts: 0,
      warnings: [],
    },
  };
}

function compileEntryPatterns(
  graph: KnowledgeGraph,
  options: ProductEntryPatternOptions = {},
): RegExp[] {
  const patterns = resolveProductEntryPatterns(graph, options);
  if (patterns.length === 0) {
    return DEFAULT_ENTRY_PATTERNS;
  }

  return patterns.map((pattern) => globPatternToRegex(pattern));
}

function resolveProductEntryPatterns(
  graph: KnowledgeGraph,
  options: ProductEntryPatternOptions,
): string[] {
  if (options.entryPatterns && options.entryPatterns.length > 0) {
    return uniqueStrings(options.entryPatterns.filter(isString));
  }

  const languageRegistry = LanguageRegistry.createDefault();
  const frameworkRegistry = FrameworkRegistry.createDefault();
  const languages = uniqueStrings(graph.project.languages ?? []);
  const frameworks = uniqueStrings([
    ...(graph.project.frameworks ?? []),
    ...(options.platform ? [options.platform] : []),
  ]);
  const patterns: string[] = [];

  for (const languageId of languages) {
    const config = findLanguageConfig(languageRegistry, languageId);
    if (config) {
      patterns.push(...config.filePatterns.entryPoints);
    }
  }

  for (const frameworkId of frameworks) {
    const config = findFrameworkConfig(frameworkRegistry, frameworkId);
    if (config?.entryPoints) {
      patterns.push(...config.entryPoints);
    }
  }

  return uniqueStrings(patterns.filter(isString));
}

function findLanguageConfig(registry: LanguageRegistry, rawId: string): LanguageConfig | null {
  const normalized = normalizeProfileId(rawId);
  return (
    registry.getById(normalized) ??
    registry.getAllLanguages().find(
      (config) =>
        normalizeProfileId(config.id) === normalized ||
        normalizeProfileId(config.displayName) === normalized,
    ) ??
    null
  );
}

function findFrameworkConfig(registry: FrameworkRegistry, rawId: string): FrameworkConfig | null {
  const normalized = normalizeProfileId(rawId);
  return (
    registry.getById(normalized) ??
    registry.getAllFrameworks().find(
      (config) =>
        normalizeProfileId(config.id) === normalized ||
        normalizeProfileId(config.displayName) === normalized,
    ) ??
    null
  );
}

function normalizeProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function boundaryCandidateRank(candidate: ProductBoundaryCandidate): number {
  const signalScore = candidate.businessSignals.reduce(
    (score, signal) => score + (BOUNDARY_SIGNAL_TYPES.has(signal.type) ? 2 : 1),
    0,
  );
  const entryScore = candidate.entryKind === "entry" ? 0 : 1;
  return signalScore + entryScore;
}

function uniqueTopicId(baseId: string, seenIds: Set<string>): string {
  let id = baseId;
  let suffix = 2;
  while (seenIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(id);
  return id;
}

function slugifyTopicId(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

function recallTopicNodes(
  rootNodeIds: string[],
  nodeById: Map<string, GraphNode>,
  adjacency: Map<string, WeightedNeighbor[]>,
): Map<string, Set<string>> {
  const recalled = new Map<string, Set<string>>();

  for (const rootNodeId of rootNodeIds) {
    if (!nodeById.has(rootNodeId)) {
      continue;
    }

    addRecallReason(recalled, rootNodeId, "root");
    const firstHop = adjacency.get(rootNodeId) ?? [];
    for (const neighbor of firstHop) {
      addRecallReason(recalled, neighbor.nodeId, "direct-neighbor");

      for (const secondHop of adjacency.get(neighbor.nodeId) ?? []) {
        const secondHopNode = nodeById.get(secondHop.nodeId);
        if (secondHopNode?.businessSignals && secondHopNode.businessSignals.length > 0) {
          addRecallReason(recalled, secondHop.nodeId, "business-signal-hop");
        }
      }
    }
  }

  return recalled;
}

function addRecallReason(recalled: Map<string, Set<string>>, nodeId: string, reason: string): void {
  const reasons = recalled.get(nodeId) ?? new Set<string>();
  reasons.add(reason);
  recalled.set(nodeId, reasons);
}

function isCommonInfrastructureNode(node: GraphNode): boolean {
  const filePath = node.filePath?.toLowerCase() ?? "";
  if (!/(^|\/)common(\/|$)/u.test(filePath) || hasBusinessSignals(node)) {
    return false;
  }

  const tokens = uniqueStrings(
    [node.name, node.summary, ...node.tags].flatMap((value) => [
      ...extractTokens(value),
      ...splitCamelCaseTokens(value),
    ]).map((token) => token.toLowerCase()),
  );
  return tokens.some((token) => ["base", "common", "util", "logger"].includes(token));
}

function buildProductContextFile(
  filePath: string,
  items: Array<{ node: GraphNode; reasons: Set<string> }>,
  maxAnchors: number,
): ProductContextFile {
  const sortedItems = items.sort((a, b) => compareContextNodes(a.node, b.node));
  const businessSignals = sortedItems.flatMap(({ node }) =>
    (node.businessSignals ?? []).map((signal) => ({
      type: signal.type,
      text: signal.text,
      nodeId: node.id,
    })),
  );
  const anchors = sortedItems
    .filter(({ node }) => hasBusinessSignals(node) && node.type !== "file")
    .sort((a, b) => compareAnchorNodes(a.node, b.node))
    .flatMap(({ node }) => buildContextAnchors(node))
    .slice(0, maxAnchors);

  return {
    fileId: `file:${filePath}`,
    filePath,
    nodeSummaries: uniqueStrings(
      sortedItems
        .map(({ node }) => node.summary || node.name)
        .filter(isString),
    ).slice(0, 12),
    businessSignals,
    structuralReasons: uniqueStrings(sortedItems.flatMap(({ reasons }) => Array.from(reasons))).sort(),
    anchors,
  };
}

function buildContextAnchors(node: GraphNode): ProductContextAnchor[] {
  return (node.businessSignals ?? []).map((signal, index) => ({
    anchorId: `anchor:${node.id}:${index}`,
    nodeId: node.id,
    type: signal.type,
    text: signal.text,
    symbol: node.name,
    ...(node.lineRange ? { lineRange: node.lineRange } : {}),
    snippetSummary: node.summary || signal.text,
  }));
}

function compareContextNodes(a: GraphNode, b: GraphNode): number {
  const lineA = a.lineRange?.[0] ?? Number.MAX_SAFE_INTEGER;
  const lineB = b.lineRange?.[0] ?? Number.MAX_SAFE_INTEGER;
  return lineA - lineB || a.id.localeCompare(b.id);
}

function compareAnchorNodes(a: GraphNode, b: GraphNode): number {
  const symbolScoreA = a.lineRange ? 1 : 0;
  const symbolScoreB = b.lineRange ? 1 : 0;
  return symbolScoreB - symbolScoreA || compareContextNodes(a, b);
}

function contextFileRank(file: ProductContextFile): number {
  const rootScore = file.structuralReasons.includes("root") ? 4 : 0;
  const anchorScore = Math.min(file.anchors.length, 4);
  const signalScore = Math.min(file.businessSignals.length, 4) * 0.5;
  return rootScore + anchorScore + signalScore;
}

function hasBusinessSignals(node: GraphNode): boolean {
  return (node.businessSignals?.length ?? 0) > 0;
}

function globPatternToRegex(pattern: string): RegExp {
  if (pattern.includes("[") || pattern.includes("]")) {
    throw new Error(`Invalid product entry pattern: ${pattern}`);
  }

  let source = "";
  for (const char of pattern) {
    source += char === "*" ? ".*" : escapeRegexChar(char);
  }

  try {
    return new RegExp(`^${source}$`, "i");
  } catch {
    throw new Error(`Invalid product entry pattern: ${pattern}`);
  }
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|{}]/u.test(char) ? `\\${char}` : char;
}

function isEntryCandidate(node: GraphNode, patterns: RegExp[]): boolean {
  if (NON_ENTRY_NAME_PATTERNS.some((pattern) => pattern.test(node.name))) {
    return false;
  }

  const filePath = node.filePath ?? "";
  const basename = basenameWithoutExtension(filePath) ?? "";
  return patterns.some(
    (pattern) => pattern.test(node.name) || pattern.test(basename) || pattern.test(filePath),
  );
}

function buildNameCandidates(node: GraphNode): string[] {
  return uniqueStrings([node.name, basenameWithoutExtension(node.filePath), node.filePath].filter(isString));
}

function inferEntryKind(node: GraphNode): string {
  const text = `${node.name} ${node.filePath ?? ""}`.toLowerCase();
  if (text.includes("activityproxy") || text.includes("activity-proxy")) {
    return "activity-proxy";
  }
  if (text.includes("activity")) {
    return "activity";
  }
  if (text.includes("fragment")) {
    return "fragment";
  }
  if (text.includes("router") || text.includes("route")) {
    return "router";
  }
  if (text.includes("service")) {
    return "service";
  }
  if (text.includes("receiver")) {
    return "receiver";
  }
  if (text.includes("contentprovider") || text.includes("content-provider")) {
    return "provider";
  }
  if (text.includes("presenter")) {
    return "presenter";
  }
  if (text.includes("startup")) {
    return "startup";
  }
  if (text.includes("boot")) {
    return "boot";
  }
  if (text.includes("worker")) {
    return "worker";
  }
  if (text.includes("task")) {
    return "task";
  }
  if (text.includes("job")) {
    return "job";
  }
  if (text.includes("scheduler")) {
    return "scheduler";
  }
  if (text.includes("handler")) {
    return "handler";
  }
  return "entry";
}

function topicKindForEntry(entryKind: string): ProductTopicKind {
  if (entryKind === "activity" || entryKind === "fragment") {
    return "surface";
  }
  if (entryKind === "router") {
    return "capability";
  }
  return "element";
}

function inferSignalRoles(text: string): ProductEvidenceRole[] {
  const lower = text.toLowerCase();
  return SIGNAL_KEYWORDS.filter(({ keywords }) =>
    keywords.some((keyword) => lower.includes(keyword.toLowerCase())),
  ).map(({ role }) => role);
}

function scoreTextForProductSignals(text: string): number {
  const lower = text.toLowerCase();
  const score = SIGNAL_KEYWORDS.reduce((total, { keywords, baseScore }) => {
    if (keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      return total + baseScore;
    }
    return total;
  }, 0);

  return Math.min(1, score / 2);
}

function nodeSearchText(node: GraphNode): string {
  return `${node.name} ${node.filePath ?? ""} ${node.summary} ${node.tags.join(" ")}`;
}

function extractTokens(text: string): string[] {
  return uniqueStrings(
    text
      .normalize("NFKC")
      .split(/[^A-Za-z0-9_\u4e00-\u9fa5]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && token.length <= 48),
  );
}

function buildAdjacency(edges: GraphEdge[]): Map<string, WeightedNeighbor[]> {
  const adjacency = new Map<string, WeightedNeighbor[]>();

  for (const edge of edges) {
    const weight = edge.weight * (EDGE_TYPE_MULTIPLIERS[edge.type] ?? 0.3);
    addNeighbor(adjacency, edge.source, {
      nodeId: edge.target,
      type: edge.type,
      weight,
    });

    if (edge.direction === "bidirectional" || edge.direction === "backward") {
      addNeighbor(adjacency, edge.target, {
        nodeId: edge.source,
        type: edge.type,
        weight,
      });
    } else {
      addNeighbor(adjacency, edge.target, {
        nodeId: edge.source,
        type: edge.type,
        weight: weight * 0.45,
      });
    }
  }

  return adjacency;
}

function addNeighbor(
  adjacency: Map<string, WeightedNeighbor[]>,
  nodeId: string,
  neighbor: WeightedNeighbor,
): void {
  const neighbors = adjacency.get(nodeId) ?? [];
  neighbors.push(neighbor);
  adjacency.set(nodeId, neighbors);
}

function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

function expandFromSeed(
  seed: ProductEntrySeed,
  graph: KnowledgeGraph,
  adjacency: Map<string, WeightedNeighbor[]>,
  degreeByNodeId: Map<string, number>,
  signalByNodeId: Map<string, ProductSignal[]>,
  options: ProductProfileOptions,
): string[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodesPerTopic ?? DEFAULT_MAX_NODES_PER_TOPIC;
  const maxFrontier = options.maxFrontierPerDepth ?? DEFAULT_MAX_FRONTIER_PER_DEPTH;
  const hubDegreeThreshold = options.hubDegreeThreshold ?? DEFAULT_HUB_DEGREE_THRESHOLD;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const seedTokens = meaningfulBusinessTokens(seed.nameCandidates);
  const visited = new Set<string>([seed.entryNodeId]);
  const collected = [seed.entryNodeId];
  let frontier: FrontierItem[] = [{ nodeId: seed.entryNodeId, score: 1 }];

  for (let depth = 1; depth <= maxDepth && collected.length < maxNodes; depth += 1) {
    const candidates = new Map<string, ScoredCandidate>();

    for (const item of frontier) {
      for (const neighbor of adjacency.get(item.nodeId) ?? []) {
        if (visited.has(neighbor.nodeId)) {
          continue;
        }

        const node = nodeById.get(neighbor.nodeId);
        if (!node) {
          continue;
        }

        const productScore = scoreTextForProductSignals(nodeSearchText(node));
        const signalScore = Math.max(...(signalByNodeId.get(neighbor.nodeId) ?? []).map((s) => s.score), 0);
        const topicTokenScore = scoreTopicTokenMatch(node, seedTokens);
        const hubPenalty = hubScorePenalty({
          nodeId: neighbor.nodeId,
          degreeByNodeId,
          hubDegreeThreshold,
          signalScore,
          productScore,
          topicTokenScore,
        });
        if (hubPenalty === 0) {
          continue;
        }

        const candidate = {
          nodeId: neighbor.nodeId,
          score: item.score * neighbor.weight * hubPenalty + productScore + signalScore + topicTokenScore,
          signalScore,
          productScore,
          topicTokenScore,
        };
        const existing = candidates.get(candidate.nodeId);
        if (!existing || candidate.score > existing.score) {
          candidates.set(candidate.nodeId, candidate);
        }
      }
    }

    frontier = Array.from(candidates.values())
      .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId))
      .map(({ nodeId, score }) => ({ nodeId, score }))
      .slice(0, maxFrontier);

    if (frontier.length === 0) {
      break;
    }

    for (const item of frontier) {
      if (visited.has(item.nodeId)) {
        continue;
      }

      visited.add(item.nodeId);
      collected.push(item.nodeId);
      if (collected.length >= maxNodes) {
        break;
      }
    }
  }

  return collected;
}

function hubScorePenalty({
  nodeId,
  degreeByNodeId,
  hubDegreeThreshold,
  signalScore,
  productScore,
  topicTokenScore,
}: {
  nodeId: string;
  degreeByNodeId: Map<string, number>;
  hubDegreeThreshold: number;
  signalScore: number;
  productScore: number;
  topicTokenScore: number;
}): number {
  if ((degreeByNodeId.get(nodeId) ?? 0) <= hubDegreeThreshold) {
    return 1;
  }

  const strongProductValue =
    signalScore >= STRONG_HUB_PRODUCT_SCORE ||
    productScore >= STRONG_HUB_PRODUCT_SCORE ||
    (topicTokenScore > 0 && signalScore >= 0.45);
  return strongProductValue ? HUB_SCORE_PENALTY : 0;
}

function scoreTopicTokenMatch(node: GraphNode, seedTokens: string[]): number {
  if (seedTokens.length === 0) {
    return 0;
  }

  const text = normalizedCompactText(nodeSearchText(node));
  const matches = seedTokens.filter((token) => text.includes(token)).length;
  return matches === 0 ? 0 : Math.min(0.35, matches * 0.12);
}

function groupSignalsByNodeId(signals: ProductSignal[]): Map<string, ProductSignal[]> {
  const groups = new Map<string, ProductSignal[]>();
  for (const signal of signals) {
    const list = groups.get(signal.nodeId) ?? [];
    list.push(signal);
    groups.set(signal.nodeId, list);
  }
  return groups;
}

function indexAnchorsById(pack: TopicContextPack): Map<string, ProductContextAnchor> {
  const anchors = new Map<string, ProductContextAnchor>();
  for (const file of pack.candidateFiles) {
    for (const anchor of file.anchors) {
      anchors.set(anchor.anchorId, anchor);
    }
  }
  return anchors;
}

function buildEvidenceFromAnchor(
  anchor: ProductContextAnchor,
  node: GraphNode | undefined,
  confidence: ProductEvidence["confidence"],
): ProductEvidence {
  const role = evidenceRoleFromAnchorType(anchor.type);
  const signalTypes: ProductSignalType[] = [role];
  const tokens = uniqueStrings([
    ...extractTokens(anchor.text),
    ...extractTokens(anchor.snippetSummary),
    ...(node ? [...node.tags, node.name] : []),
  ]).slice(0, 20);

  return {
    id: evidenceIdForAnchor(anchor),
    role,
    ...(node?.filePath ? { filePath: node.filePath } : {}),
    ...(anchor.symbol ?? node?.name ? { symbol: anchor.symbol ?? node?.name } : {}),
    ...(anchor.lineRange ?? node?.lineRange ? { lineRange: anchor.lineRange ?? node?.lineRange } : {}),
    nodeId: anchor.nodeId,
    nodeIds: [anchor.nodeId],
    signalTypes,
    tokens,
    reason: anchor.text,
    ...(anchor.snippetSummary || node?.summary ? { summary: anchor.snippetSummary || node?.summary } : {}),
    confidence,
  };
}

function evidenceIdForAnchor(anchor: ProductContextAnchor): string {
  return anchor.anchorId.replace(/^anchor:/u, "evidence:");
}

function evidenceRoleFromAnchorType(anchorType: ProductContextAnchor["type"]): ProductEvidenceRole {
  return anchorType;
}

function highestEvidenceConfidence(
  a: ProductEvidence["confidence"],
  b: ProductEvidence["confidence"],
): ProductEvidence["confidence"] {
  const rank: Record<ProductEvidence["confidence"], number> = {
    uncertain: 0,
    inferred: 1,
    confirmed: 2,
  };
  return rank[a] >= rank[b] ? a : b;
}

function buildEvidenceFromNode(
  node: GraphNode,
  signals: ProductSignal[],
  isEntry: boolean,
): ProductEvidence {
  const roles = uniqueStrings(signals.flatMap((signal) => signal.types));
  const signalTypes: ProductEvidenceRole[] = isEntry ? uniqueStrings(["entry", ...roles]) : roles;
  const role: ProductEvidenceRole = isEntry ? "entry" : signalTypes[0] ?? "data";
  const tokens = uniqueStrings([
    ...signals.flatMap((signal) => signal.tokens),
    ...node.tags,
    node.name,
  ]).slice(0, 20);

  return {
    id: `ev:${node.id}`,
    role,
    ...(node.filePath ? { filePath: node.filePath } : {}),
    symbol: node.name,
    ...(node.lineRange ? { lineRange: node.lineRange } : {}),
    nodeId: node.id,
    nodeIds: [node.id],
    signalTypes,
    tokens,
    reason: isEntry
      ? `${node.name} 是产品入口。`
      : `${node.name} 命中产品信号：${signalTypes.join(", ")}。`,
    confidence: isEntry || signals.some((signal) => signal.score >= 0.5) ? "confirmed" : "inferred",
  };
}

function collectDomainRefs(domainGraph: KnowledgeGraph | undefined, candidates: string[]): string[] {
  if (!domainGraph) {
    return [];
  }

  const tokens = meaningfulBusinessTokens(candidates);
  if (tokens.length === 0) {
    return [];
  }

  return domainGraph.nodes
    .filter((node) => node.type === "domain" || node.type === "flow" || node.type === "topic")
    .filter((node) => {
      const text = normalizedCompactText(nodeSearchText(node));
      return tokens.some((token) => text.includes(token));
    })
    .map((node) => node.id)
    .slice(0, 8);
}

function meaningfulBusinessTokens(values: string[]): string[] {
  const tokens = values.flatMap((value) => [
    ...extractTokens(value),
    ...splitCamelCaseTokens(value),
  ]);

  return uniqueStrings(
    tokens
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 4)
      .filter((token) => !/^\d+$/u.test(token))
      .filter((token) => !COMMON_DOMAIN_TOKENS.has(token)),
  );
}

function splitCamelCaseTokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9_\u4e00-\u9fa5]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function normalizedCompactText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function basenameWithoutExtension(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }

  const basename = filePath.split(/[\\/]/u).pop();
  return basename?.replace(/\.[^.]+$/u, "");
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
