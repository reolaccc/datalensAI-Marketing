import type { QuestionAnswer } from "../../../types";

interface Props {
  questionAnswer: QuestionAnswer;
}

export function ChartExplanation({ questionAnswer }: Props) {
  return (
    <aside className="panel chart-explanation-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Rule-based analysis</p>
          <h3>Why these charts</h3>
        </div>
      </div>

      {questionAnswer.analysisSummary ? <p>{questionAnswer.analysisSummary}</p> : null}
      {questionAnswer.chartSelectionSummary ? <p>{questionAnswer.chartSelectionSummary}</p> : null}

      {questionAnswer.missingFieldWarnings?.length ? (
        <div className="chart-warning-block">
          <p className="eyebrow">Warnings</p>
          <ul className="eda-summary-list">
            {questionAnswer.missingFieldWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {questionAnswer.suggestedFollowUps?.length ? (
        <div className="chart-warning-block">
          <p className="eyebrow">Suggested follow-ups</p>
          <ul className="eda-summary-list">
            {questionAnswer.suggestedFollowUps.map((followUp) => (
              <li key={followUp}>{followUp}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
