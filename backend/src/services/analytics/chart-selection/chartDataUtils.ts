import type { ChartConfig, DatasetCapabilities, DatasetProfile, DatasetRow, PrimitiveValue } from "../../../analytics/types.js";
import { parseDateValue, parseNumber } from "../../../utils/inference.js";
import {
  normalizeSemanticDimensionValue,
  resolveSemanticMetricValue
} from "../../../analytics/semanticContract.js";

type Filter = ChartConfig["filters"][number];

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

function formatHistogramBoundary(metric: string, value: number) {
  const normalized = metric.toLowerCase();
  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income") || normalized.includes("cost") || normalized.includes("spend") || normalized.includes("amount") || normalized.includes("value")) {
    return `$${Math.abs(value) >= 1000 ? formatCompactNumber(value) : new Intl.NumberFormat(undefined, { maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value)}`;
  }

  if (normalized.includes("rate") || normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("percent")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: percentValue % 1 === 0 ? 0 : 1 }).format(percentValue)}%`;
  }

  return Math.abs(value) >= 1000
    ? formatCompactNumber(value)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
}

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
  capabilities: DatasetCapabilities,
  profile: DatasetProfile
): number | null {
  if (metric === "row_count" || metric === "calls") {
    return 1;
  }

  const directValue = resolveSemanticMetricValue(row, metric, profile.semanticContract ?? profile);
  if (directValue !== null) {
    return directValue;
  }

  if (metric === "roas" && capabilities.derivedMetrics.includes("roas")) {
    const revenue = parseNumber(row.revenue);
    const spend = parseNumber(row["spend"] ?? row["cost"]);
    if (revenue === null || spend === null || spend === 0) {
      return null;
    }
    return Number((revenue / spend).toFixed(2));
  }

  if ((metric === "cvr" || metric === "conversion_rate") && capabilities.derivedMetrics.includes("cvr")) {
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
  profile: DatasetProfile,
  groupBy?: string | null
) {
  const grouped = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const date = parseDateValue(row[dateField]);
    const metricValue = resolveMetricValue(row, metric, capabilities, profile);
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
  profile: DatasetProfile,
  groupBy?: string | null
) {
  const grouped = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const dimensionValue = row[dimension];
    const metricValue = resolveMetricValue(row, metric, capabilities, profile);
    if (dimensionValue === null || dimensionValue === "" || metricValue === null) {
      continue;
    }

    const dimensionKey = String(normalizeSemanticDimensionValue(dimensionValue, dimension, profile.semanticContract ?? profile));
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
  capabilities: DatasetCapabilities,
  profile: DatasetProfile
) {
  const values = rows
    .map((row) => resolveMetricValue(row, metric, capabilities, profile))
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
    bucketLabel: `${formatHistogramBoundary(metric, min + index * step)}–${formatHistogramBoundary(metric, min + (index + 1) * step)}`,
    rangeStart: Number((min + index * step).toFixed(4)),
    rangeEnd: Number((min + (index + 1) * step).toFixed(4)),
    count: 0,
    share: 0
  }));

  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / step), bucketCount - 1);
    buckets[index].count += 1;
  }

  for (const bucket of buckets) {
    bucket.share = Number((bucket.count / values.length).toFixed(4));
  }

  return buckets;
}

export function buildScatterData(
  rows: DatasetRow[],
  xMetric: string,
  yMetric: string,
  capabilities: DatasetCapabilities,
  profile: DatasetProfile
) {
  return rows
    .map((row) => ({
      [xMetric]: resolveMetricValue(row, xMetric, capabilities, profile),
      [yMetric]: resolveMetricValue(row, yMetric, capabilities, profile)
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
  capabilities: DatasetCapabilities,
  profile: DatasetProfile
) {
  const values = rows
    .map((row) => resolveMetricValue(row, metric, capabilities, profile))
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return [];
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return [{ label: metric, value: Number(total.toFixed(2)) }];
}
