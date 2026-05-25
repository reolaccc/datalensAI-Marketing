import { ChartCard } from "../../../charts/ChartCard";
import type { AnalysisResponse } from "../../../types";

interface Props {
  charts: AnalysisResponse["charts"];
  compact?: boolean;
}

export function DynamicChartGrid({ charts, compact = false }: Props) {
  return (
    <div className="chart-grid question-chart-grid">
      {charts.slice(0, 4).map((chart) => (
        <ChartCard chart={chart} compact={compact} key={chart.id} />
      ))}
    </div>
  );
}
