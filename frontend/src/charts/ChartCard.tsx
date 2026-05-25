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
import { AXIS_COLOR, GRID_COLOR, getChartColorForKey, OTHER_CATEGORY_COLOR } from "./chartPalette";
import {
  buildChartLegendPayload,
  formatChartValue,
  getAxisLabel,
  getSemanticDisplayLabel,
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

function getPresentationData(chart: Props["chart"]) {
  const shouldCondense =
    (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "donut") &&
    !chart.series?.length &&
    chart.data.length > 8 &&
    chart.yKey;
  const categoryKey = chart.chartType === "horizontal_bar" ? chart.yKey ?? chart.xKey : chart.xKey;
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
  const barValueKey = chart.chartType === "horizontal_bar" ? valueKey : chart.yKey!;
  const presentationChart = { ...chart, data: chartData };
  const metricLabel = getSemanticDisplayLabel(chart.metric ?? chart.yAxis ?? chart.yKey ?? null);
  const dimensionLabel = getSemanticDisplayLabel(chart.dimension ?? chart.xAxis ?? chart.xKey ?? null);
  const isHistogram = chart.chartType === "histogram";
  const xAxisLabel = isHistogram
    ? getAxisLabel(chart.xAxis ?? chart.xKey, dimensionLabel)
    : getAxisLabel(
        chart.chartType === "horizontal_bar" ? chart.metric ?? chart.yAxis : chart.xAxis,
        chart.chartType === "horizontal_bar" ? null : dimensionLabel
      );
  const yAxisLabel = isHistogram ? getAxisLabel(chart.yAxis ?? chart.yKey, null) : getAxisLabel(metricLabel, dimensionLabel);
  const chartValueMetric = isHistogram ? chart.yKey : metricLabel;
  const legendPayload = buildChartLegendPayload(presentationChart);
  const chartTitle = getSemanticDisplayLabel(chart.title) || humanizeLabel(chart.title);
  const chartRole = formatChartRole(chart.analysisRole ?? null);
  const chartWhy = buildWhyThisChartText(chart) || getSemanticDisplayLabel(chart.description || chart.reason);

  function renderChart() {
    if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
      return (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={chart.xKey} stroke={AXIS_COLOR} label={{ value: xAxisLabel || "Date", position: "insideBottom", offset: -6, fill: AXIS_COLOR }} />
          <YAxis stroke={AXIS_COLOR} tickFormatter={(value) => formatChartValue(value, metricLabel)} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", fill: AXIS_COLOR }} />
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
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
              stroke={getChartColorForKey(chart.yKey)}
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
      return (
        <BarChart data={chartData} layout={chart.chartType === "horizontal_bar" ? "vertical" : "horizontal"}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey={chart.chartType === "horizontal_bar" ? undefined : chart.xKey}
            type={chart.chartType === "horizontal_bar" ? "number" : "category"}
            stroke={AXIS_COLOR}
            tickFormatter={chart.chartType === "horizontal_bar" ? (value) => formatChartValue(value, metricLabel) : undefined}
            label={{
              value: chart.chartType === "horizontal_bar" ? yAxisLabel : xAxisLabel || "Category",
              position: "insideBottom",
              offset: -6,
              fill: AXIS_COLOR
            }}
          />
          <YAxis
            dataKey={chart.chartType === "horizontal_bar" ? categoryKey : undefined}
            type={chart.chartType === "horizontal_bar" ? "category" : "number"}
            stroke={AXIS_COLOR}
            tickFormatter={chart.chartType !== "horizontal_bar" ? (value) => formatChartValue(value, chartValueMetric) : undefined}
            label={{
              value: chart.chartType === "horizontal_bar" ? chart.xAxis ?? "Category" : yAxisLabel,
              angle: -90,
              position: "insideLeft",
              fill: AXIS_COLOR
            }}
          />
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
          {chart.series?.length ? (
            chart.series.map((seriesKey, index) => (
              <Bar
                key={seriesKey}
                dataKey={seriesKey}
                name={getSemanticDisplayLabel(seriesKey)}
                stackId={chart.chartType === "stacked_bar" ? "stack" : undefined}
                fill={getChartColorForKey(seriesKey)}
                radius={[8, 8, 0, 0]}
              />
            ))
          ) : (
            <Bar dataKey={barValueKey} name={getSemanticDisplayLabel(chartValueMetric ?? chart.yKey ?? chart.title)} radius={[8, 8, 0, 0]}>
              {chartData.map((_entry, index) => (
                <Cell
                  key={`${chart.id}-${index}`}
                  fill={String(chartData[index]?.[categoryKey] ?? index) === "Other" ? OTHER_CATEGORY_COLOR : getChartColorForKey(String(chartData[index]?.[categoryKey] ?? index))}
                />
              ))}
            </Bar>
          )}
        </BarChart>
      );
    }

    if (chart.chartType === "donut") {
      return (
        <PieChart>
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
          <Pie
            data={chartData}
            dataKey={chart.yKey!}
            name={getSemanticDisplayLabel(chart.metric ?? chart.yKey ?? chart.title)}
            nameKey={chart.xKey}
            innerRadius={56}
            outerRadius={92}
            paddingAngle={2}
          >
            {chartData.map((_entry, index) => (
              <Cell key={`${chart.id}-${index}`} fill={String(chartData[index]?.[categoryKey] ?? index) === "Other" ? OTHER_CATEGORY_COLOR : getChartColorForKey(String(chartData[index]?.[categoryKey] ?? index))} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    if (chart.chartType === "funnel") {
      return (
        <FunnelChart>
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
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
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey={chart.xKey} stroke={AXIS_COLOR} type="number" tickFormatter={(value) => formatChartValue(value, chart.xKey)} label={{ value: getAxisLabel(chart.xKey), position: "insideBottom", offset: -6, fill: AXIS_COLOR }} />
        <YAxis dataKey={chart.yKey!} stroke={AXIS_COLOR} type="number" tickFormatter={(value) => formatChartValue(value, chart.yKey)} label={{ value: getAxisLabel(chart.yKey), angle: -90, position: "insideLeft", fill: AXIS_COLOR }} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={tooltipFormatter} labelFormatter={(label) => getSemanticDisplayLabel(String(label ?? ""))} />
        {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
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

      <div className="chart-frame">
        {chart.chartType === "kpi_card" ? (
          renderChart()
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>

      {!compact ? (
        <div className="chart-explanation-block">
          {chartWhy ? <p>{chartWhy}</p> : null}
          {chart.recommendations?.length ? (
            <div className="chart-recommendation-block">
              <span className="chart-recommendation-label">Next step</span>
              <ul>
                {chart.recommendations.slice(0, 2).map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
