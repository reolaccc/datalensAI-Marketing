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
  detectCallDatasetGrain,
  hasReliablePaidSpend,
  normalizeSemanticDimensionValue,
  resolveSemanticDimensionSourceColumn,
  resolveSemanticMetricValue
} from "./semanticContract.js";

type DatasetType = "marketing" | "sales" | "ecommerce" | "generic";
type DomainSemanticProfile = {
  domain: "call_tracking" | "marketing" | "operations" | "retail" | "energy" | "generic";
  confidence: "strong" | "partial" | "weak";
  kpiExplanationMode: "domain_aware" | "neutral";
  allowedLanguageHints: string[];
  avoidLanguageHints: string[];
};
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

function resolveDomainSemanticProfile(profile: DatasetProfile, datasetType: DatasetType): DomainSemanticProfile {
  const semanticDomain = profile.semanticContract?.detectedDomain;
  const domain = semanticDomain?.domain;
  if (
    domain === "call_tracking" ||
    domain === "mixed_call_tracking_attribution" ||
    domain === "call_operations"
  ) {
    return {
      domain: "call_tracking",
      confidence: (semanticDomain?.confidence ?? 0) >= 0.65 ? "strong" : "partial",
      kpiExplanationMode: "domain_aware",
      allowedLanguageHints: ["calls", "qualified calls", "spend", "revenue", "ROAS"],
      avoidLanguageHints: []
    };
  }

  if (datasetType === "marketing") {
    return {
      domain: "marketing",
      confidence: "partial",
      kpiExplanationMode: "domain_aware",
      allowedLanguageHints: ["revenue", "spend", "conversion", "traffic"],
      avoidLanguageHints: []
    };
  }

  return {
    domain: "generic",
    confidence: "weak",
    kpiExplanationMode: "neutral",
    allowedLanguageHints: ["metric value", "total", "average", "selected period"],
    avoidLanguageHints: [
      "most related business metric",
      "growth or noise",
      "strongest signal",
      "business impact",
      "performance driver",
      "optimization opportunity"
    ]
  };
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
  const domain = String(profile.semanticContract?.detectedDomain?.domain ?? "");
  if (
    domain === "call_tracking" ||
    domain === "call_operations" ||
    domain === "marketing_attribution" ||
    domain === "mixed_call_tracking_attribution" ||
    domain === "call_tracking_operations"
  ) {
    return true;
  }

  const contract = profile.semanticContract;
  return Boolean(
    contract?.metricResolutions.calls &&
      (
        contract.metricResolutions.qualifiedCall ||
        contract.metricResolutions.convertedCall ||
        contract.metricResolutions.missedCall ||
        contract.metricResolutions.callDuration ||
        contract.dimensionResolutions.campaign ||
        contract.dimensionResolutions.source ||
        contract.dimensionResolutions.channel
      )
  );
}

type CallKpiMode = "attribution" | "operations";

function buildSemanticRoleSet(profile: DatasetProfile) {
  return new Set(
    profile.semanticContract?.roleMappings
      ?.filter((mapping) => mapping.semanticRole && mapping.confidence >= 0.5)
      .map((mapping) => mapping.semanticRole as string) ?? []
  );
}

function getCallKpiMode(profile: DatasetProfile, roleSet: Set<string>): CallKpiMode {
  const domain = String(profile.semanticContract?.detectedDomain?.domain ?? "");

  if (domain === "call_operations") {
    return "operations";
  }

  if (domain === "marketing_attribution" || domain === "mixed_call_tracking_attribution") {
    return "attribution";
  }

  if (domain === "call_tracking") {
    const hasCommercialSignals = [
      "revenue",
      "spend",
      "qualifiedCall",
      "convertedCall",
      "roas",
      "revenue_per_call",
      "cost_per_qualified_call"
    ].some((role) => roleSet.has(role));
    return hasCommercialSignals ? "attribution" : "operations";
  }

  return "operations";
}

function hasStrongCallTrackingSignals(roleSet: Set<string>) {
  return [
    "callId",
    "callerNumber",
    "qualifiedCall",
    "missedCall",
    "answeredCall",
    "repeatCaller",
    "callDuration",
    "talkTime",
    "handleTime",
    "waitTime",
    "ringTime"
  ].some((role) => roleSet.has(role));
}

function profileHasAnyColumn(profile: DatasetProfile, patterns: RegExp[]) {
  const names = [
    ...profile.columns.map((column) => column.name),
    ...profile.numericColumns,
    ...profile.categoricalColumns,
    ...profile.datetimeColumns
  ].map((name) => normalizeName(name));

  return names.some((name) => patterns.some((pattern) => pattern.test(name)));
}

