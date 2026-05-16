import { useMemo, useState } from "react";
import type {
  EvidenceRef,
  ProductConcept,
} from "@understand-anything/core/product-knowledge";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { productKnowledge as enProductKnowledge } from "../locales/en";
import { productKnowledge as zhProductKnowledge } from "../locales/zh";

const RESULT_LIMIT = 12;

function collectSearchText(concept: ProductConcept): string {
  return [
    concept.name,
    concept.meaning,
    ...concept.userFacingTerms,
    ...concept.businessRules,
    ...concept.displayRules.flatMap((rule) => [rule.condition, rule.result]),
    ...concept.dataFields.flatMap((field) => [field.name, field.meaning, field.source]),
  ].join(" ").toLowerCase();
}

function collectConceptEvidence(concept: ProductConcept): EvidenceRef[] {
  return [
    ...concept.evidence,
    ...concept.displayRules.flatMap((rule) => rule.evidence),
    ...concept.dataFields.flatMap((field) => field.evidence),
  ];
}

function findEvidenceTarget(
  evidence: EvidenceRef[],
  graph: ReturnType<typeof useDashboardStore.getState>["graph"],
): string | null {
  if (!graph || evidence.length === 0) return null;

  for (const ref of evidence) {
    if (ref.nodeId) {
      const node = graph.nodes.find((candidate) => candidate.id === ref.nodeId);
      if (node?.filePath) {
        return node.id;
      }
    }

    if (!ref.filePath) continue;
    const node = graph.nodes.find((candidate) => candidate.filePath === ref.filePath);
    if (node) return node.id;
  }

  return null;
}

export default function ProductKnowledgePanel() {
  const productKnowledge = useDashboardStore((s) => s.productKnowledge);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const graph = useDashboardStore((s) => s.graph);
  const [query, setQuery] = useState("");
  const { localeKey } = useI18n();
  const labels = localeKey === "zh" ? zhProductKnowledge : enProductKnowledge;

  const concepts = useMemo(() => {
    if (!productKnowledge) return [];
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery
      ? productKnowledge.concepts.filter((concept) =>
          collectSearchText(concept).includes(normalizedQuery),
        )
      : productKnowledge.concepts;
    return matches.slice(0, RESULT_LIMIT);
  }, [productKnowledge, query]);

  if (!productKnowledge) return null;

  return (
    <section className="border-t border-border-subtle px-5 py-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">
          {labels.title}
        </h3>
        <span className="text-[11px] font-mono text-text-muted">
          {productKnowledge.concepts.length}
        </span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={labels.searchPlaceholder}
        className="w-full mb-3 rounded-md border border-border-subtle bg-elevated px-3 py-2 text-xs text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent/50"
      />

      {concepts.length === 0 ? (
        <p className="text-xs text-text-muted">{labels.noResults}</p>
      ) : (
        <div className="space-y-3">
          {concepts.map((concept) => {
            const evidenceTarget = findEvidenceTarget(collectConceptEvidence(concept), graph);
            return (
              <article
                key={concept.id}
                className="rounded-lg border border-border-subtle bg-elevated/60 p-3"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h4 className="text-sm font-medium text-text-primary leading-snug">
                    {concept.name}
                  </h4>
                  <span className="shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono text-accent">
                    {concept.confidence}
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-text-secondary mb-2">
                  {concept.meaning}
                </p>

                {concept.userFacingTerms.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {concept.userFacingTerms.map((term, index) => (
                      <span
                        key={`${concept.id}-term-${index}`}
                        className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-text-secondary border border-border-subtle"
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                )}

                {concept.displayRules.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {labels.displayRules}
                    </div>
                    <ul className="space-y-1">
                      {concept.displayRules.slice(0, 2).map((rule, index) => (
                        <li key={`${rule.condition}-${index}`} className="text-[11px] leading-relaxed text-text-secondary">
                          <span className="text-text-muted">{rule.condition}</span>
                          <span className="text-accent/70"> - </span>
                          {rule.result}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {evidenceTarget && (
                  <button
                    type="button"
                    onClick={() => openCodeViewer(evidenceTarget)}
                    className="text-[11px] font-medium text-accent hover:text-accent-light transition-colors"
                  >
                    {labels.viewEvidence}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
