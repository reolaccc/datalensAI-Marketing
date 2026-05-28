import type { AnalysisResponse } from "../types";
import { buildExecutiveInsightBullets } from "../utils/executiveInsight";

interface Props {
  analysis: AnalysisResponse;
}

export function InsightPanel({ analysis }: Props) {
  const { executiveSummary } = analysis;
  const dataSummaryNotes = analysis.dataSummaryNotes ?? [];
  const insightBullets = buildExecutiveInsightBullets(executiveSummary, 5);

  return (
    <article className="panel insight-panel">
      <div className="insight-list">
        {dataSummaryNotes.length > 0 ? (
          <section className="insight-section">
            <div className="panel-heading">
              <div>
                <h3>Data Summary</h3>
              </div>
            </div>

            <ul className="data-summary-list">
              {dataSummaryNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="insight-section">
          <div className="panel-heading">
            <div>
              <h3>Executive Insight</h3>
            </div>
          </div>

        <ol className="executive-summary-list">
          {insightBullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ol>

        </section>
      </div>
    </article>
  );
}
