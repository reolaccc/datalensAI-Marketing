import type { AnalysisResponse } from "../types";
import { buildExecutiveInsightBullets } from "../utils/executiveInsight";

interface Props {
  analysis: AnalysisResponse;
}

export function InsightPanel({ analysis }: Props) {
  const { executiveSummary } = analysis;
  const insightBullets = buildExecutiveInsightBullets(executiveSummary, 6);

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
