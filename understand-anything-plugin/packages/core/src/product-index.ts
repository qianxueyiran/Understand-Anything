import Fuse, { type IFuseOptions } from "fuse.js";
import { z } from "zod";

export const ProductTopicKindSchema = z.enum(["capability", "surface", "element", "data"]);
export const ProductTopicStatusSchema = z.enum(["seeded", "indexed", "summarized", "verified"]);
export const ProductFactTypeSchema = z.enum(["behavior", "rule", "display", "mapping", "lifecycle"]);
export const ProductConfidenceSchema = z.enum(["confirmed", "inferred", "uncertain"]);
export const ProductFactMaturitySchema = z.enum(["indexed", "summarized", "verified"]);
export const ProductEvidenceRoleSchema = z.enum([
  "entry",
  "copy",
  "ui",
  "rule",
  "data",
  "lifecycle",
  "network",
  "storage",
  "analytics",
  "integration",
]);
export const ProductSignalTypeSchema = ProductEvidenceRoleSchema;

export const ProductSourcesSchema = z.object({
  knowledgeGraph: z.object({
    path: z.string().min(1),
    gitCommitHash: z.string().min(1).optional(),
    required: z.literal(true),
  }),
  domainGraph: z
    .object({
      path: z.string().min(1),
      available: z.boolean(),
      required: z.literal(false),
    })
    .optional(),
  signals: z
    .object({
      path: z.string().min(1),
      available: z.boolean(),
      count: z.number().int().nonnegative(),
      indexedNodes: z.number().int().nonnegative(),
      truncated: z.boolean(),
    })
    .optional(),
});

export const ProductEvidenceSchema = z
  .object({
    id: z.string().min(1),
    role: ProductEvidenceRoleSchema,
    filePath: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
    lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    nodeId: z.string().min(1).optional(),
    signalTypes: z.array(ProductSignalTypeSchema).default([]),
    tokens: z.array(z.string().min(1)).default([]),
    reason: z.string().min(1),
    confidence: ProductConfidenceSchema,
  })
  .superRefine((evidence, ctx) => {
    if (!evidence.filePath && !evidence.nodeId) {
      ctx.addIssue({
        code: "custom",
        message: "evidence must include filePath or nodeId",
        path: ["filePath"],
      });
    }

    if (evidence.lineRange && evidence.lineRange[1] < evidence.lineRange[0]) {
      ctx.addIssue({
        code: "custom",
        message: "lineRange end must be greater than or equal to start",
        path: ["lineRange"],
      });
    }
  });

export const ProductTopicSchema = z.object({
  id: z.string().min(1),
  kind: ProductTopicKindSchema,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
  status: ProductTopicStatusSchema,
  entryEvidenceIds: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  domainRefs: z.array(z.string().min(1)).default([]),
});

export const ProductFactSchema = z
  .object({
    id: z.string().min(1),
    topicIds: z.array(z.string().min(1)).min(1),
    type: ProductFactTypeSchema,
    text: z.string().min(1),
    conditions: z.array(z.string().min(1)).default([]),
    evidenceIds: z.array(z.string().min(1)).default([]),
    confidence: ProductConfidenceSchema,
    maturity: ProductFactMaturitySchema,
  })
  .superRefine((fact, ctx) => {
    if (fact.confidence === "confirmed" && fact.evidenceIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "confirmed facts must reference evidence",
        path: ["evidenceIds"],
      });
    }
  });

export const ProductCoverageWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  topicId: z.string().min(1).optional(),
});

export const ProductCoverageSchema = z.object({
  platformProfiles: z.array(z.string().min(1)).default([]),
  entryPoints: z.number().int().nonnegative(),
  indexedTopics: z.number().int().nonnegative(),
  confirmedEvidence: z.number().int().nonnegative(),
  generatedFacts: z.number().int().nonnegative(),
  warnings: z.array(ProductCoverageWarningSchema).default([]),
});

export const ProductProjectSchema = z.object({
  name: z.string().min(1),
  platforms: z.array(z.string().min(1)).default([]),
  languages: z.array(z.string().min(1)).default([]),
  frameworks: z.array(z.string().min(1)).default([]),
  analyzedAt: z.string().min(1),
  gitCommitHash: z.string().min(1).optional(),
});

export const ProductSignalSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  filePath: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  types: z.array(ProductSignalTypeSchema).min(1),
  tokens: z.array(z.string().min(1)).default([]),
  score: z.number().min(0).max(1),
});

