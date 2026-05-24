import type { AnalysisResponse } from "../types";
import { formatCompactNumber } from "../utils/numberFormatting";

interface Props {
  analysis: AnalysisResponse;
}

function legacyKpiCards(analysis: AnalysisResponse) {
  return analysis.kpis.slice(0, 4).map((kpi) => ({
    id: kpi.id,
    label: kpi.label,
    value: kpi.aggregateValue,
    formattedValue: formatCompactNumber(kpi.aggregateValue),
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
  const cards = analysis.kpiCards?.length ? analysis.kpiCards : legacyKpiCards(analysis);

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

          {card.contextLine ? <p className="kpi-context">{card.contextLine}</p> : null}
          <p className="kpi-description">{card.description}</p>
          {card.warnings?.length ? <p className="kpi-warning-note">{card.warnings[0]}</p> : null}
        </article>
      ))}
    </section>
  );
}
