import type { DatasetProfile, DatasetRow, PrimitiveValue } from "./types.js";
import { parseNumber } from "../utils/inference.js";

type ResolutionKind = "direct" | "alias" | "derived";
type MetricAggregation = "sum" | "ratio" | "difference" | "average";

export interface SemanticMetricResolution {
  key: string;
  sourceColumns: string[];
  resolution: ResolutionKind;
  confidence: number;
  aggregation: MetricAggregation;
  formula?: string;
  denominatorMetric?: string;
}

export interface SemanticDimensionResolution {
  key: string;
  sourceColumns: string[];
  resolution: ResolutionKind;
  confidence: number;
}

export interface SemanticDatasetContract {
  metricResolutions: Record<string, SemanticMetricResolution>;
  dimensionResolutions: Record<string, SemanticDimensionResolution>;
  availableMetrics: string[];
  availableDimensions: string[];
  derivedMetrics: string[];
  sourceToCanonical: Record<string, string>;
}

type MetricSpec = {
  key: string;
  aliases: string[];
  aggregation: MetricAggregation;
  denominatorMetric?: string;
  componentAliases?: string[];
  fallbackAliases?: string[];
};

type DimensionSpec = {
  key: string;
  aliases: string[];
};

const METRIC_SPECS: MetricSpec[] = [
  { key: "revenue", aliases: ["revenue", "sales", "sales value", "sales_value", "income", "gmv", "net sales", "gross sales", "conversion value", "conversion_value"], aggregation: "sum" },
  { key: "spend", aliases: ["spend", "all in spend", "all_in_spend", "total outlay", "total_outlay", "cost", "ad spend", "ad_spend", "media spend", "media_spend", "paid media cost", "paid_media_cost", "budget"], aggregation: "sum", componentAliases: ["media spend", "media_spend", "creative spend", "creative_spend", "vendor fees", "vendor_fees", "discount allowance", "discount_allowance", "fulfillment outlay", "fulfillment_outlay", "fulfillment cost", "fulfillment_cost"] },
  { key: "clicks", aliases: ["clicks", "click through count", "click_through_count", "click count", "click_count"], aggregation: "sum" },
  { key: "impressions", aliases: ["impressions", "ad view count", "ad_view_count", "views", "impression count", "impression_count"], aggregation: "sum" },
  { key: "conversions", aliases: ["conversions", "closed won count", "closed_won_count", "conversion count", "conversion_count", "orders", "purchases"], aggregation: "sum" },
  { key: "roas", aliases: ["roas", "return on ad spend"], aggregation: "ratio", denominatorMetric: "spend" },
  { key: "ctr", aliases: ["ctr", "click-through rate", "click through rate"], aggregation: "ratio", denominatorMetric: "impressions" },
  { key: "cvr", aliases: ["cvr", "conversion rate", "conversion_rate"], aggregation: "ratio", denominatorMetric: "clicks" }
];

const DIMENSION_SPECS: DimensionSpec[] = [
  { key: "date", aliases: ["date", "day", "week", "month", "event day", "event_day", "activity date", "activity_date", "created at", "created_at"] },
  { key: "campaign", aliases: ["campaign", "program", "initiative", "offer", "initiative label", "initiative_label", "program name", "program_name"] },
  { key: "channel", aliases: ["channel", "distribution channel", "distribution_channel", "channel mix", "source", "medium"] },
  { key: "device", aliases: ["device", "device type", "device_type", "device class", "device_class", "platform"] },
  { key: "region", aliases: ["region", "geo", "market area", "market_area", "country", "market"] }
];

