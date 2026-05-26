import type {
  DatasetProfile,
  DatasetRow,
  KpiCard,
  KpiCandidate,
  KpiMetricType,
  KpiReliability
} from "./types.js";
import { parseNumber } from "../utils/inference.js";
import {
  aggregateSemanticMetric,
  resolveSemanticDimensionSourceColumn,
  resolveSemanticMetricValue
} from "./semanticContract.js";

type DatasetType = "marketing" | "sales" | "ecommerce" | "generic";
type MetricKey =
  | "revenue"
  | "cost"
  | "spend"
  | "roi"
  | "roas"
  | "conversion_rate"
  | "cvr"
  | "clicks"
  | "impressions"
  | "ctr"
  | "conversions"
  | "cpc"
  | "cpa"
  | "revenue_per_click"
  | "orders"
  | "average_order_value"
  | "units_sold"
  | "profit"
  | "margin"
  | "refund_rate"
  | "total_value"
  | "total_quantity";

interface SegmentSummary {
  dimension: string;
  top?: { name: string; value: number; share?: number };
  best?: { name: string; value: number };
  worst?: { name: string; value: number };
  top3Share?: number;
}

interface MetricObservation {
  key: MetricKey;
  label: string;
  value: number;
  formattedValue: string;
  unit: string;
  metricType: KpiMetricType;
  description: string;
  formula: string;
  reliability: KpiReliability;
  priority: number;
  warnings: string[];
  sourceColumns: string[];
  contextLine?: string;
  relatedDimension?: string;
  segmentSummary?: SegmentSummary;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getColumnProfile(profile: DatasetProfile, columnName: string) {
  return profile.columns.find((column) => column.name === columnName);
}

function findColumn(profile: DatasetProfile, aliases: string[]) {
  const wanted = aliases.map(normalizeName);
  return profile.numericColumns.find((column) => {
    const normalized = normalizeName(column);
    return wanted.some((alias) => normalized === alias || normalized.includes(alias));
  });
}

function pickBestNumericColumn(profile: DatasetProfile, aliases: string[]) {
  const wanted = aliases.map(normalizeName);
  const ranked = profile.numericColumns
    .map((column) => {
      const normalized = normalizeName(column);
      const score = wanted.reduce((best, alias) => {
        if (normalized === alias) {
          return Math.max(best, 3);
        }
        if (normalized.includes(alias)) {
          return Math.max(best, 2);
        }
        if (alias.includes(normalized)) {
          return Math.max(best, 1);
        }
        return best;
      }, 0);
      return { column, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.column.length - right.column.length);

  return ranked[0]?.column ?? null;
}

function hasSignal(columns: string[], hints: string[]) {
  return columns.some((column) => {
    const normalized = normalizeName(column);
    return hints.some((hint) => normalized.includes(hint));
  });
}

function formatCount(value: number) {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1000) {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: Math.abs(rounded) >= 100000 ? 0 : Math.abs(rounded) >= 10000 ? 1 : 2
    }).format(rounded);
  }

  return rounded.toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
}

function formatGenericNumber(value: number) {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: Math.abs(value) >= 100000 ? 0 : Math.abs(value) >= 10000 ? 1 : 2
    }).format(value);
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2
  });
}

function normalizePercentPoint(value: number) {
  const absolute = Math.abs(value);
  return absolute <= 1 ? Number((value * 100).toFixed(2)) : Number(value.toFixed(2));
}

