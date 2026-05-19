import { useMemo, useState } from "react";
import type {
  ProductEvidence,
  ProductTopic,
} from "@understand-anything/core/product-index";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";

const RESULT_LIMIT = 12;
const ALIAS_LIMIT = 5;

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function collectTopicText(topic: ProductTopic): string {
  return normalizeText(
    [
      topic.name,
      topic.kind,
      topic.status,
      topic.summary,
      ...topic.aliases,
      ...topic.domainRefs,
    ].join(" "),
  );
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function findEvidenceTarget(
  evidence: ProductEvidence[],
  graph: KnowledgeGraph | null,
): string | null {
  if (!graph) return null;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const item of evidence) {
    if (item.nodeId && nodesById.has(item.nodeId)) {
      return item.nodeId;
    }
  }

  for (const item of evidence) {
    if (!item.filePath) continue;
    const evidencePath = normalizeFilePath(item.filePath);
    const exactNode = graph.nodes.find((candidate) => {
      if (!candidate.filePath) return false;
      return normalizeFilePath(candidate.filePath) === evidencePath;
    });
    if (exactNode) return exactNode.id;
  }

  const suffixMatchIds = new Set<string>();
  for (const item of evidence) {
    if (!item.filePath) continue;
    const evidencePath = normalizeFilePath(item.filePath);
    const suffixMatches = graph.nodes.filter((candidate) => {
      if (!candidate.filePath) return false;
      return normalizeFilePath(candidate.filePath).endsWith(`/${evidencePath}`);
    });
    for (const node of suffixMatches) {
      suffixMatchIds.add(node.id);
    }
  }

  return suffixMatchIds.size === 1 ? Array.from(suffixMatchIds)[0] : null;
}

export default function ProductIndexPanel() {
  const productIndex = useDashboardStore((s) => s.productIndex);
  const graph = useDashboardStore((s) => s.graph);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const [query, setQuery] = useState("");

  const evidenceById = useMemo(
    () => new Map((productIndex?.evidence ?? []).map((evidence) => [evidence.id, evidence])),
    [productIndex],
  );
  const factsById = useMemo(
    () => new Map((productIndex?.facts ?? []).map((fact) => [fact.id, fact])),
    [productIndex],
  );

  const topics = useMemo(() => {
    if (!productIndex) return [];
    const normalizedQuery = normalizeText(query.trim());
    const matches = normalizedQuery
      ? productIndex.topics.filter((topic) => collectTopicText(topic).includes(normalizedQuery))
      : productIndex.topics;
    return matches.slice(0, RESULT_LIMIT);
  }, [productIndex, query]);

  if (!productIndex) return null;

  return (
    <section className="border-b border-border-subtle px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-accent">Product Index</h3>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {productIndex.coverage.indexedTopics} indexed topics
          </p>
        </div>
        <span className="shrink-0 rounded border border-border-subtle bg-elevated px-2 py-1 font-mono text-[11px] text-text-secondary">
          {productIndex.topics.length}
        </span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search product topics"
        className="mb-3 w-full rounded-md border border-border-subtle bg-elevated px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
      />

      {topics.length === 0 ? (
        <p className="text-xs text-text-muted">No product topics found.</p>
      ) : (
        <div className="space-y-2.5">
          {topics.map((topic) => {
            const topicEvidence = Array.from(
              new Set([...topic.entryEvidenceIds, ...topic.evidenceIds]),
            )
              .map((id) => evidenceById.get(id))
              .filter((item): item is ProductEvidence => Boolean(item));
            const facts = (topic.factIds ?? [])
              .map((id) => factsById.get(id))
              .filter(Boolean);
            const evidenceTarget = findEvidenceTarget(topicEvidence, graph);
            const extraAliasCount = Math.max(0, topic.aliases.length - ALIAS_LIMIT);

            return (
              <article
                key={topic.id}
                className="rounded-lg border border-border-subtle bg-elevated/60 p-3"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h4 className="min-w-0 text-sm font-medium leading-snug text-text-primary [overflow-wrap:anywhere]">
                    {topic.name}
                  </h4>
                  <span className="shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                    {topic.status}
                  </span>
                </div>

                <p className="mb-2 text-xs leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                  {topic.summary}
                </p>

                {topic.aliases.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {topic.aliases.slice(0, ALIAS_LIMIT).map((alias) => (
                      <span
                        key={`${topic.id}-${alias}`}
                        className="max-w-full rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] text-text-secondary [overflow-wrap:anywhere]"
                      >
                        {alias}
                      </span>
                    ))}
                    {extraAliasCount > 0 && (
                      <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] text-text-muted">
                        +{extraAliasCount}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <div className="min-w-0">
                    <div className="font-medium text-text-secondary">Fact Evidence</div>
                    <div className="font-mono text-text-muted">
                      {topic.factIds?.length ?? facts.length} facts · {topic.evidenceIds.length}{" "}
                      evidence refs
                    </div>
                  </div>
                  {evidenceTarget ? (
                    <button
                      type="button"
                      onClick={() => openCodeViewer(evidenceTarget)}
                      className="shrink-0 font-medium text-accent transition-colors hover:text-accent-light"
                    >
                      View evidence
                    </button>
                  ) : (
                    <span className="shrink-0 text-text-muted">No graph evidence</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
