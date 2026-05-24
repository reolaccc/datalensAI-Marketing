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
import { AXIS_COLOR, CHART_PALETTE, GRID_COLOR } from "./chartPalette";

interface Props {
  chart: AnalysisResponse["charts"][number];
  highlighted?: boolean;
}

export function ChartCard({ chart, highlighted = false }: Props) {
  function renderChart() {
    if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
      return (
        <LineChart data={chart.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={chart.xKey} stroke={AXIS_COLOR} />
          <YAxis stroke={AXIS_COLOR} />
          <Tooltip />
          {chart.series?.length ? <Legend /> : null}
          {chart.series?.length ? (
            chart.series.map((seriesKey, index) =>
              seriesKey === "anomaly_marker" ? (
                <Scatter key={seriesKey} data={chart.data} dataKey={seriesKey} fill={CHART_PALETTE[0]} />
              ) : (
                <Line
                  key={seriesKey}
                  type="monotone"
                  dataKey={seriesKey}
                  stroke={CHART_PALETTE[index % CHART_PALETTE.length]}
                  strokeWidth={3}
                  dot={false}
                />
              )
            )
          ) : (
            <Line type="monotone" dataKey={chart.yKey!} stroke={CHART_PALETTE[4]} strokeWidth={3} dot={false} />
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
          />
          <YAxis
            dataKey={chart.chartType === "horizontal_bar" ? chart.xKey : undefined}
            type={chart.chartType === "horizontal_bar" ? "category" : "number"}
            stroke={AXIS_COLOR}
          />
          <Tooltip />
          {chart.series?.length ? <Legend /> : null}
          {chart.series?.length ? (
            chart.series.map((seriesKey, index) => (
              <Bar
                key={seriesKey}
                dataKey={seriesKey}
                stackId={chart.chartType === "stacked_bar" ? "stack" : undefined}
                fill={CHART_PALETTE[index % CHART_PALETTE.length]}
                radius={[8, 8, 0, 0]}
              />
            ))
          ) : (
            <Bar dataKey={chart.yKey!} radius={[8, 8, 0, 0]}>
              {chart.data.map((_entry, index) => (
                <Cell key={`${chart.id}-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
              ))}
            </Bar>
          )}
        </BarChart>
      );
    }

    if (chart.chartType === "donut") {
      return (
        <PieChart>
          <Tooltip />
          <Legend />
          <Pie
            data={chart.data}
            dataKey={chart.yKey!}
            nameKey={chart.xKey}
            innerRadius={56}
            outerRadius={92}
            paddingAngle={2}
          >
            {chart.data.map((_entry, index) => (
              <Cell key={`${chart.id}-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    if (chart.chartType === "funnel") {
      return (
        <FunnelChart>
          <Tooltip />
          <Funnel dataKey={chart.yKey!} data={chart.data} isAnimationActive={false}>
            {chart.data.map((_entry, index) => (
              <Cell key={`${chart.id}-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
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
          <strong>{String(value)}</strong>
        </div>
      );
    }

    return (
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey={chart.xKey} stroke={AXIS_COLOR} type="number" />
        <YAxis dataKey={chart.yKey!} stroke={AXIS_COLOR} type="number" />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={chart.data} fill={CHART_PALETTE[5]} />
      </ScatterChart>
    );
  }

  return (
      <article className={`panel chart-card ${highlighted ? "chart-card-highlighted" : ""}`} id={`analysis-chart-${chart.id}`}>
      <div className="chart-header">
        <div>
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
        <p>{chart.reason}</p>
      </div>
    </article>
  );
}
