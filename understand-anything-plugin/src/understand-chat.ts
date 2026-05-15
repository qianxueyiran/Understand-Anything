import type { KnowledgeGraph, ProductKnowledge } from "@understand-anything/core";
import { buildChatContext, formatContextForPrompt } from "./context-builder.js";
import {
  buildProductChatContext,
  formatProductContextForPrompt,
} from "./product-context-builder.js";

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

export interface ProductAwareChatPromptInput {
  graph: KnowledgeGraph;
  query: string;
  productKnowledge?: ProductKnowledge;
  domainGraph?: KnowledgeGraph;
}

export function buildProductAwareChatPrompt(input: ProductAwareChatPromptInput): string {
  const productContext = buildProductChatContext(input);
  const formattedProductContext = formatProductContextForPrompt(productContext);

  if (!formattedProductContext) {
    return buildChatPrompt(input.graph, input.query);
  }

  const structuralContext = buildChatContext(input.graph, input.query);
  const formattedStructuralContext = formatContextForPrompt(structuralContext);

  return [
    "You are a product-aware assistant that answers questions about a software codebase.",
    "Use the product knowledge first, then ground the explanation in domain graph nodes and code evidence.",
    "Reference product concepts, business rules, data fields, files, functions, classes, and relationships when relevant.",
    "If product knowledge and structural graph context disagree, call out the uncertainty instead of guessing.",
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
