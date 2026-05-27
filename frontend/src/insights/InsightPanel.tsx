import type { AnalysisResponse } from "../types";
import { buildExecutiveInsightBullets } from "../utils/executiveInsight";
import { buildQuestionSuggestions } from "../utils/questionSuggestions";

interface Props {
  analysis: AnalysisResponse;
}

export function InsightPanel({ analysis }: Props) {
  const { executiveSummary } = analysis;
  const dataSummaryNotes = analysis.dataSummaryNotes ?? [];
  const insightBullets = buildExecutiveInsightBullets(executiveSummary, 3);
  const suggestedQuestions = buildQuestionSuggestions(analysis).slice(0, 4);

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

          <div className="insight-followup-block">
            <h4>Suggested Next Questions</h4>
            <ul className="suggested-question-list">
              {suggestedQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </article>
  );
}
