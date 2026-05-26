import type { AnalysisResponse } from "../types";
import { formatCompactCurrency, formatCompactNumber } from "../utils/numberFormatting";

interface Props {
  analysis: AnalysisResponse;
}

function hasCallRelatedDomain(analysis: AnalysisResponse) {
  const domain = analysis.profile.semanticContract?.detectedDomain?.domain;
  return (
    domain === "call_tracking" ||
    domain === "marketing_attribution" ||
    domain === "mixed_call_tracking_attribution" ||
    domain === "call_operations"
  );
}

function legacyKpiCards(analysis: AnalysisResponse) {
  return analysis.kpis.slice(0, 5).map((kpi) => ({
    id: kpi.id,
    label: kpi.label,
    value: kpi.aggregateValue,
    formattedValue: /revenue|sales|income|gmv|cost|spend|profit|value/i.test(kpi.label)
      ? formatCompactCurrency(kpi.aggregateValue)
      : /roi|roas/i.test(kpi.label)
        ? `${formatCompactNumber(kpi.aggregateValue)}x`
        : formatCompactNumber(kpi.aggregateValue),
    unit: "",
    metricType: "generic_number" as const,
    description: kpi.summary,
    formula: kpi.column,
    reliability: "medium" as const,
    priority: 0,
    warnings: [] as string[],
    contextLine: undefined
  }));
}

export function KpiCardGrid({ analysis }: Props) {
  const cards = hasCallRelatedDomain(analysis)
    ? analysis.kpiCards ?? []
    : analysis.kpiCards?.length
      ? analysis.kpiCards
      : legacyKpiCards(analysis);

  function renderContextLine(contextLine?: string) {
    if (!contextLine) {
      return null;
    }

    const parts = contextLine
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length <= 1) {
      return <p className="kpi-context">{contextLine}</p>;
    }

    return (
      <p className="kpi-context kpi-context-stack">
        {parts.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </p>
    );
  }

  return (
    <section className="kpi-grid">
      {cards.map((card) => (
        <article className="panel kpi-card" key={card.id}>
          <div className="kpi-card-header">
            <div>
              <p className="eyebrow">{card.label}</p>
            </div>
          </div>

          <div className="kpi-value-row">
            <h2>
              {card.formattedValue}
              {card.unit && !/[x%]$/.test(card.formattedValue) ? (
                <span className="kpi-unit" aria-label={card.unit}>
                  {card.unit}
                </span>
              ) : null}
            </h2>
          </div>

          {renderContextLine(card.contextLine)}
          <p className="kpi-description">{card.description}</p>
          {card.warnings?.length ? <p className="kpi-warning-note">{card.warnings[0]}</p> : null}
        </article>
      ))}
    </section>
  );
}
