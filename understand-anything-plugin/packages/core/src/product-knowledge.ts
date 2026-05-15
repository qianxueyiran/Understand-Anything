import Fuse, { type IFuseOptions } from "fuse.js";
import { z } from "zod";

export const EvidenceRefSchema = z.object({
  filePath: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  reason: z.string().min(1),
}).superRefine((evidence, ctx) => {
  if (!evidence.filePath && !evidence.nodeId) {
    ctx.addIssue({
      code: "custom",
      message: "evidence must include at least filePath or nodeId",
      path: ["filePath"],
    });
  }
});

export const DisplayRuleSchema = z.object({
  condition: z.string().min(1),
  result: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export const DataFieldRefSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["api", "model", "enum", "resource", "local-state", "unknown"]),
  meaning: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export const ProductAreaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  domainRefs: z.array(z.string().min(1)).default([]),
  codeRefs: z.array(EvidenceRefSchema).default([]),
});

export const ProductConceptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  areaId: z.string().min(1).optional(),
  meaning: z.string().min(1),
  userFacingTerms: z.array(z.string().min(1)).default([]),
  businessRules: z.array(z.string().min(1)).default([]),
  displayRules: z.array(DisplayRuleSchema).default([]),
  dataFields: z.array(DataFieldRefSchema).default([]),
  relatedConceptIds: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  confidence: z.enum(["confirmed", "inferred", "uncertain"]),
}).superRefine((concept, ctx) => {
  if (concept.confidence === "confirmed" && concept.evidence.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "confirmed concepts must include at least one evidence reference",
      path: ["evidence"],
    });
  }
});

const ProductProjectSchema = z.object({
  name: z.string().min(1),
  analyzedAt: z.string().min(1),
  gitCommitHash: z.string().min(1).optional(),
});

export const ProductKnowledgeSchema = z.object({
  version: z.string().min(1),
  project: ProductProjectSchema,
  productAreas: z.array(ProductAreaSchema).default([]),
  concepts: z.array(ProductConceptSchema).default([]),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type DisplayRule = z.infer<typeof DisplayRuleSchema>;
export type DataFieldRef = z.infer<typeof DataFieldRefSchema>;
export type ProductArea = z.infer<typeof ProductAreaSchema>;
export type ProductConcept = z.infer<typeof ProductConceptSchema>;
export type ProductKnowledge = z.infer<typeof ProductKnowledgeSchema>;

export type ProductKnowledgeValidationResult =
  | { success: true; data: ProductKnowledge; error?: undefined }
  | { success: false; data?: undefined; error: string };

export interface ProductKnowledgeSearchResult {
  concept: ProductConcept;
  area?: ProductArea;
  score: number;
  matchedText: string[];
}

interface ProductKnowledgeSearchDocument {
  concept: ProductConcept;
  area?: ProductArea;
  searchableText: string[];
  conceptName: string;
  areaName: string;
  meaning: string;
  userFacingTerms: string[];
  businessRules: string[];
  displayRules: string[];
  dataFields: string[];
}

const PRODUCT_KNOWLEDGE_FUSE_OPTIONS: IFuseOptions<ProductKnowledgeSearchDocument> = {
  keys: [
    { name: "conceptName", weight: 0.25 },
    { name: "areaName", weight: 0.15 },
    { name: "meaning", weight: 0.15 },
    { name: "userFacingTerms", weight: 0.2 },
    { name: "businessRules", weight: 0.1 },
    { name: "displayRules", weight: 0.1 },
    { name: "dataFields", weight: 0.05 },
  ],
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
  useExtendedSearch: true,
};

export function validateProductKnowledge(data: unknown): ProductKnowledgeValidationResult {
  const result = ProductKnowledgeSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues.map((issue) => issue.message).join("; "),
  };
}

export function searchProductKnowledge(
  knowledge: ProductKnowledge,
  query: string,
  limit = 8,
): ProductKnowledgeSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed || limit <= 0) {
    return [];
  }

  const documents = buildSearchDocuments(knowledge);
  const fuse = new Fuse(documents, PRODUCT_KNOWLEDGE_FUSE_OPTIONS);
  const tokens = tokenizeQuery(trimmed);
  const extendedQuery = tokens.join(" | ");

  return fuse.search(extendedQuery)
    .filter((result) => documentMatchesTokens(result.item, tokens))
    .slice(0, limit)
    .map((result) => ({
      concept: result.item.concept,
      area: result.item.area,
      score: result.score ?? 0,
      matchedText: collectMatchedText(result.item, trimmed),
    }));
}

function buildSearchDocuments(knowledge: ProductKnowledge): ProductKnowledgeSearchDocument[] {
  const areasById = new Map(knowledge.productAreas.map((area) => [area.id, area]));

  return knowledge.concepts.map((concept) => {
    const area = concept.areaId ? areasById.get(concept.areaId) : undefined;
    const displayRules = concept.displayRules.flatMap((rule) => [rule.condition, rule.result]);
    const dataFields = concept.dataFields.flatMap((field) => [field.name, field.source, field.meaning]);
    const searchableText = [
      concept.name,
      concept.meaning,
      area?.name,
      area?.summary,
      ...concept.userFacingTerms,
      ...concept.businessRules,
      ...displayRules,
      ...dataFields,
    ].filter((value): value is string => Boolean(value));

    return {
      concept,
      area,
      searchableText,
      conceptName: concept.name,
      areaName: area?.name ?? "",
      meaning: concept.meaning,
      userFacingTerms: concept.userFacingTerms,
      businessRules: concept.businessRules,
      displayRules,
      dataFields,
    };
  });
}

function collectMatchedText(document: ProductKnowledgeSearchDocument, query: string): string[] {
  const tokens = tokenizeQuery(query);
  const matched = document.searchableText.filter((text) => {
    const lowerText = text.toLowerCase();
    return tokens.some((token) => lowerText.includes(token.toLowerCase()));
  });

  return matched.length > 0 ? Array.from(new Set(matched)) : document.searchableText.slice(0, 3);
}

function documentMatchesTokens(document: ProductKnowledgeSearchDocument, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  if (tokens.length === 1) {
    return document.searchableText.some((text) => text.toLowerCase().includes(tokens[0].toLowerCase()));
  }

  const combinedText = document.searchableText.join(" ").toLowerCase();
  return tokens.every((token) => combinedText.includes(token.toLowerCase()));
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map(normalizeQueryToken)
    .filter(Boolean);
}

function normalizeQueryToken(token: string): string {
  return token
    .replace(/^(怎么|如何)/, "")
    .replace(/[?？。！!呢吗]+$/u, "");
}
