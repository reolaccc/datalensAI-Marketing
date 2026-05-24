import type { ChartConfig, DatasetCapabilities, DatasetRow, PrimitiveValue } from "../../../analytics/types.js";
import { parseDateValue, parseNumber } from "../../../utils/inference.js";

type Filter = ChartConfig["filters"][number];

function applyFilter(row: DatasetRow, filter: Filter) {
  const value = row[filter.column];
  if (filter.operator === "eq") {
    return String(value ?? "") === String(filter.value);
  }

  if (filter.operator === "after" || filter.operator === "before") {
    const left = parseDateValue(value);
    const right = parseDateValue(filter.value as PrimitiveValue);
    if (!left || !right) {
      return false;
    }
    return filter.operator === "after" ? left > right : left < right;
  }

  const left = parseNumber(value);
  const right = typeof filter.value === "number" ? filter.value : Number(filter.value);
  if (left === null || !Number.isFinite(right)) {
    return false;
  }

  switch (filter.operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return false;
  }
}

export function filterRows(rows: DatasetRow[], filters: Filter[] = []) {
  if (filters.length === 0) {
    return rows;
  }

  return rows.filter((row) => filters.every((filter) => applyFilter(row, filter)));
}

export function resolveMetricValue(
  row: DatasetRow,
  metric: string,
  capabilities: DatasetCapabilities
): number | null {
  const directValue = parseNumber(row[metric]);
  if (directValue !== null) {
    return directValue;
  }

  if (metric === "roi" && capabilities.derivedMetrics.includes("roi")) {
    const revenue = parseNumber(row.revenue);
    const cost = parseNumber(row.cost);
    if (revenue === null || cost === null || cost === 0) {
      return null;
    }
    return Number((((revenue - cost) / cost) * 100).toFixed(2));
  }

  if (metric === "roas" && capabilities.derivedMetrics.includes("roas")) {
    const revenue = parseNumber(row.revenue);
    const cost = parseNumber(row.cost);
    if (revenue === null || cost === null || cost === 0) {
      return null;
    }
    return Number((revenue / cost).toFixed(2));
  }

  if (metric === "conversion_rate" && capabilities.derivedMetrics.includes("conversion_rate")) {
    const conversions = parseNumber(row.conversions);
    const clicks = parseNumber(row.clicks);
    if (conversions === null || clicks === null || clicks === 0) {
      return null;
    }
    return Number(((conversions / clicks) * 100).toFixed(2));
  }

  return null;
}

export function aggregateByDate(
  rows: DatasetRow[],
  dateField: string,
  metric: string,
  capabilities: DatasetCapabilities,
  groupBy?: string | null
) {
  const grouped = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const date = parseDateValue(row[dateField]);
    const metricValue = resolveMetricValue(row, metric, capabilities);
    if (!date || metricValue === null) {
      continue;
    }

    const dateKey = date.toISOString().slice(0, 10);
    const groupKey = groupBy ? String(row[groupBy] ?? "Unknown") : metric;
    const bucket = grouped.get(dateKey) ?? new Map<string, number>();
    bucket.set(groupKey, (bucket.get(groupKey) ?? 0) + metricValue);
    grouped.set(dateKey, bucket);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      date,
      ...Object.fromEntries([...values.entries()].map(([key, value]) => [key, Number(value.toFixed(2))]))
    }));
}

export function aggregateByDimension(
  rows: DatasetRow[],
  dimension: string,
  metric: string,
  capabilities: DatasetCapabilities,
  groupBy?: string | null
) {
  const grouped = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const dimensionValue = row[dimension];
    const metricValue = resolveMetricValue(row, metric, capabilities);
    if (dimensionValue === null || dimensionValue === "" || metricValue === null) {
      continue;
    }

    const dimensionKey = String(dimensionValue);
    const groupKey = groupBy ? String(row[groupBy] ?? "Unknown") : metric;
    const bucket = grouped.get(dimensionKey) ?? new Map<string, number>();
    bucket.set(groupKey, (bucket.get(groupKey) ?? 0) + metricValue);
    grouped.set(dimensionKey, bucket);
  }

  return [...grouped.entries()].map(([dimensionValue, values]) => ({
    [dimension]: dimensionValue,
    ...Object.fromEntries([...values.entries()].map(([key, value]) => [key, Number(value.toFixed(2))]))
  }));
}

export function buildHistogramData(
  rows: DatasetRow[],
  metric: string,
  capabilities: DatasetCapabilities
) {
  const values = rows
    .map((row) => resolveMetricValue(row, metric, capabilities))
    .filter((value): value is number => value !== null);

  if (values.length < 4) {
    return [];
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

  return buckets;
}

export function buildScatterData(
  rows: DatasetRow[],
  xMetric: string,
  yMetric: string,
  capabilities: DatasetCapabilities
) {
  return rows
    .map((row) => ({
      [xMetric]: resolveMetricValue(row, xMetric, capabilities),
      [yMetric]: resolveMetricValue(row, yMetric, capabilities)
    }))
    .filter(
      (entry): entry is Record<string, number> =>
        typeof entry[xMetric] === "number" && typeof entry[yMetric] === "number"
    )
    .slice(0, 160);
}

export function buildKpiCardData(
  rows: DatasetRow[],
  metric: string,
  capabilities: DatasetCapabilities
) {
  const values = rows
    .map((row) => resolveMetricValue(row, metric, capabilities))
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return [];
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return [{ label: metric, value: Number(total.toFixed(2)) }];
}
