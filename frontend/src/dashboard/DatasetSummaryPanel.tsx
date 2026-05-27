import type { AnalysisResponse } from "../types";
import { formatCompactCurrency, formatCompactNumber } from "../utils/numberFormatting";

function legacyTopSignals(analysis: AnalysisResponse) {
  return analysis.kpis.slice(0, 5).map((kpi) => ({
    id: kpi.id,
    label: kpi.label,
    value: /revenue|sales|income|gmv|cost|spend|profit|value/i.test(kpi.label)
      ? formatCompactCurrency(kpi.aggregateValue)
      : /roi|roas/i.test(kpi.label)
        ? `${formatCompactNumber(kpi.aggregateValue)}x`
        : formatCompactNumber(kpi.aggregateValue),
    description: kpi.summary
  }));
}

interface Props {
  analysis: AnalysisResponse;
}

export function DatasetSummaryPanel({ analysis }: Props) {
  const topSignals = analysis.kpiCards?.length
    ? analysis.kpiCards.slice(0, 5).map((card) => ({
        id: card.id,
        label: card.label,
        value: card.formattedValue,
        description: card.description
      }))
    : legacyTopSignals(analysis);

  return (
    <article className="panel summary-panel">
      <div className="panel-heading">
        <div>
          <h3>Top Signals</h3>
        </div>
      </div>

      <div className="eda-summary-block">
        <div className="top-signals-list">
          {topSignals.length > 0 ? (
            topSignals.map((signal) => (
              <div className="top-signal-row" key={signal.id}>
                <div>
                  <p className="top-signal-label">{signal.label}</p>
                  <p className="top-signal-description">{signal.description}</p>
                </div>
                <strong className="top-signal-value">{signal.value}</strong>
              </div>
            ))
          ) : (
            <p className="top-signal-empty">No strong business signals were detected yet.</p>
          )}
        </div>
        <p className="top-signals-meta">
          {analysis.datasetSummary.rowCount} rows · {analysis.datasetSummary.columnCount} columns
        </p>
      </div>
    </article>
  );
}
