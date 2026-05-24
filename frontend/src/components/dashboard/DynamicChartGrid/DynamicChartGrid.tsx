import { ChartCard } from "../../../charts/ChartCard";
import type { AnalysisResponse } from "../../../types";

interface Props {
  charts: AnalysisResponse["charts"];
}

export function DynamicChartGrid({ charts }: Props) {
  return (
    <div className="chart-grid question-chart-grid">
      {charts.slice(0, 4).map((chart) => (
        <ChartCard chart={chart} key={chart.id} />
      ))}
    </div>
  );
}
