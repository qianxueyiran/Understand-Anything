import {
  searchProductKnowledge,
  type EvidenceRef,
  type ProductKnowledge,
  type ProductKnowledgeSearchResult,
} from "@understand-anything/core/product-knowledge";
import {
  type GraphNode,
  type KnowledgeGraph,
} from "@understand-anything/core/types";

const PRODUCT_RESULT_PROMPT_LIMIT = 4;
const BUSINESS_RULE_PROMPT_LIMIT = 5;
const DISPLAY_RULE_PROMPT_LIMIT = 5;
const DATA_FIELD_PROMPT_LIMIT = 5;
const EVIDENCE_PROMPT_LIMIT = 6;

export interface ProductChatContextInput {
  graph: KnowledgeGraph;
  query: string;
  productKnowledge?: ProductKnowledge;
  domainGraph?: KnowledgeGraph;
}

export interface ProductChatContext {
  query: string;
  projectName: string;
  productResults: ProductKnowledgeSearchResult[];
  domainNodes: GraphNode[];
  codeEvidenceNodes: GraphNode[];
}

export function buildProductChatContext(input: ProductChatContextInput): ProductChatContext {
  const productResults = input.productKnowledge
    ? searchProductKnowledgeWithQueryVariants(input.productKnowledge, input.query, 6)
    : [];

  const domainIds = new Set<string>();
  const evidenceRefs: EvidenceRef[] = [];

  for (const result of productResults) {
    if (result.area) {
      for (const domainRef of result.area.domainRefs) {
        domainIds.add(domainRef);
      }
      evidenceRefs.push(...result.area.codeRefs);
    }

    evidenceRefs.push(...result.concept.evidence);
    for (const rule of result.concept.displayRules) {
      evidenceRefs.push(...rule.evidence);
    }
    for (const field of result.concept.dataFields) {
      evidenceRefs.push(...field.evidence);
    }
  }

  const domainNodes = collectNodesById(input.domainGraph?.nodes ?? [], domainIds);
  const codeEvidenceNodes = collectEvidenceNodes(input.graph.nodes, evidenceRefs);

  return {
    query: input.query,
    projectName: input.graph.project.name,
    productResults,
    domainNodes,
    codeEvidenceNodes,
  };
}

