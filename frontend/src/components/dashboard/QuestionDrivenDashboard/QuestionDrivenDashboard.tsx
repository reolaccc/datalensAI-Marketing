import { DynamicChartGrid } from "../DynamicChartGrid/DynamicChartGrid";
import type { QuestionAnswer } from "../../../types";

interface Props {
  questionAnswer: QuestionAnswer;
}

export function QuestionDrivenDashboard({ questionAnswer }: Props) {
  if (!questionAnswer.recommendedCharts?.length) {
    return null;
  }

  return (
    <section className="question-driven-dashboard">
      <DynamicChartGrid charts={questionAnswer.recommendedCharts} compact />
    </section>
  );
}
