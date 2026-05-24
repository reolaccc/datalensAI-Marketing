import type { QuestionAnswer } from "../../../types";

interface Props {
  questionAnswer: QuestionAnswer;
}

export function ChartExplanation({ questionAnswer }: Props) {
  return (
    <aside className="panel chart-explanation-panel">
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
