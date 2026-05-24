import type { QuestionAnswer } from "../../../types";

interface Props {
  questionAnswer: QuestionAnswer;
}

export function ChartExplanation({ questionAnswer }: Props) {
  if (!questionAnswer.suggestedFollowUps?.length) {
    return null;
  }

  return (
    <div className="chart-warning-block">
      <ul className="eda-summary-list">
        {questionAnswer.suggestedFollowUps.map((followUp) => (
          <li key={followUp}>{followUp}</li>
        ))}
      </ul>
    </div>
  );
}