function normalizeName(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function aliasMatches(column: string, alias: string) {
  const normalizedColumn = normalizeName(column);
  const normalizedAlias = normalizeName(alias);
  return normalizedColumn === normalizedAlias || normalizedColumn.includes(normalizedAlias) || normalizedAlias.includes(normalizedColumn);
}

function scoreColumnMatch(column: string, alias: string) {
  const normalizedColumn = normalizeName(column);
  const normalizedAlias = normalizeName(alias);
  if (normalizedColumn === normalizedAlias) {
    return 3;
  }
  if (normalizedColumn.includes(normalizedAlias)) {
    return 2;
  }
  if (normalizedAlias.includes(normalizedColumn)) {
    return 1;
  }
  return 0;
}

function scoreMetricCandidate(spec: MetricSpec, column: string) {
  const normalizedColumn = normalizeName(column);
  let score = 0;

  for (const alias of spec.aliases) {
    score = Math.max(score, scoreColumnMatch(column, alias));
  }

  if (spec.key === "spend") {
    if (/(total|all in|all-in|outlay)/i.test(normalizedColumn)) {
      score += 3;
    }
    if (/(media|creative|vendor|discount|fulfillment)/i.test(normalizedColumn)) {
      score -= 2;
    }
  }

  if (spec.key === "revenue" && /(sales value|sales_value|revenue|sales|income|gmv)/i.test(normalizedColumn)) {
    score += 2;
  }

  if (spec.key === "conversions" && /(closed won|closed_won|conversion|orders|purchases)/i.test(normalizedColumn)) {
    score += 2;
  }

  if (spec.key === "clicks" && /(click through|click_through|click count|click_count|clicks)/i.test(normalizedColumn)) {
    score += 2;
  }

  if (spec.key === "impressions" && /(ad view|ad_view|impression|views)/i.test(normalizedColumn)) {
    score += 2;
  }

  return score;
}

function pickBestColumn(columns: string[], aliases: string[]) {
  let best: { column: string; score: number } | null = null;

  for (const column of columns) {
    for (const alias of aliases) {
      const score = scoreColumnMatch(column, alias);
      if (score > 0 && (!best || score > best.score)) {
        best = { column, score };
      }
    }
  }

  return best?.column ?? null;
}

function getColumnsByKind(profile: DatasetProfile, kind: "numeric" | "categorical" | "datetime") {
  return profile.columns.filter((column) => column.kind === kind).map((column) => column.name);
}

function resolveMetricSourceColumns(profile: DatasetProfile, spec: MetricSpec) {
  const numericColumns = getColumnsByKind(profile, "numeric");
  const directColumns = numericColumns
    .map((column) => ({ column, score: scoreMetricCandidate(spec, column) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (directColumns.length > 0) {
    const best = directColumns[0];
    return {
      sourceColumns: [best.column],
      resolution: "direct" as const,
      confidence: best.score >= 5 ? 0.98 : best.score >= 3 ? 0.92 : 0.84
    };
  }

  if (spec.componentAliases && spec.componentAliases.length > 0) {
    const componentColumns = numericColumns.filter((column) => spec.componentAliases!.some((alias) => aliasMatches(column, alias)));
    if (componentColumns.length > 0) {
      return { sourceColumns: componentColumns, resolution: "derived" as const, confidence: 0.9 };
    }
  }

  return null;
}

function resolveDimensionSourceColumns(profile: DatasetProfile, spec: DimensionSpec) {
  const categoricalColumns = getColumnsByKind(profile, "categorical");
  const datetimeColumns = getColumnsByKind(profile, "datetime");
  const candidateColumns = spec.key === "date" ? datetimeColumns : categoricalColumns;
  const matched = pickBestColumn(candidateColumns, spec.aliases);
  if (!matched) {
    return null;
  }

  return {
    key: spec.key,
    sourceColumns: [matched],
    resolution: matched.toLowerCase() === spec.key ? ("direct" as const) : ("alias" as const),
    confidence: matched.toLowerCase() === spec.key ? 0.98 : 0.9
  };
}

function buildMetricResolution(profile: DatasetProfile, spec: MetricSpec): SemanticMetricResolution | null {
  const direct = resolveMetricSourceColumns(profile, spec);
  if (direct) {
    return {
      key: spec.key,
      sourceColumns: direct.sourceColumns,
      resolution: direct.resolution,
      confidence: direct.confidence,
      aggregation: spec.aggregation,
      formula:
        direct.resolution === "derived" && spec.componentAliases
          ? `sum(${direct.sourceColumns.join(") + sum(")})`
          : `sum(${direct.sourceColumns[0]})`,
      denominatorMetric: spec.denominatorMetric
    };
  }

  return null;
}

export function buildSemanticDatasetContract(profile: DatasetProfile): SemanticDatasetContract {
  const metricResolutions: Record<string, SemanticMetricResolution> = {};
  const dimensionResolutions: Record<string, SemanticDimensionResolution> = {};
  const sourceToCanonical: Record<string, string> = {};
  const availableMetrics: string[] = [];
  const availableDimensions: string[] = [];
  const derivedMetrics: string[] = [];

  for (const spec of METRIC_SPECS) {
    const resolution = buildMetricResolution(profile, spec);
    if (resolution) {
      metricResolutions[spec.key] = resolution;
      availableMetrics.push(spec.key);
      sourceToCanonical[normalizeName(spec.key)] = spec.key;
      if (resolution.resolution === "derived") {
        derivedMetrics.push(spec.key);
      }
      for (const source of resolution.sourceColumns) {
        sourceToCanonical[normalizeName(source)] = spec.key;
      }
    }
  }

  for (const spec of DIMENSION_SPECS) {
    const resolution = resolveDimensionSourceColumns(profile, spec);
    if (resolution) {
      dimensionResolutions[spec.key] = resolution;
      availableDimensions.push(spec.key);
      for (const source of resolution.sourceColumns) {
        sourceToCanonical[normalizeName(source)] = spec.key;
      }
    }
  }

  return {
    metricResolutions,
    dimensionResolutions,
    availableMetrics,
    availableDimensions,
    derivedMetrics,
    sourceToCanonical
  };
}

function getRowMetricValue(row: DatasetRow, column: string) {
  return parseNumber(row[column]);
}

function sumRowColumns(row: DatasetRow, columns: string[]) {
  let total = 0;
  let found = false;
  for (const column of columns) {
    const value = getRowMetricValue(row, column);
    if (value === null) {
      continue;
    }
    total += value;
    found = true;
  }
  return found ? total : null;
}

export function firstAvailableMetricFromContract(contract: SemanticDatasetContract, candidates: string[]) {
  for (const candidate of candidates) {
    if (contract.availableMetrics.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveSemanticMetricSourceColumns(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  metric: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  return contract.metricResolutions[metric]?.sourceColumns ?? [];
}

export function resolveSemanticDimensionSourceColumn(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  dimension: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  return contract.dimensionResolutions[dimension]?.sourceColumns[0] ?? null;
}

export function resolveCanonicalMetricKey(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  metricOrSource: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const normalized = normalizeName(metricOrSource);
  return (
    contract.sourceToCanonical[normalized] ??
    contract.metricResolutions[metricOrSource]?.key ??
    (normalized.includes("spend") || normalized.includes("cost") || normalized.includes("ad spend") ? "spend" : null) ??
    (normalized.includes("conversion rate") || normalized.includes("conversion_rate") || normalized.includes("conv rate") ? "cvr" : null) ??
    (normalized.includes("click through rate") || normalized.includes("click-through rate") ? "ctr" : null) ??
    metricOrSource
  );
}

export function resolveCanonicalDimensionKey(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  dimensionOrSource: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const normalized = normalizeName(dimensionOrSource);
  const resolved =
    contract.sourceToCanonical[normalized] ??
    contract.dimensionResolutions[dimensionOrSource]?.key ??
    dimensionOrSource;
  return resolved;
}

export function resolveSemanticMetricValue(
  row: DatasetRow,
  metric: string,
  profileOrContract: DatasetProfile | SemanticDatasetContract
): number | null {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const canonicalMetric = contract.metricResolutions[metric] ? metric : resolveCanonicalMetricKey(contract, metric);
  const resolution = contract.metricResolutions[canonicalMetric];
  const sourceColumns = resolution?.sourceColumns ?? [];

  if (canonicalMetric === "roas") {
    const revenue = resolveSemanticMetricValue(row, "revenue", contract);
    const spend = resolveSemanticMetricValue(row, "spend", contract);
    if (revenue === null || spend === null || spend === 0) {
      return null;
    }
    return Number((revenue / spend).toFixed(2));
  }

  if (canonicalMetric === "ctr") {
    const clicks = resolveSemanticMetricValue(row, "clicks", contract);
    const impressions = resolveSemanticMetricValue(row, "impressions", contract);
    if (clicks === null || impressions === null || impressions === 0) {
      return null;
    }
    return Number(((clicks / impressions) * 100).toFixed(2));
  }

  if (canonicalMetric === "cvr") {
    const numerator = resolveSemanticMetricValue(row, "conversions", contract);
    const clicks = resolveSemanticMetricValue(row, "clicks", contract);
    if (numerator === null || clicks === null || clicks === 0) {
      return null;
    }
    return Number(((numerator / clicks) * 100).toFixed(2));
  }

  if (sourceColumns.length > 0) {
    const total = sumRowColumns(row, sourceColumns);
    return total === null ? null : Number(total.toFixed(2));
  }

  const direct = parseNumber(row[metric]);
  return direct === null ? null : Number(direct.toFixed(2));
}

export function aggregateSemanticMetric(
  rows: DatasetRow[],
  metric: string,
  profileOrContract: DatasetProfile | SemanticDatasetContract
): number | null {
  if (rows.length === 0) {
    return null;
  }

  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const canonicalMetric = contract.metricResolutions[metric] ? metric : resolveCanonicalMetricKey(contract, metric);
  const resolution = contract.metricResolutions[canonicalMetric];
  const aggregation = resolution?.aggregation ?? "sum";

  if (aggregation === "ratio") {
    const denominatorMetric = resolution?.denominatorMetric ?? null;
    const numeratorMetric =
      canonicalMetric === "roas"
        ? "revenue"
        : canonicalMetric === "ctr"
          ? "clicks"
          : canonicalMetric === "cvr"
            ? "conversions"
            : canonicalMetric;

    const numerator = aggregateSemanticMetric(rows, numeratorMetric, contract);
    const denominator = denominatorMetric ? aggregateSemanticMetric(rows, denominatorMetric, contract) : aggregateSemanticMetric(rows, "clicks", contract);

    if (numerator === null || denominator === null || denominator === 0) {
      return null;
    }

    const ratio = numerator / denominator;
    const shouldScalePercent = canonicalMetric === "ctr" || canonicalMetric === "cvr";
    return Number((shouldScalePercent ? ratio * 100 : ratio).toFixed(2));
  }

  const values = rows
    .map((row) => resolveSemanticMetricValue(row, metric, contract))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }

  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(2));
}

export function metricFamily(metric: string): MetricAggregation {
  const normalized = normalizeName(metric);
  if (normalized.includes("roas") || normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("conversion rate")) {
    return "ratio";
  }
  return "sum";
}
