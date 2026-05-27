import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { AnalysisResponse } from "../types";
import {
  AXIS_COLOR,
  GRID_COLOR,
  getChartColorForKey,
  getCompositionColor,
  OTHER_CATEGORY_COLOR,
  SINGLE_SERIES_COMPARISON_COLOR
} from "./chartPalette";
import {
  buildChartLegendPayload,
  buildTimeSeriesTicks,
  formatCategoryTickLabel,
  formatChartDateLabel,
  formatChartValue,
  formatHistogramAxisLabel,
  formatHistogramRangeLabel,
  getAxisLabel,
  getSemanticDisplayLabel,
  getTimeSeriesAxisLabel,
  getTimeSeriesYearContext,
  isTimeSeriesChartAxis,
  humanizeLabel
} from "./chartFormatting";
import { formatCompactNumber } from "../utils/numberFormatting";

interface Props {
  chart: AnalysisResponse["charts"][number];
  highlighted?: boolean;
  compact?: boolean;
}

function tooltipFormatter(value: unknown, name: unknown) {
  const label = getSemanticDisplayLabel(String(name ?? ""));
  return [formatChartValue(value, String(name ?? ""), "tooltip"), label || humanizeLabel(String(name ?? ""))];
}

function getLongestCategoryLabel(data: Props["chart"]["data"], key?: string | null) {
  if (!key) {
    return 0;
  }

  return data.reduce((longest, entry) => {
    const label = getSemanticDisplayLabel(String(entry[key] ?? ""));
    return Math.max(longest, label.length);
  }, 0);
}

const LINE_AXIS_TITLE_STYLE = {
  fill: AXIS_COLOR,
  fontSize: 12
} as const;

const DEFAULT_LEFT_MARGIN = 24;
const WIDE_LEFT_MARGIN = 32;
const DEFAULT_Y_AXIS_WIDTH = 78;

function getBarThickness(chart: Props["chart"], dataLength: number) {
  if (chart.chartType === "horizontal_bar") {
    return dataLength > 8 ? 10 : 12;
  }

  if (chart.chartType === "stacked_bar") {
    return dataLength > 8 ? 16 : 20;
  }

  return dataLength > 8 ? 18 : 22;
}

function formatChartRole(role?: string | null) {
  if (!role) {
    return "";
  }

  switch (role) {
    case "trend":
      return "Trend";
    case "comparison":
      return "Comparison";
    case "composition":
      return "Composition";
    case "relationship":
      return "Relationship";
    case "efficiency":
      return "Efficiency";
    case "funnel":
      return "Funnel";
    case "distribution":
      return "Distribution";
    case "anomaly":
      return "Anomaly";
    default:
      return humanizeLabel(role);
  }
}

function buildWhyThisChartText(chart: Props["chart"]) {
  const question = getSemanticDisplayLabel(chart.businessQuestionAnswered ?? "");
  const reason = getSemanticDisplayLabel(chart.whyThisChart ?? chart.reason ?? "");
  const summary = question || reason;
  if (!summary) {
    return "";
  }

  const cleaned = summary.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }

  return cleaned.endsWith(".") ? cleaned : `${cleaned}.`;
}

function buildChartInsightText(chart: Props["chart"]) {
  const subtitle = getSemanticDisplayLabel(chart.subtitle ?? "");
  if (subtitle) {
    const cleanedSubtitle = subtitle.replace(/\s+/g, " ").trim();
    return cleanedSubtitle.endsWith(".") ? cleanedSubtitle : `${cleanedSubtitle}.`;
  }

  const description = getSemanticDisplayLabel(chart.description ?? "");
  if (description) {
    const cleanedDescription = description.replace(/\s+/g, " ").trim();
    return cleanedDescription.endsWith(".") ? cleanedDescription : `${cleanedDescription}.`;
  }

  return buildWhyThisChartText(chart) || getSemanticDisplayLabel(chart.reason ?? "");
}

