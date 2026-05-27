import type { ChartConfig } from "../../../analytics/types.js";
import { buildChartConfigs } from "../chart-config/ChartConfigBuilder.js";
import { rankRuleBasedCharts } from "../chart-ranking/RuleBasedChartRanker.js";
import type { ChartBlueprint, ChartSelectionContext } from "./chartSelectionTypes.js";

const ATTRIBUTION_DOMAINS = new Set([
  "call_tracking",
  "marketing_attribution",
  "mixed_call_tracking_attribution",
  "call_tracking_operations"
]);

const OPERATIONAL_DIMENSION_PATTERNS = [
  /\bqueue\b/,
  /\bteam\b/,
  /\bservice\b/,
  /\bdepartment\b/,
  /\bagent\b/,
  /\bcategory\b/,
  /\bregion\b/,
  /\bshift\b/,
  /\blocation\b/,
  /\bbranch\b/
];

const OPERATIONAL_METRIC_PATTERNS = [
  /\bresponse\b/,
  /\bresolution\b/,
  /\bduration\b/,
  /\btalk\b/,
  /\bwait\b/,
  /\bhandle\b/,
  /\bring\b/,
  /\breopen/,
  /\bescalat/,
  /\bmissed\b/,
  /\bfailed\b/,
  /\babandon/,
  /\berror\b/,
  /\bcallback\b/,
  /\bcsat\b/,
  /\bsatisfaction\b/,
  /\bquality\b/
];

const VOLUME_PATTERNS = [/\bticket\b/, /\bcase\b/, /\bcall\b/, /\binteraction\b/, /\brequest\b/, /\bsession\b/];
const FLAG_METRICS = ["missedCall", "answeredCall"];
const DURATION_METRICS = ["talkTime", "handleTime", "waitTime", "ringTime", "callDuration"];
const DIMENSION_PRIORITY = [
  /\bservice\b/,
  /\bteam\b/,
  /\bdepartment\b/,
  /\bqueue\b/,
  /\bagent\b/,
  /\bcategory\b/,
  /\bregion\b/,
  /\bshift\b/,
  /\blocation\b/,
  /\bbranch\b/
];

function normalize(value: string | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/_/g, " ").trim();
}

function matchesAny(value: string, patterns: RegExp[]) {
  const normalized = normalize(value);
  return patterns.some((pattern) => pattern.test(normalized));
}

