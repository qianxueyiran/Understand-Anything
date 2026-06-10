import { z } from "zod";
import type { KnowledgeGraph } from "./types.js";
import {
  type NormalizedProductTopic,
  type ProductBoundaryCandidate,
  type ProductTopicExtraction,
  type TopicContextPack,
} from "./product-index-builder.js";
import {
  isAllowedProductFactType,
  normalizeProductFactType,
  ProductConfidenceSchema,
  ProductFactTypeSchema,
  ProductTopicKindSchema,
} from "./product-index.js";

export const PipelineWarningSeveritySchema = z.enum(["info", "warning", "error"]);
export type PipelineWarningSeverity = z.infer<typeof PipelineWarningSeveritySchema>;

export interface ProductPipelineWarning {
  code: string;
  severity: PipelineWarningSeverity;
  stage: string;
  message: string;
  topicId?: string;
  candidateId?: string;
  fileId?: string;
  evidenceRef?: string;
}

const TopicNormalizationTopicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  kind: ProductTopicKindSchema,
  sourceCandidateIds: z.array(z.string().min(1)).default([]),
  rootNodeIds: z.array(z.string().min(1)).default([]),
  domainRefs: z.array(z.string().min(1)).default([]),
  confidence: ProductConfidenceSchema.optional(),
});

const DiscardedCandidateSchema = z.object({
  candidateId: z.string().min(1),
  reason: z.string().min(1),
});

const TopicSourceReadSchema = z.object({
  candidateId: z.string().min(1).optional(),
  filePath: z.string().min(1),
  reason: z.string().min(1),
});

const PipelineWarningInputSchema = z.object({
  code: z.string().min(1),
  severity: PipelineWarningSeveritySchema.default("warning"),
  stage: z.string().min(1).default("llm"),
  message: z.string().min(1),
  topicId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
  evidenceRef: z.string().min(1).optional(),
});

export const ProductTopicNormalizationSchema = z.object({
  topics: z.array(TopicNormalizationTopicSchema),
  discardedCandidates: z.array(DiscardedCandidateSchema).default([]),
  sourceReads: z.array(TopicSourceReadSchema).default([]),
  warnings: z.array(PipelineWarningInputSchema).default([]),
});

export type ProductTopicNormalization = z.infer<typeof ProductTopicNormalizationSchema>;

const ProductExtractionSourceReadSchema = z.object({
  fileId: z.string().min(1).optional(),
  filePath: z.string().min(1),
  reason: z.string().min(1),
});

const ProductExtractionFileDecisionSchema = z.object({
  fileId: z.string().min(1),
  reason: z.string().min(1),
});

const ProductExtractionFactSchema = z.object({
  type: ProductFactTypeSchema,
  text: z.string().min(1),
  conditions: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  confidence: ProductConfidenceSchema,
});

const ProductTopicExtractionSchema = z.object({
  topicId: z.string().min(1),
  sourceReads: z.array(ProductExtractionSourceReadSchema).default([]),
  usedFiles: z.array(ProductExtractionFileDecisionSchema).default([]),
  ignoredFiles: z.array(ProductExtractionFileDecisionSchema).default([]),
  facts: z.array(ProductExtractionFactSchema).default([]),
  warnings: z.array(PipelineWarningInputSchema).default([]),
});

export interface TopicNormalizationValidationResult {
  normalization: ProductTopicNormalization;
  warnings: ProductPipelineWarning[];
}

export interface ProductExtractionValidationResult {
  extractions: ProductTopicExtraction[];
  warnings: ProductPipelineWarning[];
}

export interface ProductIndexTrace {
  mode: "llm-strict";
  boundaryCandidates: ProductBoundaryCandidate[];
  topicNormalization: ProductTopicNormalization;
  contextPacks: TopicContextPack[];
  extractions: ProductTopicExtraction[];
  discardedCandidates: ProductTopicNormalization["discardedCandidates"];
  ignoredFiles: Array<{ topicId: string; fileId: string; reason: string }>;
  overflowFiles: Array<{ topicId: string; filePath: string }>;
  warnings: ProductPipelineWarning[];
}

