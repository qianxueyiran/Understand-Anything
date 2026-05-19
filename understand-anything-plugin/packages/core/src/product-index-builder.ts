import type { GraphEdge, GraphNode, KnowledgeGraph } from "./types.js";
import type {
  ProductEvidence,
  ProductEvidenceRole,
  ProductIndex,
  ProductSignal,
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
const STRONG_HUB_PRODUCT_SCORE = 0.7;
const HUB_SCORE_PENALTY = 0.25;
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
  const patterns = compileEntryPatterns(options.entryPatterns);

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

function compileEntryPatterns(patterns?: string[]): RegExp[] {
  if (!patterns || patterns.length === 0) {
    return DEFAULT_ENTRY_PATTERNS;
  }

  return patterns.map((pattern) => globPatternToRegex(pattern));
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
  if (text.includes("worker")) {
    return "worker";
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
