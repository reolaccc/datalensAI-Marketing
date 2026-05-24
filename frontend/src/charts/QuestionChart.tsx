import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { QuestionAnswer } from "../types";
import { AXIS_COLOR, CHART_PALETTE, GRID_COLOR } from "./chartPalette";
import { formatCompactNumber } from "../utils/numberFormatting";

interface Props {
  chartSuggestion: NonNullable<QuestionAnswer["chartSuggestion"]>;
  height?: number;
}

function tooltipFormatter(value: unknown) {
  return typeof value === "number" ? formatCompactNumber(value) : String(value ?? "");
}

function axisTickFormatter(value: unknown) {
  return typeof value === "number" ? formatCompactNumber(value) : String(value ?? "");
}

export function QuestionChart({ chartSuggestion, height = 240 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {chartSuggestion.chartType === "line" ? (
        <LineChart data={chartSuggestion.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={chartSuggestion.xKey} stroke={AXIS_COLOR} />
          <YAxis stroke={AXIS_COLOR} tickFormatter={axisTickFormatter} />
          <Tooltip formatter={tooltipFormatter} />
          {chartSuggestion.series?.length ? <Legend /> : null}
          {chartSuggestion.series?.length ? (
            chartSuggestion.series.map((seriesKey, index) => (
              <Line
                key={seriesKey}
                type="monotone"
                dataKey={seriesKey}
                stroke={CHART_PALETTE[index % CHART_PALETTE.length]}
                strokeWidth={3}
                dot={false}
              />
            ))
          ) : (
            <Line
              type="monotone"
              dataKey={chartSuggestion.yKey}
              stroke={CHART_PALETTE[4]}
              strokeWidth={3}
              dot={false}
            />
          )}
        </LineChart>
      ) : (
        <BarChart data={chartSuggestion.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={chartSuggestion.xKey} stroke={AXIS_COLOR} />
          <YAxis stroke={AXIS_COLOR} tickFormatter={axisTickFormatter} />
          <Tooltip formatter={tooltipFormatter} />
          {chartSuggestion.series?.length ? <Legend /> : null}
          {chartSuggestion.series?.length ? (
            chartSuggestion.series.map((seriesKey, index) => (
              <Bar
                key={seriesKey}
                dataKey={seriesKey}
                fill={CHART_PALETTE[index % CHART_PALETTE.length]}
                radius={[8, 8, 0, 0]}
              />
            ))
          ) : (
            <Bar dataKey={chartSuggestion.yKey} fill={CHART_PALETTE[2]} radius={[8, 8, 0, 0]} />
          )}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