export const ProductIndexSchema = z
  .object({
    version: z.string().min(1),
    kind: z.literal("product-index"),
    project: ProductProjectSchema,
    sources: ProductSourcesSchema,
    topics: z.array(ProductTopicSchema).default([]),
    facts: z.array(ProductFactSchema).default([]),
    evidence: z.array(ProductEvidenceSchema).default([]),
    coverage: ProductCoverageSchema,
  })
  .superRefine((index, ctx) => {
    const seenTopicIds = new Set<string>();
    const seenFactIds = new Set<string>();
    const seenEvidenceIds = new Set<string>();

    for (const topic of index.topics) {
      if (seenTopicIds.has(topic.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate topic id ${topic.id}`,
          path: ["topics"],
        });
      }
      seenTopicIds.add(topic.id);
    }

    for (const fact of index.facts) {
      if (seenFactIds.has(fact.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate fact id ${fact.id}`,
          path: ["facts"],
        });
      }
      seenFactIds.add(fact.id);
    }

    for (const evidence of index.evidence) {
      if (seenEvidenceIds.has(evidence.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate evidence id ${evidence.id}`,
          path: ["evidence"],
        });
      }
      seenEvidenceIds.add(evidence.id);
    }

    const evidenceIds = new Set(index.evidence.map((evidence) => evidence.id));
    const topicIds = new Set(index.topics.map((topic) => topic.id));

    for (const topic of index.topics) {
      for (const evidenceId of [...topic.entryEvidenceIds, ...topic.evidenceIds]) {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: "custom",
            message: `topic ${topic.id} references unknown evidence id ${evidenceId}`,
            path: ["topics"],
          });
        }
      }
    }

    for (const fact of index.facts) {
      for (const topicId of fact.topicIds) {
        if (!topicIds.has(topicId)) {
          ctx.addIssue({
            code: "custom",
            message: `fact ${fact.id} references unknown topic id ${topicId}`,
            path: ["facts"],
          });
        }
      }

      for (const evidenceId of fact.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: "custom",
            message: `fact ${fact.id} references unknown evidence id ${evidenceId}`,
            path: ["facts"],
          });
        }
      }
    }
  });

export type ProductTopicKind = z.infer<typeof ProductTopicKindSchema>;
export type ProductTopicStatus = z.infer<typeof ProductTopicStatusSchema>;
export type ProductFactType = z.infer<typeof ProductFactTypeSchema>;
export type ProductConfidence = z.infer<typeof ProductConfidenceSchema>;
export type ProductFactMaturity = z.infer<typeof ProductFactMaturitySchema>;
export type ProductEvidenceRole = z.infer<typeof ProductEvidenceRoleSchema>;
export type ProductSignalType = z.infer<typeof ProductSignalTypeSchema>;
export type ProductSources = z.infer<typeof ProductSourcesSchema>;
export type ProductEvidence = z.infer<typeof ProductEvidenceSchema>;
export type ProductTopic = z.infer<typeof ProductTopicSchema>;
export type ProductFact = z.infer<typeof ProductFactSchema>;
export type ProductCoverageWarning = z.infer<typeof ProductCoverageWarningSchema>;
export type ProductCoverage = z.infer<typeof ProductCoverageSchema>;
export type ProductProject = z.infer<typeof ProductProjectSchema>;
export type ProductSignal = z.infer<typeof ProductSignalSchema>;
export type ProductIndex = z.infer<typeof ProductIndexSchema>;

export type ProductIndexValidationResult =
  | { success: true; data: ProductIndex; error?: undefined }
  | { success: false; data?: undefined; error: string };

export interface ProductIndexSearchResult {
  topic: ProductTopic;
  facts: ProductFact[];
  evidence: ProductEvidence[];
  score: number;
  matchedText: string[];
}

interface ProductIndexSearchDocument {
  topic: ProductTopic;
  facts: ProductFact[];
  evidence: ProductEvidence[];
  searchableText: string[];
  normalizedSearchableText: string[];
  topicName: string;
  aliases: string[];
  summary: string;
  factText: string[];
  evidenceTokens: string[];
}

const PRODUCT_INDEX_FUSE_OPTIONS: IFuseOptions<ProductIndexSearchDocument> = {
  keys: [
    { name: "topicName", weight: 0.25 },
    { name: "aliases", weight: 0.2 },
    { name: "summary", weight: 0.15 },
    { name: "factText", weight: 0.25 },
    { name: "evidenceTokens", weight: 0.15 },
  ],
  threshold: 0.38,
  includeScore: true,
  ignoreLocation: true,
  useExtendedSearch: true,
};

export function validateProductIndex(data: unknown): ProductIndexValidationResult {
  const result = ProductIndexSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues.map((issue) => issue.message).join("; "),
  };
}

export function searchProductIndex(
  index: ProductIndex,
  query: string,
  limit = 8,
): ProductIndexSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed || limit <= 0) {
    return [];
  }

  const documents = buildSearchDocuments(index);
  const tokens = tokenizeQuery(trimmed);
  if (tokens.length === 0) {
    return [];
  }

  const fuse = new Fuse(documents, PRODUCT_INDEX_FUSE_OPTIONS);
  const extendedQuery = tokens.join(" | ");

  return fuse
    .search(extendedQuery)
    .filter((result) => documentMatchesTokens(result.item, tokens))
    .slice(0, limit)
    .map((result) => ({
      topic: result.item.topic,
      facts: result.item.facts,
      evidence: result.item.evidence,
      score: result.score ?? 0,
      matchedText: collectMatchedText(result.item, tokens),
    }));
}

function buildSearchDocuments(index: ProductIndex): ProductIndexSearchDocument[] {
  const factsByTopic = new Map<string, ProductFact[]>();
  for (const fact of index.facts) {
    for (const topicId of fact.topicIds) {
      const facts = factsByTopic.get(topicId) ?? [];
      facts.push(fact);
      factsByTopic.set(topicId, facts);
    }
  }

  const evidenceById = new Map(index.evidence.map((evidence) => [evidence.id, evidence]));

  return index.topics.map((topic) => {
    const facts = factsByTopic.get(topic.id) ?? [];
    const evidenceIds = new Set([
      ...topic.entryEvidenceIds,
      ...topic.evidenceIds,
      ...facts.flatMap((fact) => fact.evidenceIds),
    ]);
    const evidence = Array.from(evidenceIds)
      .map((id) => evidenceById.get(id))
      .filter((item): item is ProductEvidence => Boolean(item));
    const factText = facts.flatMap((fact) => [fact.text, ...fact.conditions]);
    const evidenceTokens = evidence.flatMap((item) =>
      [...item.tokens, item.filePath, item.symbol, item.reason].filter(
        (value): value is string => Boolean(value),
      ),
    );
    const searchableText = [
      topic.name,
      topic.summary,
      ...topic.aliases,
      ...factText,
      ...evidenceTokens,
    ];
    const normalizedSearchableText = searchableText
      .map((text) => normalizeSearchText(text))
      .filter(Boolean);

    return {
      topic,
      facts,
      evidence,
      searchableText,
      normalizedSearchableText,
      topicName: normalizeSearchText(topic.name),
      aliases: topic.aliases.map((alias) => normalizeSearchText(alias)).filter(Boolean),
      summary: normalizeSearchText(topic.summary),
      factText: factText.map((text) => normalizeSearchText(text)).filter(Boolean),
      evidenceTokens: evidenceTokens.map((text) => normalizeSearchText(text)).filter(Boolean),
    };
  });
}

function documentMatchesTokens(document: ProductIndexSearchDocument, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }

  const combined = document.normalizedSearchableText.join(" ");
  return tokens.every((token) => combined.includes(token));
}

function collectMatchedText(document: ProductIndexSearchDocument, tokens: string[]): string[] {
  const matched = document.searchableText.filter((text) => {
    const normalized = normalizeSearchText(text);
    return tokens.some((token) => normalized.includes(token));
  });

  return Array.from(new Set(matched)).slice(0, 8);
}

function tokenizeQuery(query: string): string[] {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .flatMap((token) => normalizeQueryToken(token))
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

function normalizeSearchText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQueryToken(token: string): string[] {
  const normalized = stripQueryAffixes(token);
  return normalized ? [normalized] : [];
}

function stripQueryAffixes(token: string): string {
  const prefixes = [
    "为什么",
    "如何",
    "怎么",
    "怎样",
    "为何",
    "请问",
    "开启",
    "打开",
    "启用",
    "使用",
    "查看",
    "进入",
    "点击",
    "设置",
    "配置",
  ];
  const suffixes = ["功能", "能力", "入口", "按钮", "页面", "界面", "逻辑", "规则", "流程"];
  let current = token;
  let changed = true;

  while (changed) {
    changed = false;

    for (const prefix of prefixes) {
      if (current.startsWith(prefix) && current.length > prefix.length) {
        current = current.slice(prefix.length);
        changed = true;
      }
    }

    for (const suffix of suffixes) {
      if (current.endsWith(suffix) && current.length > suffix.length) {
        current = current.slice(0, -suffix.length);
        changed = true;
      }
    }
  }

  return current;
}