function formatPercentPoint(value: number) {
  return `${normalizePercentPoint(value).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatRatio(value: number) {
  return `${value.toFixed(2).replace(/\.00$/, "")}x`;
}

function getConfiguredCurrencyCode() {
  const code = (process.env.DEFAULT_CURRENCY_CODE ?? process.env.CURRENCY_CODE ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

function getCurrencySymbol(currencyCode: string) {
  return currencyCode ? new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 0 })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? "$" : "$";
}

function formatCurrencyLike(value: number, currencyCode: string) {
  if (currencyCode) {
    if (Math.abs(value) >= 1000) {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        notation: "compact",
        compactDisplay: "short",
        maximumFractionDigits: Math.abs(value) >= 100000 ? 0 : Math.abs(value) >= 10000 ? 1 : 2
      }).format(value);
    }

    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2
    }).format(value);
  }

  return `${getCurrencySymbol(currencyCode)}${formatGenericNumber(value)}`;
}

function sumColumn(rows: DatasetRow[], column: string) {
  return rows.reduce((sum, row) => {
    const value = parseNumber(row[column]);
    return value === null ? sum : sum + value;
  }, 0);
}

function countMissingRows(rows: DatasetRow[], column: string) {
  return rows.reduce((count, row) => (parseNumber(row[column]) === null ? count + 1 : count), 0);
}

function weightedRate(rows: DatasetRow[], rateColumn: string, weightColumn?: string | null) {
  let weightedTotal = 0;
  let weightTotal = 0;

  for (const row of rows) {
    const rate = parseNumber(row[rateColumn]);
    if (rate === null) {
      continue;
    }

    const weight = weightColumn ? parseNumber(row[weightColumn]) : 1;
    if (weight === null || weight <= 0) {
      continue;
    }

    weightedTotal += rate * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) {
    return null;
  }

  return weightedTotal / weightTotal;
}

function ratioFromRows(rows: DatasetRow[], numeratorColumn: string, denominatorColumn: string) {
  let numeratorTotal = 0;
  let denominatorTotal = 0;

  for (const row of rows) {
    const numerator = parseNumber(row[numeratorColumn]);
    const denominator = parseNumber(row[denominatorColumn]);
    if (numerator === null || denominator === null || denominator <= 0) {
      continue;
    }

    numeratorTotal += numerator;
    denominatorTotal += denominator;
  }

  if (denominatorTotal === 0) {
    return null;
  }

  return numeratorTotal / denominatorTotal;
}

function hasCallTrackingSemanticContract(profile: DatasetProfile) {
  const domain = profile.semanticContract?.detectedDomain?.domain;
  return (
    domain === "call_tracking" ||
    domain === "call_operations" ||
    domain === "marketing_attribution" ||
    domain === "mixed_call_tracking_attribution"
  );
}

function buildSemanticRoleSet(profile: DatasetProfile) {
  return new Set(
    profile.semanticContract?.roleMappings
      ?.filter((mapping) => mapping.semanticRole && mapping.confidence >= 0.5)
      .map((mapping) => mapping.semanticRole as string) ?? []
  );
}

function findSemanticSourceColumn(profile: DatasetProfile, role: string) {
  return (
    profile.semanticContract?.roleMappings?.find(
      (mapping) => mapping.semanticRole === role && mapping.confidence >= 0.5
    )?.rawColumn ?? null
  );
}

function formatDurationSeconds(value: number) {
  if (!Number.isFinite(value)) {
    return "0s";
  }

  if (value < 60) {
    return `${Math.round(value)}s`;
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function buildSemanticMetricObservation(
  params: {
    key: string;
    label: string;
    value: number;
    metricType: KpiMetricType;
    unit: string;
    formula: string;
    description: string;
    sourceColumns: string[];
    priority: number;
    profile: DatasetProfile;
    rows: DatasetRow[];
  }
): MetricObservation {
  const preferredDimensionHints = ["channel", "source", "campaign"];
  const relatedDimension = preferredDimensionHints
    .map((hint) => resolveSemanticDimensionSourceColumn(params.profile.semanticContract ?? params.profile, hint))
    .find((dimension): dimension is string => Boolean(dimension));

  const segmentSummary = relatedDimension
    ? buildSegmentSummary(
        params.rows,
        relatedDimension,
        (row) => {
          if (params.key === "unique_callers") {
            return null;
          }
          if (params.key === "avg_call_duration") {
            return resolveSemanticMetricValue(row, params.sourceColumns[0] ?? "callDuration", params.profile.semanticContract ?? params.profile);
          }
          if (params.key === "qualified_call_rate") {
            return resolveSemanticMetricValue(row, "qualifiedCall", params.profile.semanticContract ?? params.profile);
          }
          if (params.key === "conversion_rate") {
            return resolveSemanticMetricValue(row, "convertedCall", params.profile.semanticContract ?? params.profile);
          }
          if (params.key === "missed_call_rate") {
            return resolveSemanticMetricValue(row, "missedCall", params.profile.semanticContract ?? params.profile);
          }
          if (params.key === "answered_call_rate") {
            return resolveSemanticMetricValue(row, "answeredCall", params.profile.semanticContract ?? params.profile);
          }
          if (params.key === "cost_per_qualified_call" || params.key === "cost_per_conversion" || params.key === "cost_per_call" || params.key === "revenue_per_call" || params.key === "roas") {
            return null;
          }
          return params.sourceColumns.length > 0
            ? resolveSemanticMetricValue(row, params.sourceColumns[0], params.profile.semanticContract ?? params.profile)
            : null;
        },
        params.key === "qualified_call_rate"
          ? {
              ratio: true,
              denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile.semanticContract ?? params.profile),
              scaleToPercent: true
            }
          : params.key === "conversion_rate"
            ? {
                ratio: true,
                denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile.semanticContract ?? params.profile),
                scaleToPercent: true
              }
            : params.key === "missed_call_rate"
              ? {
                  ratio: true,
                  denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile.semanticContract ?? params.profile),
                  scaleToPercent: true
                }
              : params.key === "answered_call_rate"
                ? {
                    ratio: true,
                    denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile.semanticContract ?? params.profile),
                    scaleToPercent: true
                  }
                : undefined
      )
    : null;

  const formattedValue =
    params.metricType === "currency"
      ? formatCurrencyLike(params.value, getConfiguredCurrencyCode())
      : params.metricType === "percentage" || params.metricType === "rate"
        ? formatPercentPoint(params.value)
        : params.metricType === "ratio"
          ? formatRatio(params.value)
          : params.metricType === "duration"
            ? formatDurationSeconds(params.value)
            : formatCount(params.value);

  return {
    key: params.key as MetricKey,
    label: params.label,
    value: params.value,
    formattedValue,
    unit: params.unit,
    metricType: params.metricType,
    description: params.description,
    formula: params.formula,
    reliability: "high",
    priority: params.priority,
    warnings: [],
    sourceColumns: params.sourceColumns,
    relatedDimension: relatedDimension ?? undefined,
    segmentSummary: segmentSummary ?? undefined,
    contextLine: relatedDimension && segmentSummary?.top?.name
      ? `Top ${humanize(relatedDimension)}: ${segmentSummary.top.name}`
      : undefined
  };
}

function buildSemanticKpiCards(rows: DatasetRow[], profile: DatasetProfile): KpiCard[] {
  if (!hasCallTrackingSemanticContract(profile) || !profile.semanticContract) {
    return [];
  }

  const roleSet = buildSemanticRoleSet(profile);
  const enabledSemanticKpiKeys = new Set(profile.semanticContract.enabledKpis?.map((item) => item.key) ?? []);
  const cards: MetricObservation[] = [];
  const calls = aggregateSemanticMetric(rows, "calls", profile.semanticContract);
  const qualifiedCalls = aggregateSemanticMetric(rows, "qualifiedCall", profile.semanticContract);
  const convertedCalls = aggregateSemanticMetric(rows, "convertedCall", profile.semanticContract);
  const revenue = aggregateSemanticMetric(rows, "revenue", profile.semanticContract);
  const spend = aggregateSemanticMetric(rows, "spend", profile.semanticContract);
  const durationMetric =
    profile.semanticContract?.availableMetrics.find((metric) =>
      ["callDuration", "talkTime", "handleTime", "waitTime", "ringTime"].includes(metric)
    ) ?? null;
  const callDuration = durationMetric ? aggregateSemanticMetric(rows, durationMetric, profile.semanticContract) : null;
  const missedCalls = aggregateSemanticMetric(rows, "missedCall", profile.semanticContract);
  const answeredCalls = aggregateSemanticMetric(rows, "answeredCall", profile.semanticContract);
  const repeatCallers = aggregateSemanticMetric(rows, "repeatCaller", profile.semanticContract);
  const callVolumeFallback = calls ?? (hasCallTrackingSemanticContract(profile) ? rows.length : null);
  const callerNumberColumn = findSemanticSourceColumn(profile, "callerNumber");

  if (enabledSemanticKpiKeys.has("total_calls") && roleSet.has("callId") && calls !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "total_calls",
        label: "Total Calls",
        value: calls,
        metricType: "count",
        unit: "calls",
        formula: "count(callId)",
        description: "Total tracked calls detected from the call identifier field.",
        sourceColumns: [findSemanticSourceColumn(profile, "callId") ?? "callId"],
        priority: 100,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("unique_callers") && callerNumberColumn) {
    const uniqueCallers = new Set(
      rows
        .map((row) => row[callerNumberColumn])
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
        .map((value) => String(value))
    ).size;
    if (uniqueCallers > 0) {
      cards.push(
        buildSemanticMetricObservation({
          key: "unique_callers",
          label: "Unique Callers",
          value: uniqueCallers,
          metricType: "count",
          unit: "callers",
          formula: `count_distinct(${callerNumberColumn})`,
          description: "Unique caller phone numbers detected in the dataset.",
          sourceColumns: [callerNumberColumn],
          priority: 96,
          profile,
          rows
        })
      );
    }
  }

  if (enabledSemanticKpiKeys.has("qualified_calls") && qualifiedCalls !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "qualified_calls",
        label: "Qualified Calls",
        value: qualifiedCalls,
        metricType: "count",
        unit: "qualified calls",
        formula: "sum(qualifiedCall)",
        description: "Calls marked as qualified by the inferred call outcome field.",
        sourceColumns: [findSemanticSourceColumn(profile, "qualifiedCall") ?? "qualifiedCall"],
        priority: 94,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("converted_calls") && convertedCalls !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "converted_calls",
        label: "Converted Calls",
        value: convertedCalls,
        metricType: "count",
        unit: "converted calls",
        formula: "sum(convertedCall)",
        description: "Calls marked as converted by the inferred conversion field.",
        sourceColumns: [findSemanticSourceColumn(profile, "convertedCall") ?? "convertedCall"],
        priority: 92,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("qualified_call_rate") && calls && qualifiedCalls !== null && calls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "qualified_call_rate",
        label: "Qualified Call Rate",
        value: (qualifiedCalls / calls) * 100,
        metricType: "percentage",
        unit: "%",
        formula: "qualifiedCalls / totalCalls",
        description: "Share of calls that were marked as qualified.",
        sourceColumns: [findSemanticSourceColumn(profile, "qualifiedCall") ?? "qualifiedCall"],
        priority: 90,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("conversion_rate") && calls && convertedCalls !== null && calls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "conversion_rate",
        label: "Conversion Rate",
        value: (convertedCalls / calls) * 100,
        metricType: "percentage",
        unit: "%",
        formula: "convertedCalls / totalCalls",
        description: "Share of calls that became conversions.",
        sourceColumns: [findSemanticSourceColumn(profile, "convertedCall") ?? "convertedCall"],
        priority: 89,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("total_revenue") && revenue !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "total_revenue",
        label: "Total Revenue",
        value: revenue,
        metricType: "currency",
        unit: "",
        formula: "sum(revenue)",
        description: "Total revenue detected from the inferred commercial value field.",
        sourceColumns: [findSemanticSourceColumn(profile, "revenue") ?? "revenue"],
        priority: 98,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("total_spend") && spend !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "total_spend",
        label: "Total Spend",
        value: spend,
        metricType: "currency",
        unit: "",
        formula: "sum(spend)",
        description: "Total spend detected from the inferred marketing cost field.",
        sourceColumns: [findSemanticSourceColumn(profile, "spend") ?? "spend"],
        priority: 95,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("roas") && revenue !== null && spend !== null && spend > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "roas",
        label: "ROAS",
        value: revenue / spend,
        metricType: "ratio",
        unit: "x",
        formula: "revenue / spend",
        description: "Return on ad spend from the inferred revenue and spend fields.",
        sourceColumns: [findSemanticSourceColumn(profile, "revenue") ?? "revenue", findSemanticSourceColumn(profile, "spend") ?? "spend"],
        priority: 97,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("revenue_per_call") && calls && revenue !== null && calls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "revenue_per_call",
        label: "Revenue per Call",
        value: revenue / calls,
        metricType: "currency",
        unit: "",
        formula: "revenue / totalCalls",
        description: "Average revenue generated per tracked call.",
        sourceColumns: [findSemanticSourceColumn(profile, "revenue") ?? "revenue"],
        priority: 87,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("cost_per_call") && calls && spend !== null && calls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "cost_per_call",
        label: "Cost per Call",
        value: spend / calls,
        metricType: "currency",
        unit: "",
        formula: "spend / totalCalls",
        description: "Average spend required to generate a tracked call.",
        sourceColumns: [findSemanticSourceColumn(profile, "spend") ?? "spend"],
        priority: 86,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("cost_per_qualified_call") && qualifiedCalls !== null && spend !== null && qualifiedCalls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "cost_per_qualified_call",
        label: "Cost per Qualified Call",
        value: spend / qualifiedCalls,
        metricType: "currency",
        unit: "",
        formula: "spend / qualifiedCalls",
        description: "Average spend required to generate a qualified call.",
        sourceColumns: [findSemanticSourceColumn(profile, "spend") ?? "spend", findSemanticSourceColumn(profile, "qualifiedCall") ?? "qualifiedCall"],
        priority: 85,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("cost_per_conversion") && convertedCalls !== null && spend !== null && convertedCalls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "cost_per_conversion",
        label: "Cost per Conversion",
        value: spend / convertedCalls,
        metricType: "currency",
        unit: "",
        formula: "spend / convertedCalls",
        description: "Average spend required to generate a converted call.",
        sourceColumns: [findSemanticSourceColumn(profile, "spend") ?? "spend", findSemanticSourceColumn(profile, "convertedCall") ?? "convertedCall"],
        priority: 84,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("avg_call_duration") && callDuration !== null && durationMetric) {
    cards.push(
      buildSemanticMetricObservation({
        key: "avg_call_duration",
        label: "Avg Call Duration",
        value: callDuration,
        metricType: "duration",
        unit: "seconds",
        formula: `avg(${durationMetric})`,
        description: "Average call duration based on the inferred duration field.",
        sourceColumns: [findSemanticSourceColumn(profile, durationMetric) ?? durationMetric],
        priority: 88,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("repeat_caller_rate") && repeatCallers !== null && callVolumeFallback !== null && callVolumeFallback > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "repeat_caller_rate",
        label: "Repeat Caller Rate",
        value: (repeatCallers / callVolumeFallback) * 100,
        metricType: "percentage",
        unit: "%",
        formula: "repeatCallers / callVolume",
        description: "Share of calls made by repeat callers.",
        sourceColumns: [findSemanticSourceColumn(profile, "repeatCaller") ?? "repeatCaller"],
        priority: 84,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("missed_call_rate") && calls && missedCalls !== null && calls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "missed_call_rate",
        label: "Missed Call Rate",
        value: (missedCalls / calls) * 100,
        metricType: "percentage",
        unit: "%",
        formula: "missedCalls / totalCalls",
        description: "Share of calls that were marked as missed.",
        sourceColumns: [findSemanticSourceColumn(profile, "missedCall") ?? "missedCall"],
        priority: 83,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("answered_call_rate") && calls && answeredCalls !== null && calls > 0) {
    cards.push(
      buildSemanticMetricObservation({
        key: "answered_call_rate",
        label: "Answered Call Rate",
        value: (answeredCalls / calls) * 100,
        metricType: "percentage",
        unit: "%",
        formula: "answeredCalls / totalCalls",
        description: "Share of calls that were marked as answered.",
        sourceColumns: [findSemanticSourceColumn(profile, "answeredCall") ?? "answeredCall"],
        priority: 82,
        profile,
        rows
      })
    );
  }

  return cards
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 6)
    .map((observation) => ({
      id: observation.key,
      label: observation.label,
      value: observation.value,
      formattedValue: observation.formattedValue,
      unit: observation.unit,
      metricType: observation.metricType,
      description: observation.description,
      formula: observation.formula,
      reliability: observation.reliability,
      priority: observation.priority,
      warnings: observation.warnings.length > 0 ? observation.warnings : undefined,
      relatedDimension: observation.relatedDimension,
      contextLine: observation.contextLine
    }));
}

function buildSemanticKpiCandidates(rows: DatasetRow[], profile: DatasetProfile): KpiCandidate[] {
  return buildSemanticKpiCards(rows, profile).map((card) => ({
    id: card.id,
    label: card.label,
    column: card.formula,
    confidence: 0.96,
    summary: card.description,
    aggregateValue: card.value
  }));
}

function aggregateNumericByDimension(
  rows: DatasetRow[],
  dimension: string,
  valueGetter: (row: DatasetRow) => number | null
) {
  const grouped = new Map<string, number>();

  for (const row of rows) {
    const dimensionValue = row[dimension];
    const value = valueGetter(row);
    if (dimensionValue === null || dimensionValue === undefined || String(dimensionValue).trim() === "" || value === null) {
      continue;
    }

    const key = String(dimensionValue);
    grouped.set(key, (grouped.get(key) ?? 0) + value);
  }

  const ranked = [...grouped.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);

  const total = ranked.reduce((sum, entry) => sum + entry.value, 0);

  return { ranked, total };
}

function aggregateRatioByDimension(
  rows: DatasetRow[],
  dimension: string,
  numeratorGetter: (row: DatasetRow) => number | null,
  denominatorGetter: (row: DatasetRow) => number | null,
  scaleToPercent = false
) {
  const grouped = new Map<string, { numerator: number; denominator: number }>();

  for (const row of rows) {
    const dimensionValue = row[dimension];
    const numerator = numeratorGetter(row);
    const denominator = denominatorGetter(row);
    if (
      dimensionValue === null ||
      dimensionValue === undefined ||
      String(dimensionValue).trim() === "" ||
      numerator === null ||
      denominator === null ||
      denominator <= 0
    ) {
      continue;
    }

    const key = String(dimensionValue);
    const bucket = grouped.get(key) ?? { numerator: 0, denominator: 0 };
    bucket.numerator += numerator;
    bucket.denominator += denominator;
    grouped.set(key, bucket);
  }

  const ranked = [...grouped.entries()]
    .map(([name, value]) => ({
      name,
      value: value.denominator > 0 ? value.numerator / value.denominator : 0
    }))
    .map((entry) => ({
      ...entry,
      value: scaleToPercent ? normalizePercentPoint(entry.value) : Number(entry.value.toFixed(2))
    }))
    .sort((left, right) => right.value - left.value);

  return { ranked };
}

function buildSegmentSummary(
  rows: DatasetRow[],
  dimension: string,
  valueGetter: (row: DatasetRow) => number | null,
  options?: { ratio?: boolean; denominatorGetter?: (row: DatasetRow) => number | null; scaleToPercent?: boolean }
): SegmentSummary | null {
  const ranked = options?.ratio && options.denominatorGetter
    ? aggregateRatioByDimension(rows, dimension, valueGetter, options.denominatorGetter, options.scaleToPercent).ranked
    : aggregateNumericByDimension(rows, dimension, valueGetter).ranked;

  if (ranked.length === 0) {
    return null;
  }

  const total = options?.ratio ? undefined : ranked.reduce((sum, entry) => sum + entry.value, 0);
  const top = ranked[0];
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return {
    dimension,
    top:
      total && total > 0
        ? {
            ...top,
            share: Number((top.value / total).toFixed(3))
          }
        : top,
    best,
    worst,
    top3Share:
      total && total > 0
        ? Number((ranked.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / total).toFixed(3))
        : undefined
  };
}

function pickDatasetType(profile: DatasetProfile): DatasetType {
  const numericColumns = profile.numericColumns.map(normalizeName);
  const categoricalColumns = profile.categoricalColumns.map(normalizeName);

  const marketingSignals = [
    "revenue",
    "sales value",
    "sales_value",
    "sales",
    "income",
    "gmv",
    "conversion value",
    "cost",
    "spend",
    "outlay",
    "ad spend",
    "ad view",
    "ad_view",
    "click through",
    "click_through",
    "click",
    "impression",
    "closed won",
    "closed_won",
    "conversion rate",
    "ctr",
    "cpc",
    "cpa",
    "roas"
  ];
  const salesSignals = ["order", "deal", "unit", "quantity", "profit", "margin", "sales rep", "opportunity", "lead"];
  const ecommerceSignals = ["refund", "cart", "category", "sku", "product", "checkout", "aov", "average order value", "margin"];

  const marketingScore =
    marketingSignals.filter((signal) => numericColumns.some((column) => column.includes(signal))).length +
    (hasSignal(categoricalColumns, ["channel", "campaign", "device", "source", "medium"]) ? 2 : 0);
  const salesScore =
    salesSignals.filter((signal) => numericColumns.some((column) => column.includes(signal)) || categoricalColumns.some((column) => column.includes(signal))).length +
    (hasSignal(categoricalColumns, ["region", "sales rep", "customer segment", "rep"]) ? 1 : 0);
  const ecommerceScore =
    ecommerceSignals.filter((signal) => numericColumns.some((column) => column.includes(signal)) || categoricalColumns.some((column) => column.includes(signal))).length +
    (hasSignal(categoricalColumns, ["category", "product", "sku", "cart"]) ? 2 : 0);

  if (marketingScore >= 3 && marketingScore >= salesScore && marketingScore >= ecommerceScore) {
    return "marketing";
  }
  if (ecommerceScore >= 3 && ecommerceScore >= salesScore) {
    return "ecommerce";
  }
  if (salesScore >= 3) {
    return "sales";
  }
  return "generic";
}

function pickDimension(profile: DatasetProfile, datasetType: DatasetType, metricKey: MetricKey) {
  const preferences: Record<DatasetType, string[]> = {
    marketing: ["channel", "campaign", "source", "medium", "device", "region", "customer segment", "segment", "funnel stage"],
    sales: ["region", "sales rep", "rep", "product", "category", "customer segment", "channel"],
    ecommerce: ["category", "product", "region", "customer segment", "channel", "device"],
    generic: profile.categoricalColumns
  };

  const ordered = preferences[datasetType];
  const metricSensitivePreferences: Record<MetricKey, string[]> = {
    revenue: ["channel", "campaign", "region", "product", "category"],
    cost: ["channel", "campaign", "device", "region", "product", "category"],
    spend: ["channel", "campaign", "device", "region", "product", "category"],
    roi: ["channel", "campaign", "source", "medium", "region"],
    roas: ["channel", "campaign", "source", "medium", "region"],
    conversion_rate: ["channel", "campaign", "device", "segment", "region", "category"],
    cvr: ["channel", "campaign", "device", "segment", "region", "category"],
    clicks: ["channel", "campaign", "device", "source"],
    impressions: ["channel", "campaign", "device", "source"],
    ctr: ["channel", "campaign", "device", "source"],
    cpc: ["channel", "campaign", "device", "source"],
    cpa: ["channel", "campaign", "device", "source"],
    conversions: ["channel", "campaign", "device", "region", "category"],
    revenue_per_click: ["channel", "campaign", "device", "source"],
    orders: ["region", "product", "category", "channel"],
    average_order_value: ["region", "product", "category", "channel"],
    units_sold: ["product", "category", "region"],
    profit: ["region", "product", "category", "channel"],
    margin: ["region", "product", "category", "channel"],
    refund_rate: ["product", "category", "region"],
    total_value: ["region", "product", "category", "channel"],
    total_quantity: ["product", "category", "region"]
  };

  const candidatePreferences = [...metricSensitivePreferences[metricKey], ...ordered];
  const lowerCandidates = candidatePreferences.map((entry) => entry.toLowerCase());
  return profile.categoricalColumns.find((column) => {
    const normalized = normalizeName(column);
    return lowerCandidates.some((pref) => normalized === pref || normalized.includes(pref));
  });
}

function getMissingWarning(metricName: string, sourceColumns: string[], profile: DatasetProfile) {
  const missingCount = sourceColumns.reduce((sum, column) => sum + (getColumnProfile(profile, column)?.missingCount ?? 0), 0);
  if (missingCount <= 0) {
    return null;
  }

  return `${metricName} may be affected by ${missingCount} missing value${missingCount === 1 ? "" : "s"}.`;
}

function isDirectAggregateMetricKey(key: MetricKey) {
  return (
    key !== "roi" &&
    key !== "roas" &&
    key !== "ctr" &&
    key !== "cvr" &&
    key !== "cpc" &&
    key !== "cpa" &&
    key !== "revenue_per_click" &&
    key !== "average_order_value" &&
    key !== "conversion_rate" &&
    key !== "margin" &&
    key !== "refund_rate"
  );
}

function buildDescription(metricKey: MetricKey, observation: MetricObservation) {
  const fmt = observation.formattedValue;
  const segment = observation.segmentSummary;
  const top = segment?.top?.name;
  const topShare = segment?.top?.share;
  const best = segment?.best?.name;
  const worst = segment?.worst?.name;
  const shareText =
    top && topShare !== undefined ? ` ${top} contributes ${formatPercentPoint(topShare)} of the total.` : "";

  switch (String(metricKey)) {
    case "revenue":
      return `Revenue reached ${fmt}.${shareText} Compare it with ROAS before changing budget.`;
    case "spend":
      return `Spend reached ${fmt}.${shareText} Review it alongside ROAS so budget decisions stay tied to efficiency.`;
    case "roi":
      return `ROI is ${fmt}.${shareText} It measures net return after spend, so compare it with ROAS to see whether growth is actually profitable.`;
    case "roas":
      return `ROAS means every 1 unit of spend brought back about ${fmt.replace(/x$/, "")} units of revenue. Use it to judge whether growth is efficient before increasing budget.`;
    case "cvr":
      return `Conversion rate is ${fmt}.${best ? ` ${best} converts best.` : ""}${worst ? ` ${worst} converts least efficiently.` : ""} Compare it by segment to see whether traffic quality is strong enough.`;
    case "clicks":
      return `Clicks reached ${fmt}.${top ? ` ${top} drives the most traffic.` : ""} Traffic volume should be judged with conversion rate and revenue per click.`;
    case "impressions":
      return `Impressions reached ${fmt}.${top ? ` ${top} contributes the most visibility.` : ""} Visibility matters most when it turns into clicks and revenue.`;
    case "ctr":
      return `CTR is ${fmt}. ${best ? `${best} is turning impressions into clicks most effectively.` : ""} Compare it with impressions and revenue to judge message relevance.`;
    case "cpc":
      return `CPC is ${fmt} ${observation.unit}.${worst ? ` ${worst} is the most expensive segment.` : ""} Lower CPC helps efficiency, but only if click quality stays strong.`;
    case "cpa":
      return `CPA is ${fmt} ${observation.unit}.${worst ? ` ${worst} costs the most per conversion.` : ""} Compare it with revenue and ROAS to judge acquisition efficiency.`;
    case "revenue_per_click":
      return `Revenue per click is ${fmt} ${observation.unit}.${best ? ` ${best} converts traffic into value most efficiently.` : ""} Compare it with ROAS and conversion rate to understand traffic quality.`;
    case "orders":
      return `${observation.label} reached ${fmt}.${top ? ` ${top} contributes the most.` : ""} Compare it with average order value and revenue to see whether growth is broad or concentrated.`;
    case "average_order_value":
      return `Average order value is ${fmt} ${observation.unit}.${best ? ` ${best} has the strongest order value.` : ""} Higher order value can raise revenue without needing more orders.`;
    case "units_sold":
      return `Units sold reached ${fmt}.${top ? ` ${top} contributes the most volume.` : ""} Compare it with revenue and average order value to see whether volume or basket size is driving value.`;
    case "profit":
      return `Profit reached ${fmt}.${shareText} Compare it with revenue and cost to understand whether growth is also profitable.`;
    case "margin":
      return `Margin is ${fmt}.${best ? ` ${best} is the strongest margin segment.` : ""} Compare margin with revenue and profit to check whether scale is efficient.`;
    case "refund_rate":
      return `Refund rate is ${fmt}.${worst ? ` ${worst} is the weakest segment.` : ""} Higher refunds reduce net value, so this should be checked against product quality and customer satisfaction.`;
    case "total_value":
      return `Total value reached ${fmt}.${top ? ` ${top} contributes the most value.` : ""} Compare it with quantity and concentration to see whether the value is broadly distributed.`;
    case "total_quantity":
      return `Total quantity reached ${fmt}.${top ? ` ${top} contributes the most volume.` : ""} Compare it with total value to judge whether volume is turning into commercial value.`;
    default:
      return `${observation.label} is ${fmt}. Compare it with the most related business metric to understand whether it reflects growth, efficiency, or risk.`;
  }
}

function buildContextLine(metricKey: MetricKey, observation: MetricObservation) {
  const segment = observation.segmentSummary;
  if (!segment) {
    return undefined;
  }

  const lowerIsBetter = metricKey === "spend";
  const bestName = lowerIsBetter ? segment.worst?.name : segment.best?.name ?? segment.top?.name;
  const worstName = lowerIsBetter ? segment.top?.name ?? segment.best?.name : segment.worst?.name;

  if (!bestName && !worstName) {
    return undefined;
  }

  if (bestName && worstName) {
    return `Best: ${bestName} · Worst: ${worstName}`;
  }

  return bestName ? `Best: ${bestName}` : `Worst: ${worstName}`;
}

function buildMetricObservation(
  key: MetricKey,
  rows: DatasetRow[],
  profile: DatasetProfile,
  datasetType: DatasetType,
  currencyCode: string
): MetricObservation | null {
  const metricDefinitions: Record<MetricKey, { label: string; metricType: KpiMetricType; unit: string; priority: Record<DatasetType, number>; sourceColumns: string[] }> = {
    revenue: {
      label: "Revenue",
      metricType: "currency",
      unit: "",
      priority: { marketing: 100, sales: 100, ecommerce: 100, generic: 96 },
      sourceColumns: ["revenue", "sales_value", "sales", "income", "gmv", "conversion_value"]
    },
    cost: {
      label: "Cost",
      metricType: "currency",
      unit: "",
      priority: { marketing: 94, sales: 70, ecommerce: 68, generic: 84 },
      sourceColumns: ["cost", "spend", "total_outlay", "all_in_spend", "ad_spend", "budget"]
    },
    spend: {
      label: "Spend",
      metricType: "currency",
      unit: "",
      priority: { marketing: 95, sales: 72, ecommerce: 70, generic: 86 },
      sourceColumns: ["spend", "all_in_spend", "total_outlay", "cost", "ad_spend", "budget"]
    },
    roi: {
      label: "ROI",
      metricType: "ratio",
      unit: "x",
      priority: { marketing: 60, sales: 56, ecommerce: 56, generic: 54 },
      sourceColumns: ["revenue", "cost", "spend", "profit"]
    },
    roas: {
      label: "ROAS",
      metricType: "ratio",
      unit: "x",
      priority: { marketing: 92, sales: 68, ecommerce: 66, generic: 64 },
      sourceColumns: ["revenue", "spend"]
    },
    conversion_rate: {
      label: "Conversion Rate",
      metricType: "percentage",
      unit: "%",
      priority: { marketing: 88, sales: 86, ecommerce: 88, generic: 56 },
      sourceColumns: ["conversion_rate", "conv_rate", "cvr", "conversions", "closed_won_count", "clicks", "click_through_count"]
    },
    cvr: {
      label: "Conversion Rate",
      metricType: "percentage",
      unit: "%",
      priority: { marketing: 90, sales: 88, ecommerce: 90, generic: 58 },
      sourceColumns: ["cvr", "conversion_rate", "conversions", "closed_won_count", "clicks", "click_through_count"]
    },
    conversions: {
      label: "Conversions",
      metricType: "count",
      unit: "conversions",
      priority: { marketing: 84, sales: 86, ecommerce: 90, generic: 60 },
      sourceColumns: ["conversions", "conversion_count", "closed_won_count", "orders", "purchases"]
    },
    clicks: {
      label: "Clicks",
      metricType: "count",
      unit: "clicks",
      priority: { marketing: 85, sales: 60, ecommerce: 62, generic: 52 },
      sourceColumns: ["clicks", "click_count", "click_through_count"]
    },
    impressions: {
      label: "Impressions",
      metricType: "count",
      unit: "impressions",
      priority: { marketing: 80, sales: 40, ecommerce: 40, generic: 46 },
      sourceColumns: ["impressions", "views", "ad_view_count", "ad_views"]
    },
    ctr: {
      label: "CTR",
      metricType: "percentage",
      unit: "%",
      priority: { marketing: 78, sales: 40, ecommerce: 40, generic: 48 },
      sourceColumns: ["clicks", "click_through_count", "impressions", "ad_view_count", "ctr"]
    },
    cpc: {
      label: "CPC",
      metricType: "rate",
      unit: `${getCurrencySymbol(currencyCode)} / click`,
      priority: { marketing: 76, sales: 44, ecommerce: 44, generic: 42 },
      sourceColumns: ["spend", "cost", "clicks"]
    },
    cpa: {
      label: "CPA",
      metricType: "rate",
      unit: `${getCurrencySymbol(currencyCode)} / conversion`,
      priority: { marketing: 74, sales: 46, ecommerce: 46, generic: 40 },
      sourceColumns: ["spend", "cost", "conversions"]
    },
    revenue_per_click: {
      label: "Revenue / Click",
      metricType: "rate",
      unit: `${getCurrencySymbol(currencyCode)} / click`,
      priority: { marketing: 72, sales: 42, ecommerce: 42, generic: 38 },
      sourceColumns: ["revenue", "clicks"]
    },
    orders: {
      label: "Orders",
      metricType: "count",
      unit: "orders",
      priority: { marketing: 66, sales: 95, ecommerce: 96, generic: 54 },
      sourceColumns: ["orders", "deals", "order_count"]
    },
    average_order_value: {
      label: "Average Order Value",
      metricType: "rate",
      unit: `${getCurrencySymbol(currencyCode)} / order`,
      priority: { marketing: 60, sales: 92, ecommerce: 92, generic: 48 },
      sourceColumns: ["revenue", "orders", "deals", "aov", "average_order_value"]
    },
    units_sold: {
      label: "Units Sold",
      metricType: "count",
      unit: "units",
      priority: { marketing: 52, sales: 88, ecommerce: 88, generic: 50 },
      sourceColumns: ["units", "quantity", "qty"]
    },
    profit: {
      label: "Profit",
      metricType: "currency",
      unit: "",
      priority: { marketing: 62, sales: 84, ecommerce: 84, generic: 82 },
      sourceColumns: ["profit"]
    },
    margin: {
      label: "Margin",
      metricType: "percentage",
      unit: "%",
      priority: { marketing: 58, sales: 82, ecommerce: 86, generic: 54 },
      sourceColumns: ["margin", "gross_margin"]
    },
    refund_rate: {
      label: "Refund Rate",
      metricType: "percentage",
      unit: "%",
      priority: { marketing: 30, sales: 32, ecommerce: 84, generic: 28 },
      sourceColumns: ["refund_rate", "refunds"]
    },
    total_value: {
      label: "Total Value",
      metricType: "currency",
      unit: "",
      priority: { marketing: 46, sales: 66, ecommerce: 66, generic: 94 },
      sourceColumns: ["value", "amount", "total_value"]
    },
    total_quantity: {
      label: "Total Quantity",
      metricType: "count",
      unit: "units",
      priority: { marketing: 44, sales: 64, ecommerce: 64, generic: 90 },
      sourceColumns: ["quantity", "count", "total_quantity", "units"]
    }
  };

  const config = metricDefinitions[key];
  const matchedColumns = config.sourceColumns.map((alias) => findColumn(profile, [alias])).filter((value): value is string => Boolean(value));
  const uniqueColumns = [...new Set(matchedColumns)];
  const metricKey = key as MetricKey;
  if (isDirectAggregateMetricKey(metricKey)) {
    const sourceColumn = uniqueColumns[0];
    if (!sourceColumn) {
      return null;
    }

    const value = sumColumn(rows, sourceColumn);
    if (!Number.isFinite(value)) {
      return null;
    }

    const dimension = pickDimension(profile, datasetType, key);
    const segmentSummary = dimension
      ? buildSegmentSummary(rows, dimension, (row) => parseNumber(row[sourceColumn]))
      : null;
    const formattedValue = config.metricType === "count"
      ? formatCount(value)
      : formatCurrencyLike(value, currencyCode);

    const observation: MetricObservation = {
      key: metricKey,
      label: metricKey === "spend" ? "Spend" : metricKey === "revenue" && sourceColumn.includes("sales") ? "Sales" : config.label,
      value: Number(value.toFixed(2)),
      formattedValue,
      unit: config.unit,
      metricType: config.metricType,
      description: "",
      formula: `sum(${sourceColumn})`,
      reliability: getColumnProfile(profile, sourceColumn)?.missingCount ? "medium" : "high",
      priority: config.priority[datasetType],
      warnings: [],
      sourceColumns: [sourceColumn],
      relatedDimension: dimension ?? undefined,
      segmentSummary: segmentSummary ?? undefined
    };

    observation.warnings = [];
    const warning = getMissingWarning(observation.label, observation.sourceColumns, profile);
    if (warning) {
      observation.warnings.push(warning);
      observation.reliability = observation.reliability === "high" ? "medium" : observation.reliability;
    }
    observation.contextLine = buildContextLine(metricKey, observation);
    observation.description = buildDescription(metricKey, observation);
    return observation;
  }

  const dimension = pickDimension(profile, datasetType, key);
  if (!dimension) {
    return null;
  }

  let value: number | null = null;
  let formula = "";
  let segmentSummary: SegmentSummary | null = null;
  let reliability: KpiReliability = "high";
  const warnings: string[] = [];
  let sourceColumns: string[] = [];

  switch (String(metricKey)) {
    case "spend": {
      const spendColumn =
        pickBestNumericColumn(profile, ["spend", "all_in_spend", "total_outlay", "cost", "ad_spend", "budget"]);
      if (!spendColumn) {
        return null;
      }
      const spendTotal = sumColumn(rows, spendColumn);
      value = spendTotal;
      formula = `sum(${spendColumn})`;
      sourceColumns = [spendColumn];
      reliability = getColumnProfile(profile, spendColumn)?.missingCount ? "medium" : "high";
      warnings.push(...[getMissingWarning("Spend", sourceColumns, profile)].filter(Boolean) as string[]);
      segmentSummary = buildSegmentSummary(rows, dimension, (row) => parseNumber(row[spendColumn]));
      break;
    }
    case "roas": {
      const revenueColumn = pickBestNumericColumn(profile, ["revenue", "sales_value", "sales", "income", "gmv", "conversion_value"]);
      const spendColumn = pickBestNumericColumn(profile, ["spend", "all_in_spend", "total_outlay", "cost", "ad_spend", "budget"]);
      if (!revenueColumn || !spendColumn) {
        return null;
      }
      const revenueTotal = sumColumn(rows, revenueColumn);
      const spendTotal = sumColumn(rows, spendColumn);
      if (spendTotal <= 0) {
        return null;
      }
      value = Number((revenueTotal / spendTotal).toFixed(2));
      formula = `sum(${revenueColumn}) / sum(${spendColumn})`;
      sourceColumns = [revenueColumn, spendColumn];
      reliability = getColumnProfile(profile, revenueColumn)?.missingCount || getColumnProfile(profile, spendColumn)?.missingCount ? "medium" : "high";
      warnings.push(...[getMissingWarning("ROAS", sourceColumns, profile)].filter(Boolean) as string[]);
      segmentSummary = buildSegmentSummary(
        rows,
        dimension,
        (row) => parseNumber(row[revenueColumn]),
        {
          ratio: true,
          denominatorGetter: (row) => parseNumber(row[spendColumn]),
          scaleToPercent: false
        }
      );
      break;
    }
    case "cvr": {
      const conversionColumn = pickBestNumericColumn(profile, ["conversions", "closed_won_count", "orders", "deals"]);
      const clickColumn = pickBestNumericColumn(profile, ["clicks", "click_through_count", "click_count"]);
      const rateColumn = findColumn(profile, ["conversion_rate", "conv_rate", "cvr"]);
      sourceColumns = [...new Set([conversionColumn, clickColumn, rateColumn].filter((value): value is string => Boolean(value)))];

      if (conversionColumn && clickColumn) {
        const conversions = sumColumn(rows, conversionColumn);
        const clicks = sumColumn(rows, clickColumn);
        if (clicks <= 0) {
          return null;
        }
        value = normalizePercentPoint(conversions / clicks);
        formula = `sum(${conversionColumn}) / sum(${clickColumn})`;
        segmentSummary = buildSegmentSummary(
          rows,
          dimension,
          (row) => parseNumber(row[conversionColumn]),
          {
            ratio: true,
            denominatorGetter: (row) => parseNumber(row[clickColumn]),
            scaleToPercent: true
          }
        );
      } else if (rateColumn && clickColumn) {
        const weighted = weightedRate(rows, rateColumn, clickColumn);
        if (weighted === null) {
          return null;
        }
        value = normalizePercentPoint(weighted);
        formula = `weighted_average(${rateColumn}, weight=${clickColumn})`;
        segmentSummary = buildSegmentSummary(
          rows,
          dimension,
          (row) => parseNumber(row[rateColumn]) !== null && parseNumber(row[clickColumn]) !== null
            ? (parseNumber(row[rateColumn]) as number) * (parseNumber(row[clickColumn]) as number)
            : null,
          {
            ratio: true,
            denominatorGetter: (row) => parseNumber(row[clickColumn]),
            scaleToPercent: true
          }
        );
      } else if (rateColumn) {
        const weighted = weightedRate(rows, rateColumn);
        if (weighted === null) {
          return null;
        }
        value = normalizePercentPoint(weighted);
        formula = `average(${rateColumn})`;
        segmentSummary = buildSegmentSummary(
          rows,
          dimension,
          (row) => parseNumber(row[rateColumn]),
          {
            ratio: true,
            denominatorGetter: () => 1,
            scaleToPercent: true
          }
        );
      } else {
        return null;
      }
      reliability = sourceColumns.some((column) => (getColumnProfile(profile, column)?.missingCount ?? 0) > 0) ? "medium" : "high";
      warnings.push(...[getMissingWarning("Conversion Rate", sourceColumns, profile)].filter(Boolean) as string[]);
      break;
    }
    case "ctr": {
      const clickColumn = pickBestNumericColumn(profile, ["clicks", "click_through_count", "click_count"]);
      const impressionColumn = pickBestNumericColumn(profile, ["impressions", "ad_view_count", "views"]);
      const rateColumn = findColumn(profile, ["ctr"]);
      sourceColumns = [...new Set([clickColumn, impressionColumn, rateColumn].filter((value): value is string => Boolean(value)))];

      if (clickColumn && impressionColumn) {
        const clicks = sumColumn(rows, clickColumn);
        const impressions = sumColumn(rows, impressionColumn);
        if (impressions <= 0) {
          return null;
        }
        value = normalizePercentPoint(clicks / impressions);
        formula = `sum(${clickColumn}) / sum(${impressionColumn})`;
        segmentSummary = buildSegmentSummary(
          rows,
          dimension,
          (row) => parseNumber(row[clickColumn]),
          {
            ratio: true,
            denominatorGetter: (row) => parseNumber(row[impressionColumn]),
            scaleToPercent: true
          }
        );
      } else if (rateColumn) {
        const weighted = weightedRate(rows, rateColumn, impressionColumn ?? undefined);
        if (weighted === null) {
          return null;
        }
        value = normalizePercentPoint(weighted);
        formula = impressionColumn ? `weighted_average(${rateColumn}, weight=${impressionColumn})` : `average(${rateColumn})`;
        segmentSummary = buildSegmentSummary(
          rows,
          dimension,
          (row) => {
            const rate = parseNumber(row[rateColumn]);
            const weight = impressionColumn ? parseNumber(row[impressionColumn]) : 1;
            return rate !== null && weight !== null && weight > 0 ? rate * weight : null;
          },
          {
            ratio: true,
            denominatorGetter: (row) => (impressionColumn ? parseNumber(row[impressionColumn]) : 1),
            scaleToPercent: true
          }
        );
      } else {
        return null;
      }
      reliability = sourceColumns.some((column) => (getColumnProfile(profile, column)?.missingCount ?? 0) > 0) ? "medium" : "high";
      warnings.push(...[getMissingWarning("CTR", sourceColumns, profile)].filter(Boolean) as string[]);
      break;
    }
    case "cpc":
    case "cpa":
    case "revenue_per_click":
    case "average_order_value":
    case "margin": {
      const numeratorColumn =
        key === "cpc"
          ? findColumn(profile, ["cost", "spend", "ad_spend", "budget"])
          : key === "cpa"
            ? findColumn(profile, ["cost", "spend", "ad_spend", "budget"])
            : key === "revenue_per_click"
              ? findColumn(profile, ["revenue", "sales", "income", "gmv", "conversion_value"])
              : key === "average_order_value"
                ? findColumn(profile, ["revenue", "sales", "income", "gmv", "conversion_value"])
                : findColumn(profile, ["margin", "gross_margin"]);
      const denominatorColumn =
        key === "cpc"
          ? findColumn(profile, ["clicks", "click_count"])
          : key === "cpa"
            ? findColumn(profile, ["conversions", "orders", "deals"])
            : key === "revenue_per_click"
              ? findColumn(profile, ["clicks", "click_count"])
              : key === "average_order_value"
                ? findColumn(profile, ["orders", "deals", "order_count"])
                : findColumn(profile, ["revenue", "sales", "income", "gmv", "conversion_value"]);

      const rateColumn = key === "margin" ? findColumn(profile, ["margin", "gross_margin"]) : undefined;
      sourceColumns = [...new Set([numeratorColumn, denominatorColumn, rateColumn].filter((value): value is string => Boolean(value)))];
      if (!numeratorColumn && !rateColumn) {
        return null;
      }

      if (key === "margin" && rateColumn) {
        const weighted = weightedRate(rows, rateColumn, denominatorColumn ?? undefined);
        if (weighted === null) {
          return null;
        }
        value = normalizePercentPoint(weighted);
        formula = denominatorColumn ? `weighted_average(${rateColumn}, weight=${denominatorColumn})` : `average(${rateColumn})`;
        segmentSummary = buildSegmentSummary(
          rows,
          dimension,
          (row) => {
            const rate = parseNumber(row[rateColumn]);
            const weight = denominatorColumn ? parseNumber(row[denominatorColumn]) : 1;
            return rate !== null && weight !== null && weight > 0 ? rate * weight : null;
          },
          {
            ratio: true,
            denominatorGetter: (row) => (denominatorColumn ? parseNumber(row[denominatorColumn]) : 1),
            scaleToPercent: true
          }
        );
      } else if (numeratorColumn && denominatorColumn) {
        const ratio = ratioFromRows(rows, numeratorColumn, denominatorColumn);
        if (ratio === null) {
          return null;
        }
        value = Number(ratio.toFixed(2));
        formula = `sum(${numeratorColumn}) / sum(${denominatorColumn})`;
        segmentSummary = buildSegmentSummary(
          rows,
          dimension,
          (row) => parseNumber(row[numeratorColumn]),
          {
            ratio: true,
            denominatorGetter: (row) => parseNumber(row[denominatorColumn]),
            scaleToPercent: false
          }
        );
      } else {
        return null;
      }

      if (value === null || !Number.isFinite(value)) {
        return null;
      }

      reliability = sourceColumns.some((column) => (getColumnProfile(profile, column)?.missingCount ?? 0) > 0) ? "medium" : "high";
      warnings.push(...[getMissingWarning(config.label, sourceColumns, profile)].filter(Boolean) as string[]);
      break;
    }
    case "refund_rate": {
      const rateColumn = findColumn(profile, ["refund_rate", "refunds"]);
      const ordersColumn = findColumn(profile, ["orders", "order_count", "deals"]);
      sourceColumns = [...new Set([rateColumn, ordersColumn].filter((value): value is string => Boolean(value)))];
      if (!rateColumn) {
        return null;
      }

      const weighted = weightedRate(rows, rateColumn, ordersColumn ?? undefined);
      if (weighted === null) {
        return null;
      }

      value = normalizePercentPoint(weighted);
      formula = ordersColumn ? `weighted_average(${rateColumn}, weight=${ordersColumn})` : `average(${rateColumn})`;
      segmentSummary = buildSegmentSummary(
        rows,
        dimension,
        (row) => {
          const rate = parseNumber(row[rateColumn]);
          const weight = ordersColumn ? parseNumber(row[ordersColumn]) : 1;
          return rate !== null && weight !== null && weight > 0 ? rate * weight : null;
        },
        {
          ratio: true,
          denominatorGetter: (row) => (ordersColumn ? parseNumber(row[ordersColumn]) : 1),
          scaleToPercent: true
        }
      );
      reliability = sourceColumns.some((column) => (getColumnProfile(profile, column)?.missingCount ?? 0) > 0) ? "medium" : "high";
      warnings.push(...[getMissingWarning("Refund Rate", sourceColumns, profile)].filter(Boolean) as string[]);
      break;
    }
  }

  if (value === null) {
    return null;
  }

  const formattedValue =
    String(metricKey) === "roas"
      ? formatRatio(value)
      : ["cvr", "ctr", "margin", "refund_rate"].includes(String(metricKey))
        ? formatPercentPoint(value)
        : ["cpc", "cpa", "revenue_per_click", "average_order_value"].includes(String(metricKey))
            ? formatCurrencyLike(value, currencyCode)
            : config.metricType === "currency"
              ? formatCurrencyLike(value, currencyCode)
              : formatGenericNumber(value);

  const label = config.label;

  const observation: MetricObservation = {
      key: metricKey,
    label,
    value: Number(value.toFixed(2)),
    formattedValue,
    unit:
      String(metricKey) === "roas"
        ? "x"
        : ["cvr", "ctr", "margin", "refund_rate"].includes(String(metricKey))
          ? "%"
          : config.unit,
    metricType: config.metricType,
    description: "",
    formula,
    reliability,
    priority: config.priority[datasetType],
    warnings,
    sourceColumns,
    relatedDimension: dimension,
    segmentSummary: segmentSummary ?? undefined
  };
  observation.contextLine = buildContextLine(key, observation);
  observation.description = buildDescription(key, observation);
  return observation;
}

function buildGenericFallbackObservations(
  rows: DatasetRow[],
  profile: DatasetProfile,
  datasetType: DatasetType,
  currencyCode: string
) {
  const genericHints = [
    "revenue",
    "sales",
    "income",
    "gmv",
    "value",
    "amount",
    "cost",
    "spend",
    "profit",
    "orders",
    "order",
    "quantity",
    "units",
    "count",
    "score",
    "rate"
  ];

  const sortedColumns = [...profile.numericColumns].sort((left, right) => {
    const leftIndex = genericHints.findIndex((hint) => normalizeName(left).includes(hint));
    const rightIndex = genericHints.findIndex((hint) => normalizeName(right).includes(hint));
    return (leftIndex === -1 ? genericHints.length : leftIndex) - (rightIndex === -1 ? genericHints.length : rightIndex);
  });

  const observations: MetricObservation[] = [];
  for (const column of sortedColumns) {
    if (observations.length >= 6) {
      break;
    }

    const value = sumColumn(rows, column);
    if (!Number.isFinite(value)) {
      continue;
    }

    const label = humanize(column).replace(/\bTotal\s+/i, "").trim();
    const dimension = pickDimension(profile, datasetType, "total_value");
    const segmentSummary = dimension ? buildSegmentSummary(rows, dimension, (row) => parseNumber(row[column])) : null;
    const observation: MetricObservation = {
      key: "total_value",
      label,
      value: Number(value.toFixed(2)),
      formattedValue: /revenue|sales|income|gmv|value|amount|cost|spend|profit/i.test(label)
        ? formatCurrencyLike(value, currencyCode)
        : formatGenericNumber(value),
      unit: "",
      metricType: /revenue|sales|income|gmv|value|amount|cost|spend|profit/i.test(label) ? "currency" : "generic_number",
      description: `The ${label.toLowerCase()} metric reached ${/revenue|sales|income|gmv|value|amount|cost|spend|profit/i.test(label) ? formatCurrencyLike(value, currencyCode) : formatGenericNumber(value)}. Compare it with the most related business metric to see whether this number reflects growth or noise.`,
      formula: `sum(${column})`,
      reliability: getColumnProfile(profile, column)?.missingCount ? "medium" : "high",
      priority: 40,
      warnings: [],
      sourceColumns: [column],
      relatedDimension: dimension,
      segmentSummary: segmentSummary ?? undefined
    };
    const warning = getMissingWarning(label, [column], profile);
    if (warning) {
      observation.warnings.push(warning);
      observation.reliability = observation.reliability === "high" ? "medium" : observation.reliability;
    }
    observation.contextLine = buildContextLine("total_value", observation);
    observations.push(observation);
  }

  return observations;
}

function buildObservationId(observation: MetricObservation) {
  return `${observation.key}:${observation.sourceColumns[0] ?? observation.label}`;
}

function getCandidateOrder(datasetType: DatasetType) {
  const orders: Record<DatasetType, MetricKey[]> = {
    marketing: ["revenue", "spend", "roas", "cvr", "ctr", "clicks", "impressions", "conversions"],
    sales: ["revenue", "spend", "roas", "cvr", "ctr", "clicks", "impressions", "conversions"],
    ecommerce: ["revenue", "spend", "roas", "cvr", "ctr", "clicks", "impressions", "conversions"],
    generic: ["revenue", "spend", "roas", "cvr", "ctr", "clicks", "impressions", "conversions"]
  };

  return orders[datasetType];
}

function toKpiCandidate(observation: MetricObservation): KpiCandidate {
  return {
    id: buildObservationId(observation),
    label: observation.label,
    column: observation.sourceColumns[0] ?? observation.formula,
    confidence: observation.reliability === "high" ? 0.98 : observation.reliability === "medium" ? 0.86 : 0.72,
    summary: observation.description,
    aggregateValue: observation.value
  };
}

export function buildKpiObservations(rows: DatasetRow[], profile: DatasetProfile) {
  const datasetType = pickDatasetType(profile);
  const currencyCode = getConfiguredCurrencyCode();
  const observations: Partial<Record<MetricKey, MetricObservation>> = {};

  const keys: MetricKey[] = [
    "revenue",
    "spend",
    "roas",
    "cvr",
    "clicks",
    "impressions",
    "ctr",
    "conversions"
  ];

  for (const key of keys) {
    observations[key] = buildMetricObservation(key, rows, profile, datasetType, currencyCode) ?? undefined;
  }

  const fallbackObservations = datasetType === "generic" ? buildGenericFallbackObservations(rows, profile, datasetType, currencyCode) : [];

  return {
    datasetType,
    observations,
    fallbackObservations
  };
}

export function buildKpiCandidates(rows: DatasetRow[], profile: DatasetProfile): KpiCandidate[] {
  const semanticCandidates = buildSemanticKpiCandidates(rows, profile);
  if (semanticCandidates.length > 0) {
    return semanticCandidates;
  }

  const intelligence = buildKpiObservations(rows, profile);
  const preferredOrder = getCandidateOrder(intelligence.datasetType);
  const candidates: KpiCandidate[] = [];

  for (const key of preferredOrder) {
    const observation = intelligence.observations[key];
    if (observation) {
      candidates.push(toKpiCandidate(observation));
    }
  }

  for (const observation of intelligence.fallbackObservations) {
    if (candidates.length >= 10) {
      break;
    }
    candidates.push(toKpiCandidate(observation));
  }

  const selectedIds = new Set(candidates.map((candidate) => candidate.id));
  const remaining = Object.values(intelligence.observations)
    .filter((observation): observation is MetricObservation => Boolean(observation))
    .filter((observation) => !selectedIds.has(buildObservationId(observation)))
    .sort((left, right) => right.priority - left.priority || right.reliability.localeCompare(left.reliability));

  for (const observation of remaining) {
    candidates.push(toKpiCandidate(observation));
  }

  return candidates;
}

export function buildKpiCards(rows: DatasetRow[], profile: DatasetProfile): KpiCard[] {
  const semanticCards = buildSemanticKpiCards(rows, profile);
  if (hasCallTrackingSemanticContract(profile)) {
    return semanticCards.slice(0, 4);
  }

  const intelligence = buildKpiObservations(rows, profile);
  const preferredOrder = getCandidateOrder(intelligence.datasetType);
  const cards: KpiCard[] = [];

  for (const key of preferredOrder) {
    const observation = intelligence.observations[key];
    if (!observation) {
      continue;
    }

    cards.push({
      id: buildObservationId(observation),
      label: observation.label,
      value: observation.value,
      formattedValue: observation.formattedValue,
      unit: observation.unit,
      metricType: observation.metricType,
      description: observation.description,
      formula: observation.formula,
      reliability: observation.reliability,
      priority: observation.priority,
      warnings: observation.warnings.length > 0 ? observation.warnings : undefined,
      relatedDimension: observation.relatedDimension,
      contextLine: observation.contextLine
    });

    if (cards.length === 5) {
      return cards;
    }
  }

    const fallbackCards = intelligence.fallbackObservations
    .sort((left, right) => right.priority - left.priority)
    .map((observation) => ({
      id: buildObservationId(observation),
      label: observation.label,
      value: observation.value,
      formattedValue: observation.formattedValue,
      unit: observation.unit,
      metricType: observation.metricType,
      description: observation.description,
      formula: observation.formula,
      reliability: observation.reliability,
      priority: observation.priority,
      warnings: observation.warnings.length > 0 ? observation.warnings : undefined,
      relatedDimension: observation.relatedDimension,
      contextLine: observation.contextLine
    }));

  for (const card of fallbackCards) {
    if (cards.length >= 4) {
      break;
    }
    if (!cards.some((existing) => existing.id === card.id)) {
      cards.push(card);
    }
  }

  if (cards.length < 4) {
    const remaining = Object.values(intelligence.observations)
      .filter((observation): observation is MetricObservation => Boolean(observation))
      .sort((left, right) => right.priority - left.priority);

    for (const observation of remaining) {
      if (cards.length >= 4) {
        break;
      }
      if (!cards.some((existing) => existing.id === buildObservationId(observation))) {
        cards.push({
          id: buildObservationId(observation),
          label: observation.label,
          value: observation.value,
          formattedValue: observation.formattedValue,
          unit: observation.unit,
          metricType: observation.metricType,
          description: observation.description,
          formula: observation.formula,
          reliability: observation.reliability,
          priority: observation.priority,
          warnings: observation.warnings.length > 0 ? observation.warnings : undefined,
          relatedDimension: observation.relatedDimension,
          contextLine: observation.contextLine
        });
      }
    }
  }

  return cards.slice(0, 4);
}
