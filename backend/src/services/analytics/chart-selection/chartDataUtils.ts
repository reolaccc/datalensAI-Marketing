import type { ChartConfig, DatasetCapabilities, DatasetProfile, DatasetRow, PrimitiveValue } from "../../../analytics/types.js";
import { parseDateValue, parseNumber } from "../../../utils/inference.js";
import {
  aggregateSemanticMetric,
  detectCallDatasetGrain,
  getCpqcRowReliability,
  getRoasRowReliability,
  hasReliablePaidSpend,
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

function isRatioMetric(metric: string) {
  return [
    "roas",
    "cost_per_qualified_call",
    "cost_per_conversion",
    "cost_per_call",
    "qualified_call_rate",
    "conversion_rate",
    "cvr",
    "missed_call_rate",
    "repeat_caller_rate"
  ].includes(metric);
}

function usesSemanticGroupedRatio(metric: string) {
  return [
    "roas",
    "cost_per_qualified_call",
    "cost_per_conversion",
    "cost_per_call"
  ].includes(metric);
}

function shouldPreserveNullSemanticRatioGroup(
  metric: string,
  rows: DatasetRow[],
  profile: DatasetProfile
) {
  if (metric === "cost_per_qualified_call") {
    return rows.some((row) => getCpqcRowReliability(row, profile).hasReliablePaid);
  }

  return false;
}

function allowsZeroDenominatorRows(metric: string) {
  return metric === "cost_per_qualified_call" || metric === "cost_per_conversion" || metric === "cost_per_call";
}

function resolveRatioMetricParts(
  row: DatasetRow,
  metric: string,
  capabilities: DatasetCapabilities,
  profile: DatasetProfile
) {
  const resolve = (metricKey: string) => resolveMetricValue(row, metricKey, capabilities, profile);

  switch (metric) {
    case "roas": {
      const roasReliability = getRoasRowReliability(row, profile);
      if (!roasReliability.contributesToRoasAggregate) {
        return null;
      }
      const numerator = resolve("revenue");
      const denominator = resolve("spend");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 1 };
    }
    case "cost_per_qualified_call": {
      const cpqcReliability = getCpqcRowReliability(row, profile);
      if (!cpqcReliability.contributesToCpqcAggregate) {
        return null;
      }
      const numerator = resolve("spend");
      const denominator = resolve("qualifiedCall");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 1 };
    }
    case "cost_per_conversion": {
      if (!hasReliablePaidSpend(row, profile)) {
        return null;
      }
      const numerator = resolve("spend");
      const denominator = resolve("convertedCall");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 1 };
    }
    case "cost_per_call": {
      if (!hasReliablePaidSpend(row, profile)) {
        return null;
      }
      const numerator = resolve("spend");
      const denominator = resolve("calls");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 1 };
    }
    case "qualified_call_rate": {
      const numerator = resolve("qualifiedCall");
      const denominator = resolve("calls");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 100 };
    }
    case "conversion_rate":
    case "cvr": {
      const numerator = resolve("convertedCall") ?? resolve("conversions");
      const denominator = resolve("calls") ?? resolve("clicks");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 100 };
    }
    case "missed_call_rate": {
      const numerator = resolve("missedCall");
      const denominator = resolve("calls");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 100 };
    }
    case "repeat_caller_rate": {
      const numerator = resolve("repeatCaller");
      const denominator = resolve("calls");
      return numerator === null || denominator === null ? null : { numerator, denominator, scale: 100 };
    }
    default:
      return null;
  }
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
  if (metric === "row_count") {
    return 1;
  }

  const directValue = resolveSemanticMetricValue(row, metric, profile);
  if (directValue !== null) {
    return directValue;
  }

  if (metric === "calls") {
    if (detectCallDatasetGrain(profile) === "aggregated_call_summary") {
      return null;
    }
    return 1;
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
  if (isRatioMetric(metric) && usesSemanticGroupedRatio(metric)) {
    const grouped = new Map<string, Map<string, DatasetRow[]>>();

    for (const row of rows) {
      const date = parseDateValue(row[dateField]);
      if (!date) {
        continue;
      }

      const dateKey = date.toISOString().slice(0, 10);
      const groupKey = groupBy ? String(row[groupBy] ?? "Unknown") : metric;
      const bucket = grouped.get(dateKey) ?? new Map<string, DatasetRow[]>();
      const bucketRows = bucket.get(groupKey) ?? [];
      bucketRows.push(row);
      bucket.set(groupKey, bucketRows);
      grouped.set(dateKey, bucket);
    }

    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, values]) => ({
        date,
        ...Object.fromEntries(
          [...values.entries()]
            .map(([key, bucketRows]) => {
              const aggregatedValue = aggregateSemanticMetric(bucketRows, metric, profile);
              if (aggregatedValue === null && !shouldPreserveNullSemanticRatioGroup(metric, bucketRows, profile)) {
                return null;
              }
              return [key, aggregatedValue] as const;
            })
            .filter((entry): entry is readonly [string, number | null] => entry !== null)
        )
      }));
  }

  if (isRatioMetric(metric)) {
    const grouped = new Map<string, Map<string, { numerator: number; denominator: number; scale: number }>>();

    for (const row of rows) {
      const date = parseDateValue(row[dateField]);
      const ratioParts = resolveRatioMetricParts(row, metric, capabilities, profile);
      if (!date || !ratioParts || ratioParts.denominator < 0 || (!allowsZeroDenominatorRows(metric) && ratioParts.denominator <= 0)) {
        continue;
      }

      const dateKey = date.toISOString().slice(0, 10);
      const groupKey = groupBy ? String(row[groupBy] ?? "Unknown") : metric;
      const bucket = grouped.get(dateKey) ?? new Map<string, { numerator: number; denominator: number; scale: number }>();
      const totals = bucket.get(groupKey) ?? { numerator: 0, denominator: 0, scale: ratioParts.scale };
      totals.numerator += ratioParts.numerator;
      totals.denominator += ratioParts.denominator;
      bucket.set(groupKey, totals);
      grouped.set(dateKey, bucket);
    }

    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, values]) => ({
        date,
        ...Object.fromEntries(
          [...values.entries()].map(([key, value]) => [
            key,
            value.denominator > 0 ? Number(((value.numerator / value.denominator) * value.scale).toFixed(2)) : null
          ])
        )
      }));
  }

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
  if (isRatioMetric(metric) && usesSemanticGroupedRatio(metric)) {
    const grouped = new Map<string, Map<string, DatasetRow[]>>();

    for (const row of rows) {
      const dimensionValue = row[dimension];
      if (dimensionValue === null || dimensionValue === "") {
        continue;
      }

      const dimensionKey = String(normalizeSemanticDimensionValue(dimensionValue, dimension, profile.semanticContract ?? profile));
      const groupKey = groupBy ? String(row[groupBy] ?? "Unknown") : metric;
      const bucket = grouped.get(dimensionKey) ?? new Map<string, DatasetRow[]>();
      const bucketRows = bucket.get(groupKey) ?? [];
      bucketRows.push(row);
      bucket.set(groupKey, bucketRows);
      grouped.set(dimensionKey, bucket);
    }

    return [...grouped.entries()]
      .map(([dimensionValue, values]) => {
        const aggregatedEntries = [...values.entries()]
          .map(([key, bucketRows]) => {
            const aggregatedValue = aggregateSemanticMetric(bucketRows, metric, profile);
            if (aggregatedValue === null && !shouldPreserveNullSemanticRatioGroup(metric, bucketRows, profile)) {
              return null;
            }
            return [key, aggregatedValue] as const;
          })
          .filter((entry): entry is readonly [string, number | null] => entry !== null);
        if (aggregatedEntries.length === 0) {
          return null;
        }
        return {
          [dimension]: dimensionValue,
          ...Object.fromEntries(aggregatedEntries)
        };
      })
      .filter((entry): entry is Record<string, string | number | null> => entry !== null);
  }

  if (isRatioMetric(metric)) {
    const grouped = new Map<string, Map<string, { numerator: number; denominator: number; scale: number }>>();

    for (const row of rows) {
      const dimensionValue = row[dimension];
      const ratioParts = resolveRatioMetricParts(row, metric, capabilities, profile);
      if (
        dimensionValue === null ||
        dimensionValue === "" ||
        !ratioParts ||
        ratioParts.denominator < 0 ||
        (!allowsZeroDenominatorRows(metric) && ratioParts.denominator <= 0)
      ) {
        continue;
      }

      const dimensionKey = String(normalizeSemanticDimensionValue(dimensionValue, dimension, profile.semanticContract ?? profile));
      const groupKey = groupBy ? String(row[groupBy] ?? "Unknown") : metric;
      const bucket = grouped.get(dimensionKey) ?? new Map<string, { numerator: number; denominator: number; scale: number }>();
      const totals = bucket.get(groupKey) ?? { numerator: 0, denominator: 0, scale: ratioParts.scale };
      totals.numerator += ratioParts.numerator;
      totals.denominator += ratioParts.denominator;
      bucket.set(groupKey, totals);
      grouped.set(dimensionKey, bucket);
    }

    return [...grouped.entries()].map(([dimensionValue, values]) => ({
      [dimension]: dimensionValue,
      ...Object.fromEntries(
        [...values.entries()].map(([key, value]) => [
          key,
          value.denominator > 0 ? Number(((value.numerator / value.denominator) * value.scale).toFixed(2)) : null
        ])
      )
    }));
  }

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