function isCrmPipelineProfile(profile: DatasetProfile) {
  const stage = profileHasAnyColumn(profile, [/\bcustomer journey\b/, /\bjourney\b/, /\blifecycle\b/, /\bsales stage\b/, /\bpipeline\b/]);
  const followUp = profileHasAnyColumn(profile, [/\bcallback\b/, /\bcontact attempts\b/, /\bfollow up\b/, /\brecontact\b/]);
  const owner = profileHasAnyColumn(profile, [/\bowner team\b/, /\bowner pod\b/, /\bsales owner\b/, /\baccount owner\b/]);
  const outcome = profileHasAnyColumn(profile, [/\bclosed won\b/, /\bdeal won\b/, /\bopportunity\b/]);
  const value = profileHasAnyColumn(profile, [/\bestimated pipeline value\b/, /\bexpected pipeline amount\b/, /\brealized revenue\b/]);
  const explicitCall = profileHasAnyColumn(profile, [/\bcall uid\b/, /\bcall id\b/, /\bcaller number\b/, /\btracking number\b/, /\bcall started\b/, /\btalk time\b/]);

  return !explicitCall && stage && [followUp, owner, outcome, value].filter(Boolean).length >= 2;
}

function getSemanticKpiBusinessPriority(key: string, mode: CallKpiMode, callFocused = true) {
  const callAttributionPriorities: Record<string, number> = {
    total_calls: 1000,
    qualified_calls: 990,
    qualified_call_rate: 980,
    conversion_rate: 970,
    cost_per_qualified_call: 960,
    missed_call_rate: 950,
    total_revenue: 940,
    roas: 930,
    revenue_per_call: 920,
    total_spend: 760,
    cost_per_conversion: 750,
    converted_calls: 740,
    unique_callers: 420,
    answered_call_rate: 410,
    avg_call_duration: 400,
    repeat_caller_rate: 390
  };

  const commercialAttributionPriorities: Record<string, number> = {
    roas: 1000,
    total_revenue: 990,
    total_spend: 980,
    cost_per_conversion: 970,
    converted_calls: 960,
    conversion_rate: 950,
    qualified_calls: 500,
    qualified_call_rate: 490,
    total_calls: 480,
    cost_per_qualified_call: 470,
    revenue_per_call: 460,
    unique_callers: 220,
    missed_call_rate: 210,
    answered_call_rate: 200,
    avg_call_duration: 190,
    repeat_caller_rate: 180
  };

  const operationsPriorities: Record<string, number> = {
    total_calls: 1000,
    unique_callers: 980,
    missed_call_rate: 970,
    avg_call_duration: 960,
    repeat_caller_rate: 950,
    answered_call_rate: 940,
    qualified_calls: 930,
    qualified_call_rate: 920,
    conversion_rate: 910,
    converted_calls: 900,
    total_revenue: 100,
    revenue_per_call: 90,
    total_spend: 80,
    roas: 70,
    cost_per_qualified_call: 60,
    cost_per_conversion: 50
  };

  const priorities =
    mode === "attribution"
      ? callFocused
        ? callAttributionPriorities
        : commercialAttributionPriorities
      : operationsPriorities;
  return priorities[key] ?? 0;
}