export function validateTopicNormalization(
  data: unknown,
  candidates: ProductBoundaryCandidate[] = [],
  graph?: KnowledgeGraph,
): TopicNormalizationValidationResult {
  if (!isRecord(data) || !Array.isArray(data.topics)) {
    throw new Error("product-topic-normalization.json must contain a topics array.");
  }

  const parsed = ProductTopicNormalizationSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid product-topic-normalization.json: ${formatZodError(parsed.error)}`);
  }

  const normalization = parsed.data;
  const warnings: ProductPipelineWarning[] = normalization.warnings.map((warning) => ({
    ...warning,
    severity: warning.severity,
    stage: warning.stage,
  }));
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const nodeIds = new Set(graph?.nodes.map((node) => node.id) ?? []);
  const usedCandidateIds = new Set<string>();
  const discardedCandidateIds = new Set(normalization.discardedCandidates.map((item) => item.candidateId));

  for (const topic of normalization.topics) {
    if (looksLikeClassName(topic.name)) {
      warnings.push(warning("topic-name-looks-like-class", "topic-normalization", "Topic name looks like a code class name.", {
        topicId: topic.id,
        candidateId: topic.sourceCandidateIds[0],
      }));
    }
    if (topic.summary.trim().length < 8 || looksLikeCodeExplanation(topic.summary)) {
      warnings.push(warning("topic-summary-too-short", "topic-normalization", "Topic summary is too short or code-oriented.", {
        topicId: topic.id,
      }));
    }

    for (const candidateId of topic.sourceCandidateIds) {
      usedCandidateIds.add(candidateId);
      if (candidateIds.size > 0 && !candidateIds.has(candidateId)) {
        warnings.push(warning("unknown-source-candidate", "topic-normalization", `Topic references unknown candidate ${candidateId}.`, {
          topicId: topic.id,
          candidateId,
        }));
      }
    }

    for (const rootNodeId of topic.rootNodeIds) {
      if (nodeIds.size > 0 && !nodeIds.has(rootNodeId)) {
        warnings.push(warning("unknown-root-node", "topic-normalization", `Topic references unknown graph node ${rootNodeId}.`, {
          topicId: topic.id,
        }));
      }
    }
  }

  for (const item of normalization.discardedCandidates) {
    if (candidateIds.size > 0 && !candidateIds.has(item.candidateId)) {
      warnings.push(warning("unknown-discarded-candidate", "topic-normalization", `Discarded candidate does not exist: ${item.candidateId}.`, {
        candidateId: item.candidateId,
      }));
    }
    if (usedCandidateIds.has(item.candidateId)) {
      warnings.push(warning("candidate-used-and-discarded", "topic-normalization", `Candidate is both used and discarded: ${item.candidateId}.`, {
        candidateId: item.candidateId,
      }));
    }
  }

  for (const candidate of candidates) {
    if (!usedCandidateIds.has(candidate.id) && !discardedCandidateIds.has(candidate.id)) {
      warnings.push(warning("candidate-not-normalized", "topic-normalization", `Candidate was neither used nor discarded: ${candidate.id}.`, {
        candidateId: candidate.id,
      }));
    }
  }

  return { normalization, warnings };
}

export function applyTopicNormalization(
  normalization: ProductTopicNormalization,
  candidates: ProductBoundaryCandidate[] = [],
): NormalizedProductTopic[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return normalization.topics.map((topic) => {
    const sourceCandidates = topic.sourceCandidateIds
      .map((candidateId) => candidateById.get(candidateId))
      .filter((candidate): candidate is ProductBoundaryCandidate => candidate !== undefined);
    return {
      id: topic.id,
      name: topic.name,
      summary: topic.summary,
      kind: topic.kind,
      sourceCandidateIds: uniqueStrings(topic.sourceCandidateIds),
      rootNodeIds: uniqueStrings([
        ...topic.rootNodeIds,
        ...sourceCandidates.map((candidate) => candidate.rootNodeId),
      ]),
      domainRefs: uniqueStrings([
        ...topic.domainRefs,
        ...sourceCandidates.flatMap((candidate) => candidate.domainRefs),
      ]),
    };
  });
}

export function normalizeProductExtractionsPayload(data: unknown): {
  data: unknown;
  coercions: Array<{ topicId: string; from: string; to: string }>;
} {
  if (!Array.isArray(data)) {
    return { data, coercions: [] };
  }

  const coercions: Array<{ topicId: string; from: string; to: string }> = [];
  const normalized = data.map((item) => {
    if (!item || typeof item !== "object" || !("facts" in item)) {
      return item;
    }
    const extraction = item as {
      topicId?: string;
      facts?: Array<{ type?: unknown } & Record<string, unknown>>;
    };
    const topicId = typeof extraction.topicId === "string" ? extraction.topicId : "unknown-topic";
    const facts = Array.isArray(extraction.facts)
      ? extraction.facts.map((fact) => {
          const rawType = fact.type;
          if (isAllowedProductFactType(rawType)) {
            return fact;
          }
          const from = typeof rawType === "string" ? rawType : String(rawType ?? "");
          const to = normalizeProductFactType(rawType);
          coercions.push({ topicId, from, to });
          return { ...fact, type: to };
        })
      : extraction.facts;
    return { ...extraction, facts };
  });

  return { data: normalized, coercions };
}

export function validateProductExtractions(
  data: unknown,
  contextPacks: TopicContextPack[],
): ProductExtractionValidationResult {
  if (!Array.isArray(data)) {
    throw new Error("product-index-extractions.json must be a JSON array.");
  }

  const { data: normalizedData, coercions } = normalizeProductExtractionsPayload(data);
  const parsed = z.array(ProductTopicExtractionSchema).safeParse(normalizedData);
  if (!parsed.success) {
    throw new Error(`Invalid product-index-extractions.json: ${formatZodError(parsed.error)}`);
  }

  const extractions = parsed.data;
  const warnings: ProductPipelineWarning[] = coercions.map((coercion) =>
    warning(
      "fact-type-coerced-from-signal",
      "fact-extraction",
      `Fact type "${coercion.from}" is an evidence signal label, not a product fact type; coerced to "${coercion.to}".`,
      { topicId: coercion.topicId },
    ),
  );
  const packByTopicId = new Map(contextPacks.map((pack) => [pack.topic.id, pack]));
  const extractionCounts = new Map<string, number>();

  for (const extraction of extractions) {
    extractionCounts.set(extraction.topicId, (extractionCounts.get(extraction.topicId) ?? 0) + 1);
    const pack = packByTopicId.get(extraction.topicId);
    warnings.push(
      ...extraction.warnings.map((item) => ({
        ...item,
        topicId: item.topicId ?? extraction.topicId,
      })),
    );
    if (!pack) {
      warnings.push(warning("unknown-extraction-topic", "fact-extraction", `Extraction references unknown topic ${extraction.topicId}.`, {
        topicId: extraction.topicId,
      }));
      continue;
    }

    const fileIds = new Set(pack.candidateFiles.map((file) => file.fileId));
    const anchorToFileId = new Map<string, string>();
    for (const file of pack.candidateFiles) {
      for (const anchor of file.anchors) {
        anchorToFileId.set(anchor.anchorId, file.fileId);
      }
    }
    const usedFileIds = new Set(extraction.usedFiles.map((file) => file.fileId));
    const ignoredFileIds = new Set(extraction.ignoredFiles.map((file) => file.fileId));

    for (const file of [...extraction.usedFiles, ...extraction.ignoredFiles]) {
      if (!fileIds.has(file.fileId)) {
        warnings.push(warning("unknown-extraction-file", "fact-extraction", `Extraction references unknown file ${file.fileId}.`, {
          topicId: extraction.topicId,
          fileId: file.fileId,
        }));
      }
    }

    for (const fact of extraction.facts) {
      if (fact.evidenceRefs.length === 0) {
        warnings.push(warning("fact-without-evidence-refs", "fact-extraction", "Fact has no evidenceRefs.", {
          topicId: extraction.topicId,
        }));
      }
      if (looksLikeCodeExplanation(fact.text)) {
        warnings.push(warning("fact-text-looks-like-code", "fact-extraction", "Fact text looks like a code explanation.", {
          topicId: extraction.topicId,
        }));
      }

      const evidenceFileIds = new Set<string>();
      for (const evidenceRef of fact.evidenceRefs) {
        const fileId = anchorToFileId.get(evidenceRef);
        if (!fileId) {
          warnings.push(warning("invalid-evidence-ref", "fact-extraction", `Evidence ref does not exist: ${evidenceRef}.`, {
            topicId: extraction.topicId,
            evidenceRef,
          }));
          continue;
        }
        evidenceFileIds.add(fileId);
        if (ignoredFileIds.has(fileId)) {
          warnings.push(warning("ignored-file-used-as-evidence", "fact-extraction", `Ignored file is referenced by fact evidence: ${fileId}.`, {
            topicId: extraction.topicId,
            fileId,
          }));
        }
      }

      for (const fileId of evidenceFileIds) {
        if (!usedFileIds.has(fileId)) {
          warnings.push(warning("used-files-missing-evidence-file", "fact-extraction", `usedFiles does not include evidence file ${fileId}.`, {
            topicId: extraction.topicId,
            fileId,
          }));
        }
      }
    }
  }

  for (const pack of contextPacks) {
    const count = extractionCounts.get(pack.topic.id) ?? 0;
    if (count === 0) {
      warnings.push(warning("missing-topic-extraction", "fact-extraction", `No extraction exists for topic ${pack.topic.id}.`, {
        topicId: pack.topic.id,
      }));
    } else if (count > 1) {
      warnings.push(warning("duplicate-topic-extraction", "fact-extraction", `Multiple extractions exist for topic ${pack.topic.id}.`, {
        topicId: pack.topic.id,
      }));
    }
  }

  return { extractions, warnings };
}

export function buildProductIndexTrace(input: {
  boundaryCandidates: ProductBoundaryCandidate[];
  topicNormalization: ProductTopicNormalization;
  contextPacks: TopicContextPack[];
  extractions: ProductTopicExtraction[];
  warnings: ProductPipelineWarning[];
}): ProductIndexTrace {
  return {
    mode: "llm-strict",
    boundaryCandidates: input.boundaryCandidates,
    topicNormalization: input.topicNormalization,
    contextPacks: input.contextPacks,
    extractions: input.extractions,
    discardedCandidates: input.topicNormalization.discardedCandidates,
    ignoredFiles: input.extractions.flatMap((extraction) =>
      extraction.ignoredFiles.map((file) => ({
        topicId: extraction.topicId,
        fileId: file.fileId,
        reason: file.reason,
      })),
    ),
    overflowFiles: input.contextPacks.flatMap((pack) => {
      const legacyOverflow = (pack as TopicContextPack & { overflowFiles?: string[] }).overflowFiles;
      if (!legacyOverflow?.length) {
        return [];
      }

      return legacyOverflow.map((filePath) => ({
        topicId: pack.topic.id,
        filePath,
      }));
    }),
    warnings: input.warnings,
  };
}

function warning(
  code: string,
  stage: string,
  message: string,
  extra: Omit<Partial<ProductPipelineWarning>, "code" | "severity" | "stage" | "message"> = {},
): ProductPipelineWarning {
  return {
    code,
    severity: "warning",
    stage,
    message,
    ...extra,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function looksLikeClassName(text: string): boolean {
  const trimmed = text.trim();
  return /^[A-Z][A-Za-z0-9]*$/.test(trimmed) && /[a-z][A-Z]/.test(trimmed);
}

function looksLikeCodeExplanation(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(class|function|method|callback|handler|receiver|activity|fragment)\b/.test(normalized) ||
    /调用|方法|函数|类|组件/.test(text)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}
