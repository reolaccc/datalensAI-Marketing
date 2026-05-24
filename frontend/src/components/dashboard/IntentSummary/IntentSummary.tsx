import type { QuestionAnswer } from "../../../types";

interface Props {
  questionAnswer: QuestionAnswer;
}

function humanizeIntent(intent?: string) {
  return intent ? intent.replace(/_/g, " ") : "general overview";
}

export function IntentSummary({ questionAnswer }: Props) {
  const intent = questionAnswer.detectedIntent;

  if (!intent) {
    return null;
  }

  return (
    <article className="panel question-intent-summary">
      <p className="eyebrow">Detected intent</p>
      <h3>{humanizeIntent(intent.primaryIntent)}</h3>
      <p>
        Confidence {(intent.confidence * 100).toFixed(0)}%
        {intent.targetMetrics.length ? ` · Metrics: ${intent.targetMetrics.join(", ")}` : ""}
        {intent.targetDimensions.length ? ` · Dimensions: ${intent.targetDimensions.join(", ")}` : ""}
      </p>
    </article>
  );
}
