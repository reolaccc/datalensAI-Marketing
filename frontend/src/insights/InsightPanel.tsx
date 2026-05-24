import type { AnalysisResponse } from "../types";

interface Props {
  analysis: AnalysisResponse;
}

export function InsightPanel({ analysis }: Props) {
  const { executiveSummary } = analysis;
  const insightBullets =
    executiveSummary.bullets && executiveSummary.bullets.length > 0
      ? executiveSummary.bullets
      : [executiveSummary.overview, executiveSummary.kpiSummary, executiveSummary.anomalySummary, executiveSummary.trendSummary].filter(Boolean) as string[];

  return (
    <article className="panel insight-panel">
      <div className="panel-heading">
        <div>
          <h3>Executive Insight</h3>
        </div>
      </div>

      <div className="insight-list">
        <ol className="executive-summary-list">
          {insightBullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ol>
      </div>
    </article>
  );
}
