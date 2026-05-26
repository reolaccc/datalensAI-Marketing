import type { AnalysisResponse } from "../types";
import { buildCompactEdaHighlights } from "../utils/edaSummary";

interface Props {
  analysis: AnalysisResponse;
}

export function DatasetSummaryPanel({ analysis }: Props) {
  const edaSummaryBullets = buildCompactEdaHighlights(analysis);

  return (
    <article className="panel summary-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Data Profiling</p>
        </div>
      </div>

      <div className="eda-summary-block">
        <ul className="eda-summary-list">
          {edaSummaryBullets.length > 0 ? (
            edaSummaryBullets.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>No EDA summary available.</li>
          )}
        </ul>
      </div>
    </article>
  );
}
