import {
  searchProductKnowledge,
  type EvidenceRef,
  type GraphNode,
  type KnowledgeGraph,
  type ProductKnowledge,
  type ProductKnowledgeSearchResult,
} from "@understand-anything/core";

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
  for (const result of ctx.productResults) {
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
      for (const rule of result.concept.businessRules) {
        lines.push(`  - ${rule}`);
      }
    }
    if (result.concept.displayRules.length > 0) {
      lines.push("- **Display Rules:**");
      for (const rule of result.concept.displayRules) {
        lines.push(`  - If ${rule.condition}, then ${rule.result}`);
        appendEvidence(lines, rule.evidence, "    ");
      }
    }
    if (result.concept.dataFields.length > 0) {
      lines.push("- **Data Fields:**");
      for (const field of result.concept.dataFields) {
        lines.push(`  - ${field.name} (${field.source}): ${field.meaning}`);
        appendEvidence(lines, field.evidence, "    ");
      }
    }
    appendEvidence(lines, result.concept.evidence, "  ");
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
  const nodesByFilePath = new Map(
    nodes
      .filter((node): node is GraphNode & { filePath: string } => Boolean(node.filePath))
      .map((node) => [node.filePath, node]),
  );
  const collected = new Map<string, GraphNode>();

  for (const evidence of evidenceRefs) {
    const node = findEvidenceNode(evidence, nodesById, nodesByFilePath);
    if (node) {
      collected.set(node.id, node);
    }
  }

  return Array.from(collected.values());
}

function findEvidenceNode(
  evidence: EvidenceRef,
  nodesById: Map<string, GraphNode>,
  nodesByFilePath: Map<string, GraphNode>,
): GraphNode | undefined {
  if (evidence.nodeId) {
    const node = nodesById.get(evidence.nodeId);
    if (node) {
      return node;
    }
  }

  return evidence.filePath ? nodesByFilePath.get(evidence.filePath) : undefined;
}

function appendEvidence(lines: string[], evidenceRefs: EvidenceRef[], indent: string): void {
  if (evidenceRefs.length === 0) {
    return;
  }

  lines.push(`${indent}- **Evidence:**`);
  for (const evidence of evidenceRefs) {
    const location = [
      evidence.filePath,
      evidence.nodeId,
      evidence.symbol,
      evidence.lineRange ? `lines ${evidence.lineRange[0]}-${evidence.lineRange[1]}` : undefined,
    ].filter(Boolean).join(" ");
    lines.push(`${indent}  - ${location}: ${evidence.reason}`);
  }
}