function hasMetric(context: ChartSelectionContext, metric: string) {
  return [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(metric);
}

function detectedDomain(context: ChartSelectionContext) {
  return context.capabilities.semanticContract?.detectedDomain?.domain ?? null;
}

function isAttributionDomain(context: ChartSelectionContext) {
  const domain = detectedDomain(context);
  return domain !== null && ATTRIBUTION_DOMAINS.has(domain);
}

function isBinaryDimension(context: ChartSelectionContext, dimension: string) {
  const column = context.profile.columns.find((candidate) => candidate.name === dimension);
  return (column?.uniqueCount ?? 0) <= 2;
}

function pickOperationalDimensions(context: ChartSelectionContext) {
  return context.capabilities.categoricalDimensions
    .filter((dimension) => matchesAny(dimension, OPERATIONAL_DIMENSION_PATTERNS))
    .filter((dimension) => !isBinaryDimension(context, dimension))
    .sort((left, right) => dimensionPriority(left) - dimensionPriority(right))
    .slice(0, 3);
}

function dimensionPriority(dimension: string) {
  const normalized = normalize(dimension);
  const index = DIMENSION_PRIORITY.findIndex((pattern) => pattern.test(normalized));
  return index === -1 ? DIMENSION_PRIORITY.length : index;
}

function pickOperationalDurationMetric(context: ChartSelectionContext) {
  return (
    DURATION_METRICS.find((metric) => hasMetric(context, metric)) ??
    context.capabilities.numericMetrics.find((metric) => matchesAny(metric, OPERATIONAL_METRIC_PATTERNS)) ??
    null
  );
}

function hasOperationalSignals(context: ChartSelectionContext, dimensions: string[]) {
  if (dimensions.length === 0 || isAttributionDomain(context)) {
    return false;
  }

  const domain = detectedDomain(context);
  if (domain === "call_operations") {
    return true;
  }

  const columnNames = context.profile.columns.map((column) => column.name);
  const hasVolumeSignal = columnNames.some((column) => matchesAny(column, VOLUME_PATTERNS));
  const hasMetricSignal = [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics, ...columnNames].some((metric) =>
    matchesAny(metric, OPERATIONAL_METRIC_PATTERNS)
  );

  return hasVolumeSignal || hasMetricSignal;
}

function pushCandidate(candidates: ChartBlueprint[], input: Omit<ChartBlueprint, "id" | "score">) {
  const id = [
    "ops-overview",
    input.chartType,
    input.metric ?? "metric",
    input.dimension ?? input.xAxis ?? "none",
    input.groupBy ?? "none"
  ]
    .map((part) => normalize(part).replace(/\s+/g, "-"))
    .join("-");

  candidates.push({ id, score: input.priority, ...input });
}

export function buildOpsSupportOverviewFallbackCharts(context: ChartSelectionContext, existingCharts: ChartConfig[]) {
  if (context.question.trim() !== "" || existingCharts.length >= 2) {
    return existingCharts;
  }

  const dimensions = pickOperationalDimensions(context);
  if (!hasOperationalSignals(context, dimensions)) {
    return existingCharts;
  }

  const primaryDimension = dimensions[0];
  const secondaryDimension = dimensions[1] ?? null;
  const dateField = context.capabilities.defaultDateDimension ?? context.capabilities.datetimeFields[0] ?? null;
  const durationMetric = pickOperationalDurationMetric(context);
  const flagMetric = FLAG_METRICS.find((metric) => hasMetric(context, metric)) ?? null;
  const candidates: ChartBlueprint[] = [];

  if (dateField) {
    pushCandidate(candidates, {
      chartType: "line",
      intent: "general_overview",
      title: "Operational volume over time",
      description: "Track operational workload across the selected period.",
      reason: "A row-count trend is a safe demand overview when a time field exists.",
      whyThisChart: "Operations dashboards should show workload trend without forcing marketing attribution.",
      metric: "row_count",
      xAxis: dateField,
      yAxis: "row_count",
      limit: 0,
      filters: [],
      priority: 96,
      semanticRole: "main_answer",
      analysisRole: "trend",
      businessArea: "volume"
    });
  }

  pushCandidate(candidates, {
    chartType: "bar",
    intent: "general_overview",
    title: `Operational volume by ${primaryDimension}`,
    description: "Compare workload concentration across operational segments.",
    reason: "Volume by an operational segment is a safe descriptive overview.",
    whyThisChart: "This avoids marketing metrics and shows where operational demand is concentrated.",
    metric: "row_count",
    dimension: primaryDimension,
    xAxis: primaryDimension,
    yAxis: "row_count",
    sort: "desc",
    limit: 8,
    filters: [],
    priority: 92,
    semanticRole: "supporting_comparison",
    analysisRole: "comparison",
    businessArea: "operations"
  });

  if (flagMetric) {
    pushCandidate(candidates, {
      chartType: "bar",
      intent: "general_overview",
      title: `${flagMetric} by ${primaryDimension}`,
      description: "Compare operational exception volume across segments.",
      reason: "Exception counts are useful operational context when they are explicitly grounded.",
      whyThisChart: "Operations dashboards can surface missed or answered call patterns without attribution claims.",
      metric: flagMetric,
      dimension: primaryDimension,
      xAxis: primaryDimension,
      yAxis: flagMetric,
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 86,
      semanticRole: "trend_or_distribution",
      analysisRole: "comparison",
      businessArea: "quality"
    });
  }

  if (durationMetric) {
    pushCandidate(candidates, {
      chartType: "bar",
      intent: "general_overview",
      title: `${durationMetric} by ${secondaryDimension ?? primaryDimension}`,
      description: "Compare handling-time load across operational segments.",
      reason: "Duration load is a safe operational bottleneck signal when a time metric exists.",
      whyThisChart: "This keeps the chart descriptive and avoids unsupported efficiency claims.",
      metric: durationMetric,
      dimension: secondaryDimension ?? primaryDimension,
      xAxis: secondaryDimension ?? primaryDimension,
      yAxis: durationMetric,
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 82,
      semanticRole: "diagnostic",
      analysisRole: "comparison",
      businessArea: "operations"
    });
  }

  if (secondaryDimension) {
    pushCandidate(candidates, {
      chartType: "bar",
      intent: "general_overview",
      title: `Operational volume by ${secondaryDimension}`,
      description: "Compare workload across a second operational segment.",
      reason: "A second operational segment gives coverage without inventing unsupported KPI meaning.",
      whyThisChart: "This provides a safe fallback when richer operational metrics are limited.",
      metric: "row_count",
      dimension: secondaryDimension,
      xAxis: secondaryDimension,
      yAxis: "row_count",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 76,
      semanticRole: "diagnostic",
      analysisRole: "comparison",
      businessArea: "volume"
    });
  }

  const fallbackCharts = buildChartConfigs(candidates, context);
  if (fallbackCharts.length === 0) {
    return existingCharts;
  }

  return rankRuleBasedCharts([...existingCharts, ...fallbackCharts], context.intent);
}