function getPresentationData(chart: Props["chart"]) {
  const shouldCondense =
    (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "donut") &&
    !chart.series?.length &&
    chart.data.length > 8 &&
    chart.yKey;
  const categoryKey = chart.chartType === "horizontal_bar" ? chart.yKey! : chart.xKey;
  const valueKey = chart.chartType === "horizontal_bar" ? chart.xKey : chart.yKey!;

  if (!shouldCondense) {
    return { data: chart.data, categoryKey, valueKey };
  }

  const ranked = [...chart.data]
    .map((entry) => ({
      entry,
      value: typeof entry[valueKey] === "number" ? entry[valueKey] : Number(entry[valueKey] ?? 0)
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => right.value - left.value);

  if (ranked.length <= 8) {
    return { data: chart.data, categoryKey, valueKey };
  }

  const topEntries = ranked.slice(0, 7).map(({ entry }) => entry);
  const otherTotal = ranked.slice(7).reduce((sum, item) => sum + item.value, 0);
  const otherEntry: Record<string, string | number | boolean | null> = {
    [categoryKey]: "Other",
    [valueKey]: Number(otherTotal.toFixed(2))
  };

  return { data: [...topEntries, otherEntry], categoryKey, valueKey };
}

export function ChartCard({ chart, highlighted = false, compact = false }: Props) {
  const presentation = getPresentationData(chart);
  const chartData = presentation.data;
  const categoryKey = presentation.categoryKey;
  const valueKey = presentation.valueKey;
  const barValueKey = valueKey;
  const presentationChart = { ...chart, data: chartData };
  const metricLabel = getSemanticDisplayLabel(chart.metric ?? chart.yAxis ?? chart.yKey ?? null);
  const dimensionLabel = getSemanticDisplayLabel(chart.dimension ?? chart.xAxis ?? chart.xKey ?? null);
  const isHistogram = chart.chartType === "histogram";
  const isTimeSeriesChart =
    (chart.chartType === "line" || chart.chartType === "anomaly_trend") &&
    isTimeSeriesChartAxis(chart.xAxis ?? chart.dimension ?? chart.xKey, chart.xKey);
  const timeSeriesYearContext = isTimeSeriesChart ? getTimeSeriesYearContext(chartData, chart.xKey) : null;
  const xAxisLabel = isHistogram
    ? getAxisLabel(chart.xAxis ?? chart.xKey, dimensionLabel)
    : isTimeSeriesChart
      ? getTimeSeriesAxisLabel(chart.xAxis ?? chart.dimension ?? chart.xKey, chart.xKey, timeSeriesYearContext?.axisYearLabel)
      : chart.chartType === "horizontal_bar"
        ? getAxisLabel(chart.metric ?? chart.yAxis ?? chart.yKey, null)
        : getAxisLabel(chart.xAxis ?? chart.xKey, dimensionLabel);
  const yAxisLabel = isHistogram
    ? getAxisLabel(chart.yAxis ?? chart.yKey, null)
    : chart.chartType === "horizontal_bar"
      ? getAxisLabel(chart.dimension ?? chart.xAxis ?? chart.xKey, dimensionLabel)
      : getAxisLabel(metricLabel, dimensionLabel);
  const chartValueMetric = isHistogram ? chart.yKey : metricLabel;
  const legendPayload = buildChartLegendPayload(presentationChart);
  const chartTitle = getSemanticDisplayLabel(chart.title) || humanizeLabel(chart.title);
  const chartRole = formatChartRole(chart.analysisRole ?? null);
  const chartInsight = buildChartInsightText(chart);
  const longestCategoryLabel = getLongestCategoryLabel(chartData, categoryKey);
  const hasLongCategoryLabels = longestCategoryLabel >= 14;
  const hasManyCategoryLabels = chartData.length >= 6;
  const shouldRotateCategoryTicks = chart.chartType === "bar" && (hasLongCategoryLabels || hasManyCategoryLabels);
  const shouldRotateHistogramTicks = isHistogram && chartData.length >= 4;
  const histogramTickInterval = chartData.length >= 6 ? "preserveStartEnd" : 0;
  const shouldShowLegend = legendPayload.length > 0;
  const shouldHideVerticalCategoryAxisLabel =
    chart.chartType === "bar" &&
    !chart.series?.length &&
    !isHistogram;
  const shouldHideHorizontalCategoryAxisLabel =
    chart.chartType === "horizontal_bar" &&
    !chart.series?.length;
  const hasRenderableCategoryData =
    !isHistogram &&
    (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "stacked_bar")
      ? chartData.some((entry) => {
          const categoryValue = entry[categoryKey];
          const metricValue = entry[valueKey];
          return String(categoryValue ?? "").trim() && typeof metricValue === "number" && Number.isFinite(metricValue);
        })
      : true;
  const lineTicks =
    isTimeSeriesChart
      ? buildTimeSeriesTicks(chartData, chart.xKey)
      : undefined;
  const barThickness = getBarThickness(chart, chartData.length);
  const chartHeight = compact
    ? 224
    : chart.chartType === "donut"
      ? 296
      : chart.chartType === "funnel"
        ? 272
      : isHistogram
        ? 268
        : isTimeSeriesChart
          ? 272
          : chart.chartType === "horizontal_bar"
            ? 264
            : chart.chartType === "bar" || chart.chartType === "stacked_bar"
              ? 252
              : 248;

  function renderTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: unknown; name?: unknown; payload?: Record<string, string | number | boolean | null> }>; label?: unknown }) {
    if (!active || !payload?.length) {
      return null;
    }

    if (chart.chartType === "histogram") {
      const entry = payload[0]?.payload;
      if (!entry) {
        return null;
      }
      const rangeLabel = formatHistogramRangeLabel(entry);
      const count = typeof entry.count === "number" ? entry.count : Number(entry.count ?? 0);
      const share = typeof entry.share === "number" ? entry.share : Number(entry.share ?? 0);
      return (
        <div className="chart-tooltip">
          <p className="chart-tooltip-title">{rangeLabel}</p>
          <p>Count: {formatChartValue(count, "count", "tooltip")}</p>
          {Number.isFinite(share) ? <p>Share of records: {formatChartValue(share, "percent", "tooltip")}</p> : null}
        </div>
      );
    }

    const formattedLabel =
      isTimeSeriesChart
        ? formatChartDateLabel(label, "tooltip", { includeYear: Boolean(timeSeriesYearContext?.axisYearLabel) })
        : getSemanticDisplayLabel(String(label ?? "")) || String(label ?? "");
    const primaryEntry = payload[0];
    const primaryMetricValue = typeof primaryEntry?.value === "number" ? primaryEntry.value : Number(primaryEntry?.value ?? NaN);
    const shouldShowShare =
      !chart.series?.length &&
      (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "donut" || chart.chartType === "funnel") &&
      Number.isFinite(primaryMetricValue);
    const totalMetricValue = shouldShowShare
      ? chartData.reduce((sum, entry) => sum + (typeof entry[valueKey] === "number" ? entry[valueKey] : Number(entry[valueKey] ?? 0)), 0)
      : 0;
    const shareValue = shouldShowShare && totalMetricValue > 0 ? primaryMetricValue / totalMetricValue : null;

    return (
      <div className="chart-tooltip">
        {formattedLabel ? <p className="chart-tooltip-title">{formattedLabel}</p> : null}
        {payload.map((entry, index) => {
          const metricName = String(entry.name ?? "");
          const semanticLabel = getSemanticDisplayLabel(metricName) || humanizeLabel(metricName);
          return (
            <p key={`${metricName}-${index}`}>
              {semanticLabel}: {formatChartValue(entry.value, metricName, "tooltip")}
            </p>
          );
        })}
        {shareValue !== null ? <p>Share: {formatChartValue(shareValue, "percent", "tooltip")}</p> : null}
      </div>
    );
  }

  function renderChart() {
    if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
      return (
        <LineChart data={chartData} margin={{ top: 10, right: 18, bottom: 18, left: WIDE_LEFT_MARGIN }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey={chart.xKey}
            ticks={lineTicks}
            interval={isTimeSeriesChart ? 0 : "preserveEnd"}
            stroke={AXIS_COLOR}
            tickFormatter={(value) => isTimeSeriesChart ? formatChartDateLabel(value, "axis", { includeYear: Boolean(timeSeriesYearContext?.includeYearInTicks) }) : getSemanticDisplayLabel(String(value ?? "")) || String(value ?? "")}
            minTickGap={24}
            tickMargin={14}
            height={timeSeriesYearContext?.includeYearInTicks ? 58 : 48}
            label={{ value: xAxisLabel || (isTimeSeriesChart ? "Date (Daily)" : "Category"), position: "insideBottom", offset: -8, ...LINE_AXIS_TITLE_STYLE }}
          />
          <YAxis stroke={AXIS_COLOR} width={DEFAULT_Y_AXIS_WIDTH} tickFormatter={(value) => formatChartValue(value, metricLabel)} tickMargin={10} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", dx: -8, ...LINE_AXIS_TITLE_STYLE }} />
          <Tooltip content={renderTooltipContent} />
          {shouldShowLegend ? (
            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ top: 2, right: 8, left: "auto", width: "auto", paddingBottom: 6 }}
              payload={legendPayload as never}
            />
          ) : null}
          {chart.series?.length ? (
            chart.series.map((seriesKey, index) =>
              seriesKey === "anomaly_marker" ? (
                <Scatter
                  key={seriesKey}
                  data={chart.data}
                  dataKey={seriesKey}
                  name={humanizeLabel(seriesKey)}
                  fill={getChartColorForKey(seriesKey)}
                />
              ) : (
                <Line
                  key={seriesKey}
                  type="monotone"
                  dataKey={seriesKey}
                  name={getSemanticDisplayLabel(seriesKey)}
                  stroke={getChartColorForKey(seriesKey)}
                  strokeWidth={3}
                  dot={false}
                />
              )
            )
          ) : (
            <Line
              type="monotone"
              dataKey={chart.yKey!}
              name={getSemanticDisplayLabel(chart.metric ?? chart.yKey ?? chart.title)}
              stroke={SINGLE_SERIES_COMPARISON_COLOR}
              strokeWidth={3}
              dot={false}
            />
          )}
        </LineChart>
      );
    }

    if (
      chart.chartType === "bar" ||
      chart.chartType === "histogram" ||
      chart.chartType === "horizontal_bar" ||
      chart.chartType === "stacked_bar"
    ) {
      if (!hasRenderableCategoryData) {
        return <div className="chart-empty-state">Chart data is available but could not be rendered clearly.</div>;
      }

      return (
        <BarChart
          data={chartData}
          layout={chart.chartType === "horizontal_bar" ? "vertical" : "horizontal"}
          barCategoryGap={chart.chartType === "horizontal_bar" ? "34%" : "30%"}
          barGap={8}
          margin={{ top: 10, right: 18, bottom: isHistogram ? 48 : shouldRotateCategoryTicks ? 50 : 24, left: chart.chartType === "horizontal_bar" ? WIDE_LEFT_MARGIN : DEFAULT_LEFT_MARGIN }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey={chart.chartType === "horizontal_bar" ? undefined : isHistogram ? "bucketLabel" : categoryKey}
            type={chart.chartType === "horizontal_bar" ? "number" : "category"}
            domain={chart.chartType === "horizontal_bar" ? [0, "auto"] : undefined}
            stroke={AXIS_COLOR}
            tickFormatter={
              chart.chartType === "horizontal_bar"
                ? (value) => formatChartValue(value, metricLabel)
                : isHistogram
                  ? (_value, index) => formatHistogramAxisLabel(chartData[index], chart.metric ?? chart.xAxis ?? chart.xKey)
                  : (value) => formatCategoryTickLabel(value, shouldRotateCategoryTicks ? 12 : 18)
            }
            interval={chart.chartType === "horizontal_bar" ? undefined : isHistogram ? histogramTickInterval : 0}
            angle={shouldRotateHistogramTicks ? -22 : shouldRotateCategoryTicks ? -24 : 0}
            textAnchor={shouldRotateHistogramTicks || shouldRotateCategoryTicks ? "end" : "middle"}
            minTickGap={12}
            tickMargin={14}
            height={shouldRotateHistogramTicks ? 72 : shouldRotateCategoryTicks ? 70 : 44}
            label={{
              value:
                chart.chartType === "horizontal_bar"
                  ? xAxisLabel
                  : shouldHideVerticalCategoryAxisLabel
                    ? ""
                    : xAxisLabel || (isHistogram ? "Value Range" : "Category"),
              position: "insideBottom",
              offset: -8,
              fill: AXIS_COLOR
            }}
          />
          <YAxis
            dataKey={chart.chartType === "horizontal_bar" ? categoryKey : undefined}
            type={chart.chartType === "horizontal_bar" ? "category" : "number"}
            domain={chart.chartType === "horizontal_bar" ? undefined : [0, "auto"]}
            stroke={AXIS_COLOR}
            width={chart.chartType === "horizontal_bar" ? (hasLongCategoryLabels ? 124 : 100) : DEFAULT_Y_AXIS_WIDTH}
            tickFormatter={chart.chartType !== "horizontal_bar" ? (value) => formatChartValue(value, chartValueMetric) : (value) => formatCategoryTickLabel(value, 18)}
            tickMargin={10}
            label={{
              value: shouldHideHorizontalCategoryAxisLabel ? "" : yAxisLabel,
              angle: -90,
              position: "insideLeft",
              fill: AXIS_COLOR,
              dx: -8
            }}
          />
          <Tooltip content={renderTooltipContent} formatter={tooltipFormatter} labelFormatter={(label) => isHistogram ? String(label ?? "") : getSemanticDisplayLabel(String(label ?? ""))} />
          {shouldShowLegend ? <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: 6 }} payload={legendPayload as never} /> : null}
          {chart.series?.length ? (
            chart.series.map((seriesKey, index) => (
              <Bar
                key={seriesKey}
                dataKey={seriesKey}
                name={getSemanticDisplayLabel(seriesKey)}
                stackId={chart.chartType === "stacked_bar" ? "stack" : undefined}
                fill={getChartColorForKey(seriesKey)}
                maxBarSize={barThickness}
                radius={[8, 8, 0, 0]}
              />
            ))
          ) : (
            <Bar
              dataKey={barValueKey}
              name={getSemanticDisplayLabel(chartValueMetric ?? chart.yKey ?? chart.title)}
              maxBarSize={barThickness}
              radius={[8, 8, 0, 0]}
            >
              {chartData.map((_entry, index) => (
              <Cell
                  key={`${chart.id}-${index}`}
                  fill={
                    isHistogram
                      ? SINGLE_SERIES_COMPARISON_COLOR
                      : !chart.series?.length && (chart.chartType === "bar" || chart.chartType === "horizontal_bar")
                        ? SINGLE_SERIES_COMPARISON_COLOR
                      : String(chartData[index]?.[categoryKey] ?? index) === "Other"
                        ? OTHER_CATEGORY_COLOR
                        : getChartColorForKey(String(chartData[index]?.[categoryKey] ?? index))
                  }
                />
              ))}
            </Bar>
          )}
        </BarChart>
      );
    }

    if (chart.chartType === "donut") {
      return (
        <PieChart margin={{ top: 20, right: 12, bottom: shouldShowLegend ? 48 : 14, left: 12 }}>
          <Tooltip content={renderTooltipContent} formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
          {shouldShowLegend ? <Legend verticalAlign="bottom" align="center" iconSize={8} wrapperStyle={{ paddingTop: 6 }} payload={legendPayload.map((entry) => ({ ...entry, value: formatCategoryTickLabel(entry.value, 18) })) as never} /> : null}
          <Pie
            data={chartData}
            dataKey={chart.yKey!}
            name={getSemanticDisplayLabel(chart.metric ?? chart.yKey ?? chart.title)}
            nameKey={chart.xKey}
            innerRadius={39}
            outerRadius={86}
            cy={shouldShowLegend ? "46%" : "52%"}
            paddingAngle={3}
            stroke="rgba(9, 23, 24, 0.92)"
            strokeWidth={2}
          >
            {chartData.map((_entry, index) => (
              <Cell key={`${chart.id}-${index}`} fill={String(chartData[index]?.[categoryKey] ?? index) === "Other" ? OTHER_CATEGORY_COLOR : getCompositionColor(index, String(chartData[index]?.[categoryKey] ?? index))} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    if (chart.chartType === "funnel") {
      return (
        <FunnelChart>
          <Tooltip content={renderTooltipContent} formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
          {shouldShowLegend ? <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: 6 }} payload={legendPayload as never} /> : null}
          <Funnel dataKey={chart.yKey!} name={getSemanticDisplayLabel(chart.metric ?? chart.yKey ?? chart.title)} data={chartData} isAnimationActive={false}>
            {chartData.map((_entry, index) => (
              <Cell key={`${chart.id}-${index}`} fill={getChartColorForKey(String(chartData[index]?.[categoryKey] ?? index))} />
            ))}
          </Funnel>
        </FunnelChart>
      );
    }

    if (chart.chartType === "kpi_card") {
      const value = chart.data[0]?.value ?? chart.data[0]?.[chart.yKey ?? "value"] ?? "N/A";
      return (
        <div className="chart-kpi-card">
          <span>{chart.metric ?? chart.title}</span>
          <strong>{typeof value === "number" ? formatCompactNumber(value) : String(value)}</strong>
        </div>
      );
    }

    return (
      <ScatterChart margin={{ top: 10, right: 18, bottom: 22, left: DEFAULT_LEFT_MARGIN }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey={chart.xKey} stroke={AXIS_COLOR} type="number" tickMargin={14} height={40} tickFormatter={(value) => formatChartValue(value, chart.xKey)} label={{ value: getAxisLabel(chart.xKey), position: "insideBottom", offset: -8, fill: AXIS_COLOR }} />
        <YAxis dataKey={chart.yKey!} stroke={AXIS_COLOR} type="number" width={DEFAULT_Y_AXIS_WIDTH} tickMargin={10} tickFormatter={(value) => formatChartValue(value, chart.yKey)} label={{ value: getAxisLabel(chart.yKey), angle: -90, position: "insideLeft", fill: AXIS_COLOR, dx: -8 }} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} content={renderTooltipContent} formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
        {shouldShowLegend ? <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: 6 }} payload={legendPayload as never} /> : null}
        <Scatter data={chartData} name={getSemanticDisplayLabel(chart.metric ?? chart.yKey ?? chart.title)} fill={getChartColorForKey(chart.id)} />
      </ScatterChart>
    );
  }

  return (
    <article className={`panel chart-card ${highlighted ? "chart-card-highlighted" : ""}`} id={`analysis-chart-${chart.id}`}>
      <div className="chart-header">
        <div className="chart-header-copy">
          <h3>{chartTitle}</h3>
          {!compact && highlighted ? <span className="chart-tag">Relevant to this question</span> : null}
          {!compact && chartRole ? <span className="chart-tag">{chartRole}</span> : null}
        </div>
      </div>

      <div className="chart-frame" style={{ height: `${chartHeight}px` }}>
        {chart.chartType === "kpi_card" ? (
          renderChart()
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>

      {!compact ? (
        <div className="chart-explanation-block">
          {chartInsight ? <p>{chartInsight}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
