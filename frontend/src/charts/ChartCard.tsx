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
import { AXIS_COLOR, GRID_COLOR, getChartColorForKey } from "./chartPalette";
import { buildChartLegendPayload, formatChartValue, getAxisLabel, humanizeLabel } from "./chartFormatting";
import { formatCompactNumber } from "../utils/numberFormatting";

interface Props {
  chart: AnalysisResponse["charts"][number];
  highlighted?: boolean;
}

function tooltipFormatter(value: unknown, name: unknown) {
  return [formatChartValue(value, String(name ?? "")), humanizeLabel(String(name ?? ""))];
}

export function ChartCard({ chart, highlighted = false }: Props) {
  const metricLabel = chart.metric ?? chart.yAxis ?? chart.yKey ?? null;
  const dimensionLabel = chart.dimension ?? chart.xAxis ?? chart.xKey ?? null;
  const isHistogram = chart.chartType === "histogram";
  const xAxisLabel = isHistogram
    ? getAxisLabel(chart.xAxis ?? chart.xKey, dimensionLabel)
    : getAxisLabel(
        chart.chartType === "horizontal_bar" ? chart.metric ?? chart.yAxis : chart.xAxis,
        chart.chartType === "horizontal_bar" ? null : dimensionLabel
      );
  const yAxisLabel = isHistogram ? getAxisLabel(chart.yAxis ?? chart.yKey, null) : getAxisLabel(metricLabel, dimensionLabel);
  const chartValueMetric = isHistogram ? chart.yKey : metricLabel;
  const legendPayload = buildChartLegendPayload(chart);

  function renderChart() {
    if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
      return (
        <LineChart data={chart.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={chart.xKey} stroke={AXIS_COLOR} label={{ value: xAxisLabel || "Date", position: "insideBottom", offset: -6, fill: AXIS_COLOR }} />
          <YAxis stroke={AXIS_COLOR} tickFormatter={(value) => formatChartValue(value, metricLabel)} label={{ value: yAxisLabel, angle: -90, position: "insideLeft", fill: AXIS_COLOR }} />
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => humanizeLabel(String(label ?? ""))} />
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
                  name={humanizeLabel(seriesKey)}
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
              name={humanizeLabel(chart.metric ?? chart.yKey ?? chart.title)}
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
        <BarChart data={chart.data} layout={chart.chartType === "horizontal_bar" ? "vertical" : "horizontal"}>
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
            dataKey={chart.chartType === "horizontal_bar" ? chart.xKey : undefined}
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
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => humanizeLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
          {chart.series?.length ? (
            chart.series.map((seriesKey, index) => (
              <Bar
                key={seriesKey}
                dataKey={seriesKey}
                name={humanizeLabel(seriesKey)}
                stackId={chart.chartType === "stacked_bar" ? "stack" : undefined}
                fill={getChartColorForKey(seriesKey)}
                radius={[8, 8, 0, 0]}
              />
            ))
          ) : (
            <Bar dataKey={chart.yKey!} name={humanizeLabel(chartValueMetric ?? chart.yKey ?? chart.title)} radius={[8, 8, 0, 0]}>
              {chart.data.map((_entry, index) => (
                <Cell
                  key={`${chart.id}-${index}`}
                  fill={getChartColorForKey(String(chart.data[index]?.[chart.xKey] ?? index))}
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
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => humanizeLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
          <Pie
            data={chart.data}
            dataKey={chart.yKey!}
            name={humanizeLabel(chart.metric ?? chart.yKey ?? chart.title)}
            nameKey={chart.xKey}
            innerRadius={56}
            outerRadius={92}
            paddingAngle={2}
          >
            {chart.data.map((_entry, index) => (
              <Cell key={`${chart.id}-${index}`} fill={getChartColorForKey(String(chart.data[index]?.[chart.xKey] ?? index))} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    if (chart.chartType === "funnel") {
      return (
        <FunnelChart>
          <Tooltip formatter={tooltipFormatter} labelFormatter={(label) => humanizeLabel(String(label ?? ""))} />
          {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
          <Funnel dataKey={chart.yKey!} name={humanizeLabel(chart.metric ?? chart.yKey ?? chart.title)} data={chart.data} isAnimationActive={false}>
            {chart.data.map((_entry, index) => (
              <Cell key={`${chart.id}-${index}`} fill={getChartColorForKey(String(chart.data[index]?.[chart.xKey] ?? index))} />
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
        <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={tooltipFormatter} labelFormatter={(label) => humanizeLabel(String(label ?? ""))} />
        {legendPayload.length ? <Legend payload={legendPayload as never} /> : null}
        <Scatter data={chart.data} name={humanizeLabel(chart.metric ?? chart.yKey ?? chart.title)} fill={getChartColorForKey(chart.id)} />
      </ScatterChart>
    );
  }

  return (
    <article className={`panel chart-card ${highlighted ? "chart-card-highlighted" : ""}`} id={`analysis-chart-${chart.id}`}>
      <div className="chart-header">
        <div className="chart-header-copy">
          <h3>{chart.title}</h3>
          {highlighted ? <span className="chart-tag">Relevant to this question</span> : null}
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

      <div className="chart-explanation-block">
        <p>{chart.description || chart.reason}</p>
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
    </article>
  );
}
