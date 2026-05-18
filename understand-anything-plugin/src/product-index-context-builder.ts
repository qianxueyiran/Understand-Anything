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
  const productResults = input.productIndex
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

export function formatProductIndexContextForPrompt(
  ctx: ProductIndexChatContext,
): string {
  if (ctx.productResults.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("## Product Index");
  lines.push("");
  lines.push(`Project: ${ctx.projectName}`);
  lines.push(`Query: ${ctx.query}`);
  lines.push("");

  for (const result of ctx.productResults) {
    lines.push(`### ${result.topic.name}`);
    lines.push(`- Topic ID: ${result.topic.id}`);
    lines.push(`- Kind: ${result.topic.kind}`);
    lines.push(`- Status: ${result.topic.status}`);
    lines.push(`- Summary: ${result.topic.summary}`);
    if (result.topic.aliases.length > 0) {
      lines.push(`- Aliases: ${result.topic.aliases.join(", ")}`);
    }

    if (result.facts.length > 0) {
      lines.push("- Facts:");
      for (const fact of result.facts) {
        lines.push(`  - [${fact.type}/${fact.confidence}/${fact.maturity}] ${fact.text}`);
        if (fact.conditions.length > 0) {
          lines.push(`    Conditions: ${fact.conditions.join(", ")}`);
        }
      }
    }

    if (result.evidence.length > 0) {
      lines.push("- Evidence:");
      for (const evidence of result.evidence) {
        lines.push(
          `  - [${evidence.role}/${evidence.confidence}] ${formatEvidenceLocation(
            evidence,
          )}: ${evidence.reason}`,
        );
      }
    }

    if (result.matchedText.length > 0) {
      lines.push(`- Matched Text: ${result.matchedText.join(" | ")}`);
    }
    lines.push("");
  }

  if (ctx.domainNodes.length > 0) {
    lines.push("## Domain Context");
    for (const node of ctx.domainNodes) {
      lines.push(`- ${node.name} (${node.id}): ${node.summary}`);
    }
    lines.push("");
  }

  if (ctx.codeEvidenceNodes.length > 0) {
    lines.push("## Code Evidence Nodes");
    for (const node of ctx.codeEvidenceNodes) {
      const location = formatNodeLocation(node);
      lines.push(`- ${node.name} (${node.id})${location}: ${node.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
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
  }

  return (
    sameFileNodes.find((node) => node.type === "file") ??
    sameFileNodes[0] ??
    nodes.find((node) => node.filePath === evidence.filePath)
  );
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
