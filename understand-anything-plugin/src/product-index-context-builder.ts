import {
  searchProductIndex,
  type ProductEvidence,
  type ProductIndex,
  type ProductIndexSearchResult,
} from "@understand-anything/core/product-index";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

const MAX_PRODUCT_RESULTS = 5;
const MAX_FACTS_PER_TOPIC = 6;
const MAX_EVIDENCE_PER_TOPIC = 8;
const MAX_CODE_EVIDENCE_NODES = 12;
const MAX_DOMAIN_NODES = 8;
const MAX_MATCHED_TEXT = 8;
const MAX_ALIASES_PER_TOPIC = 4;
const MAX_CONDITIONS_PER_FACT = 3;
const MAX_CONTEXT_CHARS = 8000;
const MAX_TOPIC_NAME_CHARS = 120;
const MAX_SUMMARY_CHARS = 360;
const MAX_ALIAS_CHARS = 80;
const MAX_FACT_TEXT_CHARS = 420;
const MAX_CONDITION_CHARS = 180;
const MAX_EVIDENCE_REASON_CHARS = 320;
const MAX_MATCHED_TEXT_CHARS = 180;
const MAX_DOMAIN_SUMMARY_CHARS = 240;
const MAX_CODE_SUMMARY_CHARS = 240;
const CONTEXT_TRUNCATED_NOTICE = "[Product Index context truncated]";

export interface ProductIndexChatContextInput {
  graph: KnowledgeGraph;
  query: string;
  productIndex?: ProductIndex;
  domainGraph?: KnowledgeGraph;
}

export interface ProductIndexChatContext {
  query: string;
  projectName: string;
  productResults: ProductIndexSearchResult[];
  domainNodes: GraphNode[];
  codeEvidenceNodes: GraphNode[];
}

export function buildProductIndexChatContext(
  input: ProductIndexChatContextInput,
): ProductIndexChatContext {
  const productResults = input.productIndex && isProductIndexCurrentForGraph(input.productIndex, input.graph)
    ? searchProductIndex(input.productIndex, input.query, MAX_PRODUCT_RESULTS).map(
        limitProductResult,
      )
    : [];

  const domainIds = new Set<string>();
  const evidenceRefs: ProductEvidence[] = [];

  for (const result of productResults) {
    for (const domainRef of result.topic.domainRefs) {
      domainIds.add(domainRef);
    }
    evidenceRefs.push(...result.evidence);
  }

  return {
    query: input.query,
    projectName: input.graph.project.name,
    productResults,
    domainNodes: collectNodesById(input.domainGraph?.nodes ?? [], domainIds).slice(
      0,
      MAX_DOMAIN_NODES,
    ),
    codeEvidenceNodes: collectEvidenceNodes(input.graph.nodes, evidenceRefs).slice(
      0,
      MAX_CODE_EVIDENCE_NODES,
    ),
  };
}

export function isProductIndexCurrentForGraph(
  productIndex: ProductIndex,
  graph: KnowledgeGraph,
): boolean {
  const graphCommitHash = graph.project.gitCommitHash?.trim();
  const productCommitHash =
    productIndex.sources.knowledgeGraph.gitCommitHash?.trim() ??
    productIndex.project.gitCommitHash?.trim();

  if (graphCommitHash) {
    return productCommitHash === graphCommitHash;
  }

  const graphAnalyzedAt = graph.project.analyzedAt?.trim();
  const productAnalyzedAt = productIndex.project.analyzedAt?.trim();
  if (graphAnalyzedAt && productAnalyzedAt) {
    return graphAnalyzedAt === productAnalyzedAt;
  }

  return true;
}