function findSemanticSourceColumn(profile: DatasetProfile, role: string) {
  return (
    profile.semanticContract?.metricResolutions?.[role]?.sourceColumns?.[0] ??
    profile.semanticContract?.dimensionResolutions?.[role]?.sourceColumns?.[0] ??
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

function sourceColumnMeaning(sourceColumn?: string | null) {
  const normalized = normalizeName(String(sourceColumn ?? ""));
  if (/\bleads?\b/.test(normalized)) {
    return { singular: "lead", plural: "leads" };
  }
  if (/\bcalls?\b|call id|call uid|phone call/.test(normalized)) {
    return { singular: "call", plural: "calls" };
  }
  if (/\bsessions?\b/.test(normalized)) {
    return { singular: "session", plural: "sessions" };
  }
  if (/\bvisits?\b/.test(normalized)) {
    return { singular: "visit", plural: "visits" };
  }
  if (/\borders?\b/.test(normalized)) {
    return { singular: "order", plural: "orders" };
  }
  if (/\bopportunit/.test(normalized)) {
    return { singular: "opportunity", plural: "opportunities" };
  }
  return { singular: "tracked record", plural: "tracked records" };
}

function qualifiedOutcomeMeaning(sourceColumn?: string | null, denominatorColumn?: string | null) {
  const normalized = normalizeName(String(sourceColumn ?? ""));
  if (/\bleads?\b/.test(normalized)) {
    return { singular: "qualified lead", plural: "qualified leads" };
  }
  if (/\bcalls?\b/.test(normalized)) {
    return { singular: "qualified call", plural: "qualified calls" };
  }
  const denominatorMeaning = sourceColumnMeaning(denominatorColumn);
  if (denominatorMeaning.singular === "lead") {
    return { singular: "qualified lead", plural: "qualified leads" };
  }
  if (denominatorMeaning.singular === "call") {
    return { singular: "qualified call", plural: "qualified calls" };
  }
  return { singular: "qualified record", plural: "qualified records" };
}

function conversionOutcomeMeaning(sourceColumn?: string | null) {
  const normalized = normalizeName(String(sourceColumn ?? ""));
  if (/\bclosed won\b|\bclosed won count\b|\bwon\b/.test(normalized)) {
    return { singular: "closed-won conversion", plural: "closed-won conversions" };
  }
  if (/\bopportunit/.test(normalized)) {
    return { singular: "opportunity", plural: "opportunities" };
  }
  if (/\bbooked|appointment/.test(normalized)) {
    return { singular: "booked conversion", plural: "booked conversions" };
  }
  if (/\border|purchase|sale/.test(normalized)) {
    return { singular: "sale conversion", plural: "sale conversions" };
  }
  return { singular: "conversion", plural: "conversions" };
}

function revenueDescription(sourceColumn: string | null, attributionCopy: boolean) {
  if (!attributionCopy) {
    return "Revenue total captured in the dataset.";
  }
  const normalized = normalizeName(String(sourceColumn ?? ""));
  if (/\bjob\b/.test(normalized)) {
    return "Job value attributed to tracked calls.";
  }
  return "Revenue value attributed to tracked calls.";
}

function crmValueLabel(sourceColumn: string | null) {
  const normalized = normalizeName(String(sourceColumn ?? ""));
  if (/\bestimated\b|\bpipeline\b|\bexpected\b/.test(normalized)) {
    return "Estimated Pipeline Value";
  }
  if (/\brealized\b|\brevenue\b/.test(normalized)) {
    return "Realized Revenue";
  }
  return "Pipeline Value";
}

function crmValueDescription(sourceColumn: string | null) {
  const normalized = normalizeName(String(sourceColumn ?? ""));
  if (/\bestimated\b|\bpipeline\b|\bexpected\b/.test(normalized)) {
    return "Estimated pipeline value captured in the CRM dataset.";
  }
  if (/\brealized\b|\brevenue\b/.test(normalized)) {
    return "Realized revenue captured in the CRM dataset.";
  }
  return "Value captured in the CRM pipeline dataset.";
}

function hasValidRatio(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator > 0 && numerator >= 0 && numerator <= denominator;
}

function ratioPercent(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || !hasValidRatio(numerator, denominator)) {
    return null;
  }
  return (numerator / denominator) * 100;
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
            return resolveSemanticMetricValue(row, params.sourceColumns[0] ?? "callDuration", params.profile);
          }
          if (params.key === "qualified_call_rate") {
            return resolveSemanticMetricValue(row, "qualifiedCall", params.profile);
          }
          if (params.key === "conversion_rate") {
            return resolveSemanticMetricValue(row, "convertedCall", params.profile);
          }
          if (params.key === "missed_call_rate") {
            return resolveSemanticMetricValue(row, "missedCall", params.profile);
          }
          if (params.key === "answered_call_rate") {
            return resolveSemanticMetricValue(row, "answeredCall", params.profile);
          }
          if (params.key === "cost_per_qualified_call" || params.key === "cost_per_conversion" || params.key === "cost_per_call" || params.key === "revenue_per_call" || params.key === "roas") {
            return null;
          }
          return params.sourceColumns.length > 0
            ? resolveSemanticMetricValue(row, params.sourceColumns[0], params.profile)
            : null;
        },
        params.key === "qualified_call_rate"
          ? {
              ratio: true,
              denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile),
              scaleToPercent: true
            }
          : params.key === "conversion_rate"
            ? {
                ratio: true,
                denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile),
                scaleToPercent: true
              }
            : params.key === "missed_call_rate"
              ? {
                  ratio: true,
                  denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile),
                  scaleToPercent: true
                }
              : params.key === "answered_call_rate"
                ? {
                    ratio: true,
                    denominatorGetter: (row) => resolveSemanticMetricValue(row, "calls", params.profile),
                    scaleToPercent: true
                  }
                : undefined,
        params.profile
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

