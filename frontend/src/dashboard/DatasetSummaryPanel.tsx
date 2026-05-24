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
          <p className="eyebrow">Dataset summary</p>
          <h3>{analysis.fileName}</h3>
        </div>
      </div>

      <div className="eda-summary-block">
        <p className="eyebrow">EDA summary</p>
        <ul className="eda-summary-list">
          {edaSummaryBullets.length > 0 ? (
            edaSummaryBullets.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>No EDA summary available.</li>
          )}
        </ul>
      </div>

      <div className="tag-row">
        {analysis.profile.numericColumns.map((column) => (
          <span className="tag" key={column}>
            {column}
          </span>
        ))}
      </div>
    </article>
  );
}
