import type { KnowledgeGraph } from "@understand-anything/core";
import type { ProductIndex } from "@understand-anything/core/product-index";
import { buildChatContext, formatContextForPrompt } from "./context-builder.js";
import {
  buildProductIndexChatContext,
  formatProductIndexContextForPrompt,
} from "./product-index-context-builder.js";

export interface ProductAwareChatPromptInput {
  graph: KnowledgeGraph;
  query: string;
  productIndex?: ProductIndex;
  domainGraph?: KnowledgeGraph;
}

/**
 * Build a complete chat prompt by combining knowledge graph context
 * with a system instruction for answering codebase questions.
 */
export function buildChatPrompt(
  graph: KnowledgeGraph,
  query: string,
): string {
  const context = buildChatContext(graph, query);
  const formattedContext = formatContextForPrompt(context);

  return [
    "You are a knowledgeable assistant that answers questions about a software codebase.",
    "Use the following knowledge graph context to inform your answer.",
    "Reference specific files, functions, classes, and relationships from the graph.",
    "If layers are present, explain which architectural layer(s) are relevant.",
    "Be concise but thorough — link concepts to actual code locations.",
    "",
    "---",
    "",
    formattedContext,
    "---",
    "",
    `**User question:** ${query}`,
  ].join("\n");
}

export function buildProductAwareChatPrompt(
  input: ProductAwareChatPromptInput,
): string {
  const productContext = buildProductIndexChatContext(input);
  const formattedProductContext = formatProductIndexContextForPrompt(productContext);

  if (!formattedProductContext) {
    return buildChatPrompt(input.graph, input.query);
  }

  const structuralContext = buildChatContext(input.graph, input.query);
  const formattedStructuralContext = formatContextForPrompt(structuralContext);

  return [
    "You are a product-aware assistant that answers questions about a software codebase.",
    "Use the Product Index first for product topics, facts, and evidence.",
    "Then ground the answer in Structural Graph Context and domain context when available.",
    "Reference specific files, symbols, and relationships from the evidence and graph.",
    "If product evidence is inferred, uncertain, seeded, indexed, or only a candidate, explicitly say that the index found weak or candidate evidence.",
    "Be concise but thorough.",
    "",
    "---",
    "",
    formattedProductContext,
    "",
    "## Structural Graph Context",
    "",
    formattedStructuralContext,
    "---",
    "",
    `**User question:** ${input.query}`,
  ].join("\n");
}