export function formatProductIndexContextForPrompt(
  ctx: ProductIndexChatContext,
): string {
  if (ctx.productResults.length === 0) {
    return "";
  }

  const writer = createBudgetedWriter(MAX_CONTEXT_CHARS);
  writer.push("## Product Index");
  writer.push("");
  writer.push(`Project: ${truncateText(ctx.projectName, MAX_TOPIC_NAME_CHARS)}`);
  writer.push(`Query: ${truncateText(ctx.query, MAX_FACT_TEXT_CHARS)}`);
  writer.push("");

  for (const result of ctx.productResults) {
    const emittedTexts = new Set<string>();
    rememberText(emittedTexts, result.topic.name);
    rememberText(emittedTexts, result.topic.summary);

    writer.push(`### ${truncateText(result.topic.name, MAX_TOPIC_NAME_CHARS)}`);
    writer.push(`- Topic ID: ${result.topic.id}`);
    writer.push(`- Kind: ${result.topic.kind}`);
    writer.push(`- Status: ${result.topic.status}`);
    writer.push(`- Summary: ${truncateText(result.topic.summary, MAX_SUMMARY_CHARS)}`);
    if (result.topic.aliases.length > 0) {
      const aliases = result.topic.aliases.slice(0, MAX_ALIASES_PER_TOPIC);
      for (const alias of aliases) {
        rememberText(emittedTexts, alias);
      }
      writer.push(
        `- Aliases: ${aliases
          .map((alias) => truncateText(alias, MAX_ALIAS_CHARS))
          .join(", ")}`,
      );
    }

    if (result.facts.length > 0) {
      writer.push("- Facts:");
      for (const fact of result.facts) {
        rememberText(emittedTexts, fact.text);
        writer.push(
          `  - [${fact.type}/${fact.confidence}/${fact.maturity}] ${truncateText(
            fact.text,
            MAX_FACT_TEXT_CHARS,
          )}`,
        );
        if (fact.conditions.length > 0) {
          const conditions = fact.conditions.slice(0, MAX_CONDITIONS_PER_FACT);
          for (const condition of conditions) {
            rememberText(emittedTexts, condition);
          }
          writer.push(
            `    Conditions: ${conditions
              .map((condition) => truncateText(condition, MAX_CONDITION_CHARS))
              .join(", ")}`,
          );
        }
      }
    }

    if (result.evidence.length > 0) {
      writer.push("- Evidence:");
      for (const evidence of result.evidence) {
        rememberText(emittedTexts, evidence.reason);
        writer.push(
          `  - [${evidence.role}/${evidence.confidence}] ${formatEvidenceLocation(
            evidence,
          )}: ${truncateText(evidence.reason, MAX_EVIDENCE_REASON_CHARS)}`,
        );
      }
    }

    const matchedText = uniqueShortMatchedText(result.matchedText, emittedTexts);
    if (matchedText.length > 0) {
      writer.push(`- Matched Text: ${matchedText.join(" | ")}`);
    }
    writer.push("");
  }

  if (ctx.domainNodes.length > 0) {
    writer.push("## Domain Context");
    for (const node of ctx.domainNodes) {
      writer.push(
        `- ${truncateText(node.name, MAX_TOPIC_NAME_CHARS)} (${node.id}): ${truncateText(
          node.summary,
          MAX_DOMAIN_SUMMARY_CHARS,
        )}`,
      );
    }
    writer.push("");
  }

  if (ctx.codeEvidenceNodes.length > 0) {
    writer.push("## Code Evidence Nodes");
    for (const node of ctx.codeEvidenceNodes) {
      const location = formatNodeLocation(node);
      writer.push(
        `- ${truncateText(node.name, MAX_TOPIC_NAME_CHARS)} (${node.id})${location}: ${truncateText(
          node.summary,
          MAX_CODE_SUMMARY_CHARS,
        )}`,
      );
    }
    writer.push("");
  }

  return writer.toString();
}

function limitProductResult(result: ProductIndexSearchResult): ProductIndexSearchResult {
  return {
    ...result,
    facts: result.facts.slice(0, MAX_FACTS_PER_TOPIC),
    evidence: result.evidence.slice(0, MAX_EVIDENCE_PER_TOPIC),
    matchedText: result.matchedText.slice(0, MAX_MATCHED_TEXT),
  };
}

