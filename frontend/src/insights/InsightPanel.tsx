import type { AnalysisResponse } from "../types";
import { useAnalysisStore } from "../stores/analysisStore";
import { buildQuestionSuggestions } from "../utils/questionSuggestions";

interface Props {
  analysis: AnalysisResponse;
}

export function InsightPanel({ analysis }: Props) {
  const { executiveSummary } = analysis;
  const setDraftQuestion = useAnalysisStore((state) => state.setDraftQuestion);
  const questionSuggestions = buildQuestionSuggestions(analysis);
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
        {executiveSummary.warning ? <p className="workspace-meta">{executiveSummary.warning}</p> : null}
      </div>

      <div>
        <p className="eyebrow">Suggested analytical questions</p>
        <label className="question-suggestion-field">
          <span>Choose a guided question</span>
          <select
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                setDraftQuestion(event.target.value);
              }
            }}
          >
            <option value="" disabled>
              Select a question
            </option>
            {questionSuggestions.map((question) => (
              <option key={question} value={question}>
                {question}
              </option>
            ))}
          </select>
        </label>
        <p className="question-suggestion-note">
          Pick one question to load it into Ask, then use the single Ask button there.
        </p>
      </div>
    </article>
  );
}
