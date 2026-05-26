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
import { AXIS_COLOR, GRID_COLOR, getChartColorForKey, SINGLE_SERIES_COMPARISON_COLOR } from "./chartPalette";
import {
  buildChartLegendPayload,
  buildTimeSeriesTicks,
  formatChartDateLabel,
  formatChartValue,
  getAxisLabel,
  getTimeSeriesAxisLabel,
  humanizeLabel,
  isTimeSeriesChartAxis
} from "./chartFormatting";

const LINE_AXIS_TITLE_STYLE = {
  fill: AXIS_COLOR,
  fontSize: 12
} as const;

const DEFAULT_LEFT_MARGIN = 24;
const DEFAULT_Y_AXIS_WIDTH = 78;

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
  const isTimeSeriesChart =
    chartSuggestion.chartType === "line" &&
    isTimeSeriesChartAxis(chartSuggestion.xKey, chartSuggestion.xKey);
  const xAxisLabel = isTimeSeriesChart ? getTimeSeriesAxisLabel(chartSuggestion.xKey, chartSuggestion.xKey) : getAxisLabel(chartSuggestion.xKey, null);
  const yAxisLabel = getAxisLabel(metricLabel, dimensionLabel);
  const lineTicks = isTimeSeriesChart ? buildTimeSeriesTicks(chartSuggestion.data, chartSuggestion.xKey) : undefined;
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
        <LineChart data={chartSuggestion.data} margin={{ top: 10, right: 18, bottom: 18, left: DEFAULT_LEFT_MARGIN }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey={chartSuggestion.xKey}
            ticks={lineTicks}
            interval={isTimeSeriesChart ? 0 : "preserveEnd"}
            stroke={AXIS_COLOR}
            tickFormatter={(value) => isTimeSeriesChart ? formatChartDateLabel(value, "axis") : humanizeLabel(String(value ?? ""))}
            minTickGap={24}
            tickMargin={12}
            height={42}
            label={{ value: xAxisLabel, position: "insideBottom", offset: -2, ...LINE_AXIS_TITLE_STYLE }}
          />
          <YAxis stroke={AXIS_COLOR} width={DEFAULT_Y_AXIS_WIDTH} tickMargin={8} tickFormatter={(value) => formatChartValue(value, metricLabel)} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", dx: -6, ...LINE_AXIS_TITLE_STYLE }} />
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => isTimeSeriesChart ? formatChartDateLabel(label, "tooltip") : humanizeLabel(String(label ?? ""))} />
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
              stroke={SINGLE_SERIES_COMPARISON_COLOR}
              strokeWidth={3}
              dot={false}
            />
          )}
        </LineChart>
      ) : (
        <BarChart data={chartSuggestion.data} margin={{ top: 10, right: 18, bottom: 18, left: DEFAULT_LEFT_MARGIN }}>
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
