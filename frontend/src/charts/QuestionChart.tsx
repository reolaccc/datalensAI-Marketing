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
  formatCategoryTickLabel,
  formatChartDateLabel,
  formatChartValue,
  getAxisLabel,
  getTimeSeriesAxisLabel,
  getTimeSeriesYearContext,
  humanizeLabel,
  isTimeSeriesChartAxis,
  shouldRotateTimeSeriesTicks
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
  const timeSeriesYearContext = isTimeSeriesChart ? getTimeSeriesYearContext(chartSuggestion.data, chartSuggestion.xKey) : null;
  const xAxisLabel = isTimeSeriesChart
    ? getTimeSeriesAxisLabel(chartSuggestion.xKey, chartSuggestion.xKey)
    : getAxisLabel(chartSuggestion.xKey, null);
  const yAxisLabel = getAxisLabel(metricLabel, dimensionLabel);
  const lineTicks = isTimeSeriesChart ? buildTimeSeriesTicks(chartSuggestion.data, chartSuggestion.xKey) : undefined;
  const shouldRotateLineTicks = isTimeSeriesChart ? shouldRotateTimeSeriesTicks(chartSuggestion.data, chartSuggestion.xKey) : false;
  const longestCategoryLabel = chartSuggestion.data.reduce((longest, entry) => {
    const label = humanizeLabel(String(entry[chartSuggestion.xKey] ?? ""));
    return Math.max(longest, label.length);
  }, 0);
  const shouldRotateCategoryTicks = chartSuggestion.chartType !== "line" && (longestCategoryLabel >= 14 || chartSuggestion.data.length >= 6);
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
        <LineChart data={chartSuggestion.data} margin={{ top: 10, right: 18, bottom: shouldRotateLineTicks ? 42 : 22, left: DEFAULT_LEFT_MARGIN }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey={chartSuggestion.xKey}
            ticks={lineTicks}
            interval={isTimeSeriesChart ? 0 : "preserveEnd"}
            stroke={AXIS_COLOR}
            tickFormatter={(value) => isTimeSeriesChart ? formatChartDateLabel(value, "axis", { includeYear: Boolean(timeSeriesYearContext?.includeYearInTicks) }) : humanizeLabel(String(value ?? ""))}
            angle={shouldRotateLineTicks ? -24 : 0}
            textAnchor={shouldRotateLineTicks ? "end" : "middle"}
            minTickGap={24}
            tickMargin={12}
            height={shouldRotateLineTicks ? 72 : 42}
            label={{ value: xAxisLabel, position: "insideBottom", offset: -2, ...LINE_AXIS_TITLE_STYLE }}
          />
          <YAxis stroke={AXIS_COLOR} width={DEFAULT_Y_AXIS_WIDTH} tickMargin={8} tickFormatter={(value) => formatChartValue(value, metricLabel)} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", dx: -6, ...LINE_AXIS_TITLE_STYLE }} />
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => isTimeSeriesChart ? formatChartDateLabel(label, "tooltip", { includeYear: Boolean(timeSeriesYearContext?.axisYearLabel) }) : humanizeLabel(String(label ?? ""))} />
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
        <BarChart data={chartSuggestion.data} margin={{ top: 10, right: 18, bottom: shouldRotateCategoryTicks ? 48 : 22, left: DEFAULT_LEFT_MARGIN }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey={chartSuggestion.xKey}
            stroke={AXIS_COLOR}
            tickFormatter={(value) => formatCategoryTickLabel(value, shouldRotateCategoryTicks ? 12 : 18)}
            interval={0}
            angle={shouldRotateCategoryTicks ? -24 : 0}
            textAnchor={shouldRotateCategoryTicks ? "end" : "middle"}
            tickMargin={12}
            height={shouldRotateCategoryTicks ? 68 : 42}
            label={{ value: xAxisLabel, position: "insideBottom", offset: -8, fill: AXIS_COLOR }}
          />
          <YAxis width={DEFAULT_Y_AXIS_WIDTH} tickMargin={8} stroke={AXIS_COLOR} tickFormatter={(value) => formatChartValue(value, metricLabel)} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", dx: -6, fill: AXIS_COLOR }} />
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