function collectNodesById(nodes: GraphNode[], ids: Set<string>): GraphNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const collected: GraphNode[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const node = nodeMap.get(id);
    if (node && !seen.has(node.id)) {
      collected.push(node);
      seen.add(node.id);
    }
  }

  return collected;
}

function collectEvidenceNodes(
  nodes: GraphNode[],
  evidenceRefs: ProductEvidence[],
): GraphNode[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const collected = new Map<string, GraphNode>();

  for (const evidence of evidenceRefs) {
    const node = findEvidenceNode(evidence, nodes, nodesById);
    if (node) {
      collected.set(node.id, node);
    }
  }

  return Array.from(collected.values());
}

function findEvidenceNode(
  evidence: ProductEvidence,
  nodes: GraphNode[],
  nodesById: Map<string, GraphNode>,
): GraphNode | undefined {
  if (evidence.nodeId) {
    const node = nodesById.get(evidence.nodeId);
    if (node) {
      return node;
    }
  }

  if (!evidence.filePath) {
    return undefined;
  }

  const sameFileNodes = nodes.filter((node) => node.filePath === evidence.filePath);
  if (evidence.symbol) {
    const symbolNode = sameFileNodes.find(
      (node) =>
        node.name === evidence.symbol ||
        node.id.endsWith(`:${evidence.symbol}`) ||
        node.id.includes(`:${evidence.symbol}:`),
    );
    if (symbolNode) {
      return symbolNode;
    }

    return sameFileNodes.find((node) => node.type === "file");
  }

  return sameFileNodes.find((node) => node.type === "file");
}

function formatEvidenceLocation(evidence: ProductEvidence): string {
  return [
    evidence.filePath,
    evidence.symbol,
    evidence.lineRange ? `lines ${evidence.lineRange[0]}-${evidence.lineRange[1]}` : undefined,
    evidence.nodeId,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatNodeLocation(node: GraphNode): string {
  const parts = [
    node.filePath,
    node.lineRange ? `lines ${node.lineRange[0]}-${node.lineRange[1]}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? ` - ${parts.join(" ")}` : "";
}

function createBudgetedWriter(maxChars: number): {
  push: (line: string) => void;
  toString: () => string;
} {
  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  return {
    push(line: string): void {
      if (truncated) {
        return;
      }

      const prefix = lines.length > 0 ? 1 : 0;
      const available = maxChars - used - prefix;
      if (available <= 0) {
        if (maxChars > used) {
          lines.push(truncateText(CONTEXT_TRUNCATED_NOTICE, maxChars - used));
        }
        truncated = true;
        return;
      }

      if (line.length <= available) {
        lines.push(line);
        used += line.length + prefix;
        return;
      }

      const noticeBudget = CONTEXT_TRUNCATED_NOTICE.length;
      if (available <= noticeBudget + 1) {
        lines.push(truncateText(CONTEXT_TRUNCATED_NOTICE, available));
        truncated = true;
        return;
      }

      const lineBudget = available - noticeBudget - 1;
      lines.push(truncateText(line, lineBudget));
      lines.push(CONTEXT_TRUNCATED_NOTICE);
      truncated = true;
    },
    toString(): string {
      return lines.join("\n");
    },
  };
}

function uniqueShortMatchedText(
  matchedText: string[],
  emittedTexts: Set<string>,
): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const text of matchedText) {
    const normalized = normalizeComparableText(text);
    if (!normalized || emittedTexts.has(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(truncateText(text, MAX_MATCHED_TEXT_CHARS));
    if (output.length >= MAX_MATCHED_TEXT) {
      break;
    }
  }

  return output;
}

function rememberText(texts: Set<string>, text: string | undefined): void {
  const normalized = normalizeComparableText(text);
  if (normalized) {
    texts.add(normalized);
  }
}

function normalizeComparableText(text: string | undefined): string {
  return (text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  if (maxChars <= 1) {
    return "…";
  }

  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}