function buildMetricTrustDebugEntry(params: {
  key: string;
  value: number;
  formula: string;
  sourceColumns: string[];
  datasetGrain: string;
  calls: number | null;
  qualifiedCalls: number | null;
  convertedCalls: number | null;
  missedCalls: number | null;
  answeredCalls: number | null;
  spend: number | null;
  paidQualifiedCalls: number | null;
  paidSpend: number | null;
}) {
  const numerator =
    params.key === "qualified_call_rate"
      ? params.qualifiedCalls
      : params.key === "conversion_rate"
        ? params.convertedCalls
        : params.key === "missed_call_rate"
          ? params.missedCalls
          : params.key === "answered_call_rate"
            ? params.answeredCalls
            : params.key === "cost_per_qualified_call"
              ? params.paidSpend
              : null;

  const denominator =
    params.key === "qualified_call_rate" ||
    params.key === "conversion_rate" ||
    params.key === "missed_call_rate" ||
    params.key === "answered_call_rate"
      ? params.calls
      : params.key === "cost_per_qualified_call"
        ? params.paidQualifiedCalls
        : null;

  return {
    metric: params.key,
    formula: params.formula,
    value: Number(params.value.toFixed(2)),
    numerator,
    denominator,
    sourceFields: params.sourceColumns,
    datasetGrain: params.datasetGrain
  };
}

function selectPreferredSemanticObservations(
  observations: MetricObservation[],
  mode: CallKpiMode,
  callFocused: boolean
) {
  const observationMap = new Map<string, MetricObservation>(
    observations.map((observation) => [observation.key, observation] as const)
  );
  const selected: MetricObservation[] = [];
  const selectedKeys = new Set<string>();

  const preferredGroups =
    mode === "attribution" && callFocused
      ? [
          ["total_calls"] as const,
          ["qualified_calls"] as const,
          ["qualified_call_rate", "conversion_rate"] as const,
          ["cost_per_qualified_call", "missed_call_rate"] as const,
          ["total_revenue", "roas"] as const
        ]
      : mode === "operations"
        ? [
            ["total_calls"] as const,
            ["unique_callers"] as const,
            ["missed_call_rate"] as const,
            ["avg_call_duration"] as const,
            ["repeat_caller_rate", "qualified_calls"] as const
          ]
        : [];

  for (const group of preferredGroups) {
    const match = group
      .map((key) => observationMap.get(key))
      .find((observation): observation is MetricObservation => Boolean(observation));
    if (!match || selectedKeys.has(match.key)) {
      continue;
    }
    selected.push(match);
    selectedKeys.add(match.key);
  }

  for (const observation of observations) {
    if (selected.length >= 5) {
      break;
    }
    if (selectedKeys.has(observation.key)) {
      continue;
    }
    selected.push(observation);
    selectedKeys.add(observation.key);
  }

  return selected.slice(0, 5);
}

