import { DynamicChartGrid } from "../DynamicChartGrid/DynamicChartGrid";
import { ChartExplanation } from "../ChartExplanation/ChartExplanation";
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
      <ChartExplanation questionAnswer={questionAnswer} />
      <DynamicChartGrid charts={questionAnswer.recommendedCharts} />
    </section>
  );
}
