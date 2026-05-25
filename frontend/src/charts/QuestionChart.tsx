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
import { AXIS_COLOR, GRID_COLOR, getChartColorForKey } from "./chartPalette";
import { buildChartLegendPayload, formatChartValue, getAxisLabel, humanizeLabel } from "./chartFormatting";

interface Props {
  chartSuggestion: NonNullable<QuestionAnswer["chartSuggestion"]>;
  height?: number;
}

function tooltipFormatter(value: unknown, name: unknown) {
  return [formatChartValue(value, String(name ?? "")), humanizeLabel(String(name ?? ""))];
}

export function QuestionChart({ chartSuggestion, height = 240 }: Props) {
  const metricLabel = chartSuggestion.yKey ?? chartSuggestion.series?.[0] ?? null;
  const dimensionLabel = chartSuggestion.xKey ?? null;
  const xAxisLabel = getAxisLabel(chartSuggestion.xKey, null);
  const yAxisLabel = getAxisLabel(metricLabel, dimensionLabel);
  const legendPayload = buildChartLegendPayload({
    chartType: chartSuggestion.chartType,
    data: chartSuggestion.data,
    xKey: chartSuggestion.xKey,
    yKey: chartSuggestion.yKey,
    series: chartSuggestion.series,
    metric: chartSuggestion.yKey,
    title: chartSuggestion.yKey
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      {chartSuggestion.chartType === "line" ? (
        <LineChart data={chartSuggestion.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={chartSuggestion.xKey} stroke={AXIS_COLOR} label={{ value: xAxisLabel, position: "insideBottom", offset: -6, fill: AXIS_COLOR }} />
          <YAxis stroke={AXIS_COLOR} tickFormatter={(value) => formatChartValue(value, metricLabel)} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", fill: AXIS_COLOR }} />
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => humanizeLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
          {chartSuggestion.series?.length ? (
            chartSuggestion.series.map((seriesKey) => (
              <Line
                key={seriesKey}
                type="monotone"
                dataKey={seriesKey}
                name={humanizeLabel(seriesKey)}
                stroke={getChartColorForKey(seriesKey)}
                strokeWidth={3}
                dot={false}
              />
            ))
          ) : (
            <Line
              type="monotone"
              dataKey={chartSuggestion.yKey}
              name={humanizeLabel(chartSuggestion.yKey)}
              stroke={getChartColorForKey(chartSuggestion.yKey)}
              strokeWidth={3}
              dot={false}
            />
          )}
        </LineChart>
      ) : (
        <BarChart data={chartSuggestion.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={chartSuggestion.xKey} stroke={AXIS_COLOR} label={{ value: xAxisLabel, position: "insideBottom", offset: -6, fill: AXIS_COLOR }} />
          <YAxis stroke={AXIS_COLOR} tickFormatter={(value) => formatChartValue(value, metricLabel)} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", fill: AXIS_COLOR }} />
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => humanizeLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
          {chartSuggestion.series?.length ? (
            chartSuggestion.series.map((seriesKey) => (
              <Bar
                key={seriesKey}
                dataKey={seriesKey}
                name={humanizeLabel(seriesKey)}
                fill={getChartColorForKey(seriesKey)}
                radius={[8, 8, 0, 0]}
              />
            ))
          ) : (
            <Bar dataKey={chartSuggestion.yKey} name={humanizeLabel(chartSuggestion.yKey)} fill={getChartColorForKey(chartSuggestion.yKey)} radius={[8, 8, 0, 0]} />
          )}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