function buildSemanticKpiCards(rows: DatasetRow[], profile: DatasetProfile): KpiCard[] {
  if (!hasCallTrackingSemanticContract(profile) || !profile.semanticContract) {
    return [];
  }

  const roleSet = buildSemanticRoleSet(profile);
  const businessMode = getCallKpiMode(profile, roleSet);
  const crmPipelineProfile = isCrmPipelineProfile(profile);
  const callFocusedPriority = !crmPipelineProfile && hasStrongCallTrackingSignals(roleSet);
  const attributionCopy = businessMode === "attribution" && !crmPipelineProfile;
  const enabledSemanticKpiKeys = new Set(profile.semanticContract.enabledKpis?.map((item) => item.key) ?? []);
  const cards: MetricObservation[] = [];
  const calls = aggregateSemanticMetric(rows, "calls", profile);
  const qualifiedCalls = aggregateSemanticMetric(rows, "qualifiedCall", profile);
  const convertedCalls = aggregateSemanticMetric(rows, "convertedCall", profile);
  const revenue = aggregateSemanticMetric(rows, "revenue", profile);
  const spend = aggregateSemanticMetric(rows, "spend", profile);
  const durationMetric =
    profile.semanticContract?.availableMetrics.find((metric) =>
      ["callDuration", "talkTime", "handleTime", "waitTime", "ringTime"].includes(metric)
    ) ?? null;
  const callDuration = durationMetric ? aggregateSemanticMetric(rows, durationMetric, profile) : null;
  const missedCalls = aggregateSemanticMetric(rows, "missedCall", profile);
  const answeredCalls = aggregateSemanticMetric(rows, "answeredCall", profile);
  const repeatCallers = aggregateSemanticMetric(rows, "repeatCaller", profile);
  const costPerQualifiedCall = aggregateSemanticMetric(rows, "cost_per_qualified_call", profile);
  const costPerCall = aggregateSemanticMetric(rows, "cost_per_call", profile);
  const costPerConversion = aggregateSemanticMetric(rows, "cost_per_conversion", profile);
  const callerNumberColumn = findSemanticSourceColumn(profile, "callerNumber");
  const callGrain = detectCallDatasetGrain(profile);
  const callVolumeFallback =
    calls ??
    (hasCallTrackingSemanticContract(profile) && callGrain !== "aggregated_call_summary" ? rows.length : null);
  const callsSourceColumn = findSemanticSourceColumn(profile, "calls");
  const callsResolution = profile.semanticContract?.metricResolutions.calls;
  const callsFormula = callsResolution?.formula ?? (callsSourceColumn ? `sum(${callsSourceColumn})` : "count(rows)");
  const populationMeaning = sourceColumnMeaning(callsSourceColumn);
  const qualifiedSourceColumn = findSemanticSourceColumn(profile, "qualifiedCall") ?? "qualifiedCall";
  const convertedSourceColumn = findSemanticSourceColumn(profile, "convertedCall") ?? "convertedCall";
  const spendSourceColumn = findSemanticSourceColumn(profile, "spend") ?? "spend";
  const revenueSourceColumn = findSemanticSourceColumn(profile, "revenue") ?? "revenue";
  const qualifiedMeaning = qualifiedOutcomeMeaning(qualifiedSourceColumn, callsSourceColumn);
  const conversionMeaning = conversionOutcomeMeaning(convertedSourceColumn);
  const populationIsCalls = populationMeaning.singular === "call";
  const populationIsLeads = populationMeaning.singular === "lead";
  const paidSpend = rows.reduce((sum, row) => {
    if (!hasReliablePaidSpend(row, profile)) {
      return sum;
    }
    return sum + (resolveSemanticMetricValue(row, "spend", profile) ?? 0);
  }, 0);
  const paidQualifiedCalls = rows.reduce((sum, row) => {
    if (!hasReliablePaidSpend(row, profile)) {
      return sum;
    }
    return sum + (resolveSemanticMetricValue(row, "qualifiedCall", profile) ?? 0);
  }, 0);
  const cpqcUsesPaidSpendScope =
    spend !== null &&
    qualifiedCalls !== null &&
    (Math.abs(paidSpend - spend) > 0.005 || paidQualifiedCalls !== qualifiedCalls);

  if (enabledSemanticKpiKeys.has("total_calls") && callVolumeFallback !== null) {
    const callIdColumn = findSemanticSourceColumn(profile, "callId");
    const explicitCallsColumn =
      callsResolution && callsResolution.resolution !== "derived"
        ? callsResolution.sourceColumns[0] ?? null
        : null;
    cards.push(
      buildSemanticMetricObservation({
        key: "total_calls",
        label: crmPipelineProfile ? "Lead Volume" : populationIsLeads ? "Total Leads" : populationIsCalls ? "Total Calls" : "Total Activity",
        value: callVolumeFallback,
        metricType: "count",
        unit: populationMeaning.plural,
        formula: callsFormula,
        description: crmPipelineProfile
          ? "Total lead volume captured in the CRM pipeline dataset."
          : attributionCopy
          ? `Total tracked ${populationMeaning.plural} across marketing channels.`
          : `Total ${populationMeaning.plural} captured in the dataset.`,
        sourceColumns: [explicitCallsColumn ?? callIdColumn ?? "calls"],
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
          description: "Distinct callers reached.",
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
        label: qualifiedMeaning.plural === "qualified leads" ? "Qualified Leads" : "Qualified Calls",
        value: qualifiedCalls,
        metricType: "count",
        unit: qualifiedMeaning.plural,
        formula: "sum(qualifiedCall)",
        description: crmPipelineProfile
          ? "Leads marked as qualified in the CRM pipeline fields."
          : attributionCopy && populationIsCalls
          ? "Tracked calls marked as sales-qualified."
          : attributionCopy
            ? `${humanize(qualifiedMeaning.plural)} marked as sales-qualified.`
            : `${humanize(qualifiedMeaning.plural)} counted by the dataset's qualified field.`,
        sourceColumns: [qualifiedSourceColumn],
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
        label: crmPipelineProfile
          ? "Closed-Won Outcomes"
          : conversionMeaning.plural === "closed-won conversions"
            ? "Closed-Won Conversions"
            : "Conversions",
        value: convertedCalls,
        metricType: "count",
        unit: conversionMeaning.plural,
        formula: "sum(convertedCall)",
        description: crmPipelineProfile
          ? "Closed-won outcomes captured in the CRM pipeline fields."
          : `${humanize(conversionMeaning.plural)} captured by the conversion field.`,
        sourceColumns: [convertedSourceColumn],
        priority: 92,
        profile,
        rows
      })
    );
  }

  const qualifiedRatePercent = ratioPercent(qualifiedCalls, calls);
  if (enabledSemanticKpiKeys.has("qualified_call_rate") && qualifiedRatePercent !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "qualified_call_rate",
        label: "Qualified Rate",
        value: qualifiedRatePercent,
        metricType: "percentage",
        unit: "%",
        formula: `sum(${qualifiedSourceColumn}) / ${callsFormula}`,
        description: crmPipelineProfile
          ? "Share of lead volume marked as qualified."
          : populationIsLeads
          ? "Share of leads that met the qualified threshold."
          : populationIsCalls
            ? "Share of tracked calls that were marked as qualified."
            : `Share of ${populationMeaning.plural} that were marked as qualified.`,
        sourceColumns: [qualifiedSourceColumn, callsSourceColumn ?? "tracked records"],
        priority: 90,
        profile,
        rows
      })
    );
  }

  const conversionRatePercent = ratioPercent(convertedCalls, calls);
  if (enabledSemanticKpiKeys.has("conversion_rate") && conversionRatePercent !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "conversion_rate",
        label: crmPipelineProfile ? "Closed-Won Rate" : "Conversion Rate",
        value: conversionRatePercent,
        metricType: "percentage",
        unit: "%",
        formula: `sum(${convertedSourceColumn}) / ${callsFormula}`,
        description: crmPipelineProfile
          ? "Share of lead volume that reached closed-won outcome status."
          : `Share of ${populationMeaning.plural} that became ${conversionMeaning.plural}.`,
        sourceColumns: [convertedSourceColumn, callsSourceColumn ?? "tracked records"],
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
        label: crmPipelineProfile ? crmValueLabel(revenueSourceColumn) : callFocusedPriority ? "Revenue from Calls" : "Total Revenue",
        value: revenue,
        metricType: "currency",
        unit: "",
        formula: "sum(revenue)",
        description: crmPipelineProfile ? crmValueDescription(revenueSourceColumn) : revenueDescription(revenueSourceColumn, attributionCopy),
        sourceColumns: [revenueSourceColumn],
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
        description: attributionCopy
          ? "Marketing spend attributed to tracked campaigns."
          : "Cost or spend total captured in the dataset.",
        sourceColumns: [spendSourceColumn],
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
        description: attributionCopy
          ? "Revenue generated for every dollar spent on marketing."
          : "Revenue divided by spend where both fields are available.",
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
        label: crmPipelineProfile ? "Pipeline Value per Lead" : populationIsLeads ? "Revenue per Lead" : populationIsCalls ? "Revenue per Call" : "Revenue per Activity",
        value: revenue / calls,
        metricType: "currency",
        unit: "",
        formula: `sum(revenue) / ${callsFormula}`,
        description: crmPipelineProfile
          ? "Average pipeline value per tracked lead."
          : `Average revenue generated per tracked ${populationMeaning.singular}.`,
        sourceColumns: [findSemanticSourceColumn(profile, "revenue") ?? "revenue", callsSourceColumn ?? "tracked records"],
        priority: 87,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("cost_per_call") && costPerCall !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "cost_per_call",
        label: populationIsLeads ? "Cost per Lead" : populationIsCalls ? "Cost per Call" : "Cost per Activity",
        value: costPerCall,
        metricType: "currency",
        unit: "",
        formula: `sum(spend) / ${callsFormula}`,
        description: attributionCopy
          ? `Average spend required to generate a tracked ${populationMeaning.singular}.`
          : `Cost or spend divided by tracked ${populationMeaning.plural}.`,
        sourceColumns: [findSemanticSourceColumn(profile, "spend") ?? "spend", callsSourceColumn ?? "tracked records"],
        priority: 86,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("cost_per_qualified_call") && costPerQualifiedCall !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "cost_per_qualified_call",
        label: "Cost per Qualified Call",
        value: costPerQualifiedCall,
        metricType: "currency",
        unit: "",
        formula: cpqcUsesPaidSpendScope
          ? `sum(${spendSourceColumn} on paid, spend-covered calls) / sum(${qualifiedSourceColumn} on paid, spend-covered calls)`
          : `sum(${spendSourceColumn}) / sum(${qualifiedSourceColumn})`,
        description: cpqcUsesPaidSpendScope
          ? `Average media spend per ${qualifiedMeaning.singular} where paid spend is available.`
          : attributionCopy
            ? `Average spend required to generate one ${qualifiedMeaning.singular}.`
            : `Cost or spend divided by ${qualifiedMeaning.plural}.`,
        sourceColumns: [spendSourceColumn, qualifiedSourceColumn],
        priority: 85,
        profile,
        rows
      })
    );
  }

  if (enabledSemanticKpiKeys.has("cost_per_conversion") && costPerConversion !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "cost_per_conversion",
        label: "Cost per Conversion",
        value: costPerConversion,
        metricType: "currency",
        unit: "",
        formula: "spend / convertedCalls",
        description: attributionCopy
          ? `Average spend required to generate one ${conversionMeaning.singular}.`
          : `Cost or spend divided by ${conversionMeaning.plural}.`,
        sourceColumns: [findSemanticSourceColumn(profile, "spend") ?? "spend", convertedSourceColumn],
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
        description: "Average length of tracked calls.",
        sourceColumns: [findSemanticSourceColumn(profile, durationMetric) ?? durationMetric],
        priority: 88,
        profile,
        rows
      })
    );
  }

  const repeatCallerRatePercent = ratioPercent(repeatCallers, callVolumeFallback);
  if (enabledSemanticKpiKeys.has("repeat_caller_rate") && repeatCallerRatePercent !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "repeat_caller_rate",
        label: "Repeat Caller Rate",
        value: repeatCallerRatePercent,
        metricType: "percentage",
        unit: "%",
        formula: "repeatCallers / callVolume",
        description: `Share of ${populationMeaning.plural} associated with repeat callers.`,
        sourceColumns: [findSemanticSourceColumn(profile, "repeatCaller") ?? "repeatCaller"],
        priority: 84,
        profile,
        rows
      })
    );
  }

  const missedCallRatePercent = ratioPercent(missedCalls, calls);
  if (enabledSemanticKpiKeys.has("missed_call_rate") && missedCallRatePercent !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "missed_call_rate",
        label: "Missed Call Rate",
        value: missedCallRatePercent,
        metricType: "percentage",
        unit: "%",
        formula: "missedCalls / totalCalls",
        description: populationIsCalls
          ? "Share of tracked calls that were missed."
          : `Share of ${populationMeaning.plural} marked as missed.`,
        sourceColumns: [findSemanticSourceColumn(profile, "missedCall") ?? "missedCall", callsSourceColumn ?? "tracked records"],
        priority: 83,
        profile,
        rows
      })
    );
  }

  const answeredCallRatePercent = ratioPercent(answeredCalls, calls);
  if (enabledSemanticKpiKeys.has("answered_call_rate") && answeredCallRatePercent !== null) {
    cards.push(
      buildSemanticMetricObservation({
        key: "answered_call_rate",
        label: "Answered Call Rate",
        value: answeredCallRatePercent,
        metricType: "percentage",
        unit: "%",
        formula: "answeredCalls / totalCalls",
        description: populationIsCalls
          ? "Share of tracked calls that were answered."
          : `Share of ${populationMeaning.plural} marked as answered.`,
        sourceColumns: [findSemanticSourceColumn(profile, "answeredCall") ?? "answeredCall", callsSourceColumn ?? "tracked records"],
        priority: 82,
        profile,
        rows
      })
    );
  }

  const orderedCards = cards
    .sort((left, right) => {
      const leftBusinessPriority = getSemanticKpiBusinessPriority(left.key, businessMode, callFocusedPriority);
      const rightBusinessPriority = getSemanticKpiBusinessPriority(right.key, businessMode, callFocusedPriority);
      return rightBusinessPriority - leftBusinessPriority || right.priority - left.priority;
    })
  const selectedCards = selectPreferredSemanticObservations(orderedCards, businessMode, callFocusedPriority);

  if (process.env.NODE_ENV !== "production") {
    console.debug(
      "[metric-trust]",
      JSON.stringify(
        selectedCards.map((card) =>
          buildMetricTrustDebugEntry({
            key: card.key,
            value: card.value,
            formula: card.formula,
            sourceColumns: card.sourceColumns,
            datasetGrain: callGrain,
            calls,
            qualifiedCalls,
            convertedCalls,
            missedCalls,
            answeredCalls,
            spend,
            paidQualifiedCalls: paidQualifiedCalls > 0 ? paidQualifiedCalls : null,
            paidSpend: paidSpend > 0 ? paidSpend : null
          })
        ),
        null,
        2
      )
    );
  }

  return selectedCards
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
  valueGetter: (row: DatasetRow) => number | null,
  profile?: DatasetProfile
) {
  const grouped = new Map<string, number>();

  for (const row of rows) {
    const dimensionValue = row[dimension];
    const value = valueGetter(row);
    if (dimensionValue === null || dimensionValue === undefined || String(dimensionValue).trim() === "" || value === null) {
      continue;
    }

    const key = String(
      profile ? normalizeSemanticDimensionValue(dimensionValue, dimension, profile.semanticContract ?? profile) : dimensionValue
    );
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
  scaleToPercent = false,
  profile?: DatasetProfile
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
      numerator < 0 ||
      numerator > denominator ||
      denominator <= 0
    ) {
      continue;
    }

    const key = String(
      profile ? normalizeSemanticDimensionValue(dimensionValue, dimension, profile.semanticContract ?? profile) : dimensionValue
    );
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
  options?: { ratio?: boolean; denominatorGetter?: (row: DatasetRow) => number | null; scaleToPercent?: boolean },
  profile?: DatasetProfile
): SegmentSummary | null {
  const ranked = options?.ratio && options.denominatorGetter
    ? aggregateRatioByDimension(rows, dimension, valueGetter, options.denominatorGetter, options.scaleToPercent, profile).ranked
    : aggregateNumericByDimension(rows, dimension, valueGetter, profile).ranked;

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

function buildNeutralKpiDescription(metricKey: MetricKey, observation: MetricObservation) {
  const normalizedLabel = normalizeName(observation.label);
  const normalizedSource = observation.sourceColumns.map(normalizeName).join(" ");
  const metricText = `${normalizedLabel} ${normalizedSource}`;

  if (/\b(grid import|imported|import)\b/.test(metricText)) {
    return "Energy or volume drawn from an external source.";
  }
  if (/\b(grid export|exported|export)\b/.test(metricText)) {
    return "Energy or volume sent back to an external destination.";
  }
  if (/\b(load|demand|consumption|consumed|usage)\b/.test(metricText)) {
    return "Demand or consumption captured in the dataset.";
  }
  if (/\b(solar|generation|generated|production|produced|output)\b/.test(metricText)) {
    return "Generation or production captured in the dataset.";
  }
  if (/\b(cost|spend|expense|outlay|budget)\b/.test(metricText)) {
    return "Total cost recorded in the dataset.";
  }
  if (/\b(revenue|sales|income|gmv|booked value|sale value)\b/.test(metricText)) {
    return "Total revenue or sales value recorded in the dataset.";
  }
  if (/\b(margin|profit)\b/.test(metricText)) {
    return "Profitability measure captured in the dataset.";
  }
  if (observation.metricType === "duration" || /\b(delay|duration|time|seconds|minutes|hours|resolution|response|wait|handle)\b/.test(metricText)) {
    return "Time-based measure of process duration.";
  }
  if (observation.metricType === "percentage" || observation.metricType === "rate" || /\b(rate|percent|percentage|ratio|pct)\b/.test(metricText)) {
    return "Proportion-based measure.";
  }
  if (/\b(count|volume|records|events|transactions|activity|orders|tickets|cases|calls)\b/.test(metricText)) {
    return "Activity volume captured in the dataset.";
  }
  if (/\b(inventory|stock|units on hand|stockout|backorder)\b/.test(metricText)) {
    return "Inventory or stock movement captured in the dataset.";
  }
  if (/\b(return|refund)\b/.test(metricText)) {
    return "Returns or refunds captured in the dataset.";
  }
  if (/\b(error|failure|failed|missed|defect|incident)\b/.test(metricText)) {
    return "Exception or failure measure captured in the dataset.";
  }
  if (/\b(completion|completed|fulfillment|fulfilled|resolved|closed)\b/.test(metricText)) {
    return "Completion or fulfillment activity captured in the dataset.";
  }

  return "";
}

function buildDescription(metricKey: MetricKey, observation: MetricObservation, domainProfile: DomainSemanticProfile) {
  if (domainProfile.kpiExplanationMode === "neutral") {
    return buildNeutralKpiDescription(metricKey, observation);
  }

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
  currencyCode: string,
  domainProfile: DomainSemanticProfile
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
    observation.description = buildDescription(metricKey, observation, domainProfile);
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
  observation.description = buildDescription(key, observation, domainProfile);
  return observation;
}

function buildGenericFallbackObservations(
  rows: DatasetRow[],
  profile: DatasetProfile,
  datasetType: DatasetType,
  currencyCode: string,
  domainProfile: DomainSemanticProfile
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
      description: "",
      formula: `sum(${column})`,
      reliability: getColumnProfile(profile, column)?.missingCount ? "medium" : "high",
      priority: 40,
      warnings: [],
      sourceColumns: [column],
      relatedDimension: dimension,
      segmentSummary: segmentSummary ?? undefined
    };
    observation.description = buildDescription("total_value", observation, domainProfile);
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
  const domainProfile = resolveDomainSemanticProfile(profile, datasetType);
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
    observations[key] = buildMetricObservation(key, rows, profile, datasetType, currencyCode, domainProfile) ?? undefined;
  }

  const fallbackObservations = datasetType === "generic" ? buildGenericFallbackObservations(rows, profile, datasetType, currencyCode, domainProfile) : [];

  return {
    datasetType,
    domainProfile,
    observations,
    fallbackObservations
  };
}

export function buildKpiCandidates(rows: DatasetRow[], profile: DatasetProfile): KpiCandidate[] {
  const semanticCandidates = buildSemanticKpiCandidates(rows, profile);
  if (hasCallTrackingSemanticContract(profile)) {
    return semanticCandidates;
  }

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
    return semanticCards.slice(0, 5);
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
