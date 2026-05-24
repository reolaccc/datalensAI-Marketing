import type { ChartConfig, DatasetProfile, DatasetRow, KpiCandidate } from "../analytics/types.js";
import { parseDateValue, parseNumber } from "../utils/inference.js";

function buildHistogram(rows: DatasetRow[], column: string): ChartConfig | null {
  const values = rows
    .map((row) => parseNumber(row[column]))
    .filter((value): value is number => value !== null);

  if (values.length < 4) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const bucketCount = Math.min(8, Math.max(4, Math.round(Math.sqrt(values.length))));
  const step = (max - min) / bucketCount || 1;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    bucket: `${(min + index * step).toFixed(1)}-${(min + (index + 1) * step).toFixed(1)}`,
    count: 0
  }));

  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / step), bucketCount - 1);
    buckets[index].count += 1;
  }

  return {
    id: `histogram-${column}`,
    title: `${column} distribution`,
    chartType: "histogram",
    intent: "distribution",
    description: `Distribution of ${column} values.`,
    reason: `This distribution view shows how ${column} values are spread.`,
    whyThisChart: `It is a stable fallback chart for numeric distributions.`,
    xAxis: "bucket",
    yAxis: "count",
    metric: column,
    dimension: null,
    groupBy: null,
    sort: null,
    limit: bucketCount,
    filters: [],
    xKey: "bucket",
    yKey: "count",
    data: buckets
  };
}

function buildTimeSeries(rows: DatasetRow[], dateColumn: string, metricColumn: string): ChartConfig | null {
  const grouped = new Map<string, number>();

  for (const row of rows) {
    const date = parseDateValue(row[dateColumn]);
    const metric = parseNumber(row[metricColumn]);
    if (!date || metric === null) {
      continue;
    }

    const key = date.toISOString().slice(0, 10);
    grouped.set(key, (grouped.get(key) ?? 0) + metric);
  }

  if (grouped.size < 2) {
    return null;
  }

  return {
    id: `timeseries-${dateColumn}-${metricColumn}`,
    title: `${metricColumn} over time`,
    chartType: "line",
    intent: "general_overview",
    description: `Daily trend for ${metricColumn}.`,
    reason: `This chart shows the KPI trend over time.`,
    whyThisChart: `It is the most direct overview chart when a date field exists.`,
    xAxis: "date",
    yAxis: metricColumn,
    metric: metricColumn,
    dimension: null,
    groupBy: null,
    sort: null,
    limit: 0,
    filters: [],
    xKey: "date",
    yKey: metricColumn,
    data: [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({ date, [metricColumn]: Number(value.toFixed(2)) }))
  };
}

function buildCategoryComparison(rows: DatasetRow[], categoryColumn: string, metricColumn: string): ChartConfig | null {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const category = row[categoryColumn];
    const metric = parseNumber(row[metricColumn]);
    if (category === null || metric === null) {
      continue;
    }

    grouped.set(String(category), (grouped.get(String(category)) ?? 0) + metric);
  }

  if (grouped.size < 2) {
    return null;
  }

  return {
    id: `category-${categoryColumn}-${metricColumn}`,
    title: `${metricColumn} by ${categoryColumn}`,
    chartType: "bar",
    intent: "comparison",
    description: `Category comparison for ${metricColumn}.`,
    reason: `This compares the metric across the strongest categorical dimension.`,
    whyThisChart: `It is a reliable fallback segment chart for overview analysis.`,
    xAxis: categoryColumn,
    yAxis: metricColumn,
    metric: metricColumn,
    dimension: categoryColumn,
    groupBy: null,
    sort: "desc",
    limit: 8,
    filters: [],
    xKey: categoryColumn,
    yKey: metricColumn,
    data: [...grouped.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([category, value]) => ({ [categoryColumn]: category, [metricColumn]: Number(value.toFixed(2)) }))
  };
}

function buildCorrelationScatter(rows: DatasetRow[], xColumn: string, yColumn: string): ChartConfig | null {
  const data = rows
    .map((row) => ({
      [xColumn]: parseNumber(row[xColumn]),
      [yColumn]: parseNumber(row[yColumn])
    }))
    .filter(
      (row): row is Record<string, number> =>
        typeof row[xColumn] === "number" && typeof row[yColumn] === "number"
    )
    .slice(0, 120);

  if (data.length < 3) {
    return null;
  }

  return {
    id: `scatter-${xColumn}-${yColumn}`,
    title: `${xColumn} vs ${yColumn}`,
    chartType: "scatter",
    intent: "correlation",
    description: `Scatter plot for correlated metrics.`,
    reason: `This shows the relationship between two numeric fields.`,
    whyThisChart: `It is a useful diagnostic chart when strong correlation is detected.`,
    xAxis: xColumn,
    yAxis: yColumn,
    metric: yColumn,
    dimension: null,
    groupBy: null,
    sort: null,
    limit: 120,
    filters: [],
    xKey: xColumn,
    yKey: yColumn,
    data
  };
}

export function recommendCharts(
  rows: DatasetRow[],
  profile: DatasetProfile,
  kpis: KpiCandidate[]
): ChartConfig[] {
  const charts: ChartConfig[] = [];
  const primaryKpi = kpis[0]?.column ?? profile.numericColumns[0];

  if (profile.datetimeColumns[0] && primaryKpi) {
    const chart = buildTimeSeries(rows, profile.datetimeColumns[0], primaryKpi);
    if (chart) {
      charts.push(chart);
    }
  }

  if (profile.categoricalColumns[0] && primaryKpi) {
    const chart = buildCategoryComparison(rows, profile.categoricalColumns[0], primaryKpi);
    if (chart) {
      charts.push(chart);
    }
  }

  if (profile.numericColumns[0]) {
    const chart = buildHistogram(rows, profile.numericColumns[0]);
    if (chart) {
      charts.push(chart);
    }
  }

  const strongestCorrelation = profile.correlations[0];
  if (strongestCorrelation) {
    const chart = buildCorrelationScatter(rows, strongestCorrelation.x, strongestCorrelation.y);
    if (chart) {
      charts.push(chart);
    }
  }

  return charts.slice(0, 4);
}