export function formatProductContextForPrompt(ctx: ProductChatContext): string {
  if (ctx.productResults.length === 0) {
    return "";
  }

  const lines: string[] = [];

  lines.push("## Product Knowledge");
  lines.push("");
  for (const result of ctx.productResults.slice(0, PRODUCT_RESULT_PROMPT_LIMIT)) {
    const evidenceState = createEvidenceFormatState();

    lines.push(`### ${result.concept.name}`);
    lines.push(`- **Concept ID:** ${result.concept.id}`);
    if (result.area) {
      lines.push(`- **Product Area:** ${result.area.name} (${result.area.id})`);
      lines.push(`- **Area Summary:** ${result.area.summary}`);
    }
    lines.push(`- **Meaning:** ${result.concept.meaning}`);
    if (result.concept.userFacingTerms.length > 0) {
      lines.push(`- **User Terms:** ${result.concept.userFacingTerms.join(", ")}`);
    }
    if (result.concept.businessRules.length > 0) {
      lines.push("- **Business Rules:**");
      for (const rule of result.concept.businessRules.slice(0, BUSINESS_RULE_PROMPT_LIMIT)) {
        lines.push(`  - ${rule}`);
      }
    }
    if (result.concept.displayRules.length > 0) {
      lines.push("- **Display Rules:**");
      for (const rule of result.concept.displayRules.slice(0, DISPLAY_RULE_PROMPT_LIMIT)) {
        lines.push(`  - If ${rule.condition}, then ${rule.result}`);
        appendEvidence(lines, rule.evidence, "    ", evidenceState);
      }
    }
    if (result.concept.dataFields.length > 0) {
      lines.push("- **Data Fields:**");
      for (const field of result.concept.dataFields.slice(0, DATA_FIELD_PROMPT_LIMIT)) {
        lines.push(`  - ${field.name} (${field.source}): ${field.meaning}`);
        appendEvidence(lines, field.evidence, "    ", evidenceState);
      }
    }
    appendEvidence(lines, result.concept.evidence, "  ", evidenceState);
    if (result.matchedText.length > 0) {
      lines.push(`- **Matched Text:** ${result.matchedText.join(" | ")}`);
    }
    lines.push("");
  }

  if (ctx.domainNodes.length > 0) {
    lines.push("## Domain Context");
    lines.push("");
    for (const node of ctx.domainNodes) {
      lines.push(`### ${node.name} (${node.id})`);
      lines.push(`- **Type:** ${node.type}`);
      if (node.filePath) {
        lines.push(`- **File:** ${node.filePath}`);
      }
      lines.push(`- **Summary:** ${node.summary}`);
      lines.push("");
    }
  }

  if (ctx.codeEvidenceNodes.length > 0) {
    lines.push("## Code Evidence");
    lines.push("");
    for (const node of ctx.codeEvidenceNodes) {
      lines.push(`### ${node.name} (${node.type})`);
      lines.push(`- **Node ID:** ${node.id}`);
      if (node.filePath) {
        lines.push(`- **File:** ${node.filePath}`);
      }
      lines.push(`- **Summary:** ${node.summary}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function searchProductKnowledgeWithQueryVariants(
  productKnowledge: ProductKnowledge,
  query: string,
  limit: number,
): ProductKnowledgeSearchResult[] {
  const seen = new Map<string, ProductKnowledgeSearchResult>();
  for (const queryVariant of buildQueryVariants(productKnowledge, query)) {
    for (const result of searchProductKnowledge(productKnowledge, queryVariant, limit)) {
      if (!seen.has(result.concept.id)) {
        seen.set(result.concept.id, result);
      }
    }
    if (seen.size >= limit) {
      break;
    }
  }

  return Array.from(seen.values()).slice(0, limit);
}

function buildQueryVariants(productKnowledge: ProductKnowledge, query: string): string[] {
  const variants = [query];
  const compactQuery = query.replace(/\s+/g, "");

  for (const concept of productKnowledge.concepts) {
    const terms = [
      concept.name,
      concept.meaning,
      ...concept.userFacingTerms,
      ...concept.businessRules,
    ].filter((term) => compactQuery.includes(term.replace(/\s+/g, "")));

    const area = concept.areaId
      ? productKnowledge.productAreas.find((candidate) => candidate.id === concept.areaId)
      : undefined;
    if (area && compactQuery.includes(area.name.replace(/\s+/g, ""))) {
      terms.unshift(area.name);
    }

    const uniqueTerms = Array.from(new Set(terms));
    if (uniqueTerms.length > 0) {
      variants.push(uniqueTerms.join(" "));
    }
  }

  return Array.from(new Set(variants));
}

function collectNodesById(nodes: GraphNode[], ids: Set<string>): GraphNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const collected: GraphNode[] = [];
  for (const id of ids) {
    const node = nodeMap.get(id);
    if (node) {
      collected.push(node);
    }
  }
  return collected;
}

function collectEvidenceNodes(nodes: GraphNode[], evidenceRefs: EvidenceRef[]): GraphNode[] {
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
  evidence: EvidenceRef,
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

  if (evidence.symbol) {
    const symbolNode = nodes.find((node) =>
      node.filePath === evidence.filePath
      && (node.type === "function" || node.type === "class")
      && (node.name === evidence.symbol || node.id.includes(`:${evidence.symbol}`))
    );
    if (symbolNode) {
      return symbolNode;
    }
  }

  return nodes.find((node) => node.filePath === evidence.filePath && node.type === "file");
}

interface EvidenceFormatState {
  seenKeys: Set<string>;
  emittedCount: number;
}

function createEvidenceFormatState(): EvidenceFormatState {
  return {
    seenKeys: new Set(),
    emittedCount: 0,
  };
}

function appendEvidence(
  lines: string[],
  evidenceRefs: EvidenceRef[],
  indent: string,
  state: EvidenceFormatState,
): void {
  if (evidenceRefs.length === 0 || state.emittedCount >= EVIDENCE_PROMPT_LIMIT) {
    return;
  }

  const formattedEvidence: string[] = [];
  for (const evidence of evidenceRefs) {
    if (state.emittedCount >= EVIDENCE_PROMPT_LIMIT) {
      break;
    }

    const key = buildEvidenceKey(evidence);
    if (state.seenKeys.has(key)) {
      continue;
    }

    state.seenKeys.add(key);
    state.emittedCount += 1;

    const location = formatEvidenceLocation(evidence);
    formattedEvidence.push(`${indent}  - ${location}: ${evidence.reason}`);
  }

  if (formattedEvidence.length === 0) {
    return;
  }

  lines.push(`${indent}- **Evidence:**`);
  lines.push(...formattedEvidence);
}

function buildEvidenceKey(evidence: EvidenceRef): string {
  return [
    evidence.nodeId ?? "",
    evidence.filePath ?? "",
    evidence.symbol ?? "",
    evidence.lineRange ? `${evidence.lineRange[0]}-${evidence.lineRange[1]}` : "",
    evidence.reason,
  ].join("|");
}

function formatEvidenceLocation(evidence: EvidenceRef): string {
  const location = [
    evidence.filePath,
    evidence.nodeId,
    evidence.symbol,
    evidence.lineRange ? `lines ${evidence.lineRange[0]}-${evidence.lineRange[1]}` : undefined,
  ].filter(Boolean).join(" ");

  return location || "unlocated evidence";
}
