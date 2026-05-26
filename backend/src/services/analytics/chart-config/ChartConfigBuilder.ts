import type { ChartConfig } from "../../../analytics/types.js";
import {
  aggregateByDate,
  aggregateByDimension,
  buildHistogramData,
  buildKpiCardData,
  buildScatterData,
  filterRows
} from "../chart-selection/chartDataUtils.js";
import type { ChartBlueprint, ChartSelectionContext } from "../chart-selection/chartSelectionTypes.js";
import { resolveCanonicalDimensionKey, resolveCanonicalMetricKey } from "../../../analytics/semanticContract.js";

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function looksLikeIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?/i.test(value.trim());
}

const FUNNEL_STAGE_RANKS: Array<{ pattern: RegExp; rank: number }> = [
  { pattern: /\b(new|lead|inquiry|enquiry|prospect|captured|awareness|visitor)\b/i, rank: 1 },
  { pattern: /\b(contacted|reached|connected|answered|consideration|engaged)\b/i, rank: 2 },
  { pattern: /\b(follow[\s-]?up|nurtured|appointment|booked|mql|marketing qualified)\b/i, rank: 3 },
  { pattern: /\b(qualified|sql|sales qualified)\b/i, rank: 4 },
  { pattern: /\b(quote sent|proposal|demo|negotiation|opportunity)\b/i, rank: 5 },
  { pattern: /\b(converted|conversion|won|closed won|sale|customer)\b/i, rank: 6 }
];

function formatReadableDateLabel(value: string) {
  if (!looksLikeIsoDate(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const hasTime = /[ t]\d{2}:\d{2}/i.test(value);
  return new Intl.DateTimeFormat(undefined, hasTime ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric" }).format(parsed);
}

function formatReadableValue(metric: string | null | undefined, value: number) {
  const normalized = (metric ?? "").toLowerCase();
  if (normalized.includes("roas") || normalized.includes("roi")) {
    return `${formatCompactNumber(value)}x`;
  }
  if (normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("rate") || normalized.includes("percent")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: percentValue % 1 === 0 ? 0 : 1 }).format(percentValue)}%`;
  }
  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income") || normalized.includes("gmv") || normalized.includes("cost") || normalized.includes("spend") || normalized.includes("profit") || normalized.includes("value") || normalized.includes("amount")) {
    return `$${Math.abs(value) >= 1000 ? formatCompactNumber(value) : new Intl.NumberFormat(undefined, { maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value)}`;
  }
  return Math.abs(value) >= 1000
    ? formatCompactNumber(value)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
}

function funnelStageRank(value: string) {
  for (const candidate of FUNNEL_STAGE_RANKS) {
    if (candidate.pattern.test(value)) {
      return candidate.rank;
    }
  }
  return null;
}

function pluralizeLabel(value: string) {
  const lower = value.toLowerCase();
  if (/(s|x|z|ch|sh)$/i.test(lower)) {
    return `${value}es`;
  }
  if (/[^aeiou]y$/i.test(lower)) {
    return `${value.slice(0, -1)}ies`;
  }
  return `${value}s`;
}

function formatMetricSummaryValue(metric: string | null | undefined, value: number) {
  const normalized = (metric ?? "").toLowerCase();
  if (normalized.includes("roas") || normalized.includes("roi")) {
    return `${formatCompactNumber(value)}x`;
  }
  if (normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("rate") || normalized.includes("percent")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(percentValue)}%`;
  }
  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income") || normalized.includes("gmv") || normalized.includes("cost") || normalized.includes("spend") || normalized.includes("profit") || normalized.includes("value") || normalized.includes("amount")) {
    return `$${formatCompactNumber(value)}`;
  }
  return formatCompactNumber(value);
}

function inferAnalysisRole(blueprint: ChartBlueprint) {
  if (blueprint.analysisRole) {
    return blueprint.analysisRole;
  }
  if (blueprint.chartType === "donut") {
    return "composition";
  }
  if (blueprint.chartType === "funnel") {
    return "funnel";
  }
  if (blueprint.chartType === "anomaly_trend") {
    return "anomaly";
  }
  if (blueprint.chartType === "line") {
    return "trend";
  }
  if (blueprint.chartType === "scatter" || blueprint.chartType === "heatmap") {
    return blueprint.intent === "efficiency_analysis" ? "efficiency" : "relationship";
  }
  if (blueprint.chartType === "histogram" || blueprint.chartType === "box_plot") {
    return "distribution";
  }
  if (blueprint.intent === "efficiency_analysis") {
    return "efficiency";
  }
  if (blueprint.intent === "anomaly_detection") {
    return "anomaly";
  }
  if (blueprint.intent === "funnel_analysis") {
    return "funnel";
  }
  return "comparison";
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "";
  }

  const stopWords = new Set(["and", "or", "of", "the", "by", "to", "for", "with", "in", "on", "at", "per"]);
  const acronyms = new Set(["roas", "roi", "ctr", "cvr", "cpc", "cpa", "aov", "gmv", "ltv", "kpi"]);
  const replacements: Array<[RegExp, string]> = [
    [/campaign\s*(name|label|nm|lab)/gi, "campaign"],
    [/branch\s*name/gi, "location"],
    [/queue\s*name/gi, "account"],
    [/customer\s*type/gi, "account"],
    [/outcome\s*text/gi, "outcome"],
    [/qualified\s*calls?/gi, "qualified calls"],
    [/converted\s*calls?/gi, "converted calls"],
    [/missed\s*calls?/gi, "missed calls"],
    [/answered\s*calls?/gi, "answered calls"],
    [/repeat\s*callers?/gi, "repeat callers"],
    [/first[\s-]*time\s*callers?/gi, "first-time callers"],
    [/call\s*duration/gi, "call duration"],
    [/talk\s*time/gi, "talk time"],
    [/handle\s*time/gi, "handle time"],
    [/wait\s*time/gi, "wait time"],
    [/ring\s*time/gi, "ring time"],
    [/call\s*outcome/gi, "outcome"],
    [/call\s*status/gi, "call status"],
    [/call\s*reference/gi, "call reference"]
  ];

  const normalized = replacements.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
  );

  return normalized
    .trim()
    .split(/\s+/)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (lower === "vs") {
        return "vs";
      }
      if (acronyms.has(lower)) {
        return lower.toUpperCase();
      }
      if (index > 0 && stopWords.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function canonicalMetricKey(context: ChartSelectionContext, metric?: string | null) {
  if (!metric) {
    return null;
  }

  return resolveCanonicalMetricKey(context.profile.semanticContract ?? context.profile, metric);
}

function canonicalDimensionKey(context: ChartSelectionContext, dimension?: string | null) {
  if (!dimension) {
    return null;
  }

  return resolveCanonicalDimensionKey(context.profile.semanticContract ?? context.profile, dimension);
}

function semanticSignature(blueprint: ChartBlueprint, context: ChartSelectionContext) {
  const role = inferAnalysisRole(blueprint);
  const canonicalMetric = canonicalMetricKey(context, blueprint.metric ?? blueprint.yAxis ?? blueprint.title) ?? blueprint.metric ?? blueprint.yAxis ?? "metric";
  const canonicalDimension =
    canonicalDimensionKey(context, blueprint.dimension ?? blueprint.groupBy ?? blueprint.xAxis) ??
    blueprint.dimension ??
    blueprint.groupBy ??
    blueprint.xAxis ??
    "none";

  if (role === "relationship") {
    const metrics = [blueprint.metric ?? blueprint.xAxis ?? "metric", blueprint.secondaryMetric ?? blueprint.yAxis ?? "secondary"]
      .map((entry) => String(entry))
      .sort((left, right) => left.localeCompare(right));
    return `${role}:${metrics[0]}:${metrics[1]}`;
  }

  if (role === "distribution") {
    return `${role}:none:${canonicalMetric}`;
  }

  const canonicalGroupBy = blueprint.groupBy
    ? canonicalDimensionKey(context, blueprint.groupBy) ?? blueprint.groupBy
    : null;
  return `${role}:${canonicalDimension}:${canonicalMetric}${canonicalGroupBy ? `:${canonicalGroupBy}` : ""}`;
}

function valueAsNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0);
}

function buildModernChartTitle(blueprint: ChartBlueprint, context: ChartSelectionContext) {
  const metricLabel = humanizeLabel(canonicalMetricKey(context, blueprint.metric ?? blueprint.yAxis ?? blueprint.title) ?? blueprint.metric ?? blueprint.title);
  const dimensionLabel = humanizeLabel(canonicalDimensionKey(context, blueprint.dimension ?? blueprint.groupBy ?? blueprint.xAxis) ?? blueprint.dimension ?? blueprint.groupBy ?? "segment");
  const secondaryMetricLabel = humanizeLabel(canonicalMetricKey(context, blueprint.secondaryMetric ?? null) ?? blueprint.secondaryMetric ?? "");
  const metricName = metricLabel || "Metric";
  const dimensionName = dimensionLabel || "Segment";

  if (blueprint.chartType === "line" || blueprint.chartType === "anomaly_trend") {
    return `${metricName} Over Time`;
  }

  if (blueprint.chartType === "histogram" || blueprint.chartType === "box_plot") {
    return `${metricName} Distribution`;
  }

  if (blueprint.chartType === "scatter" || blueprint.chartType === "heatmap") {
    return `${metricName} vs ${secondaryMetricLabel || humanizeLabel(blueprint.yAxis ?? "") || "another metric"}`;
  }

  if (blueprint.chartType === "funnel") {
    return `${metricName} Funnel`;
  }

  if (blueprint.chartType === "kpi_card") {
    return `${metricName} snapshot`;
  }

  if (blueprint.chartType === "donut") {
    return `${metricName} Share by ${dimensionName}`;
  }

  if (blueprint.intent === "ranking") {
    return `Top ${pluralizeLabel(dimensionName)} by ${metricName}`;
  }

  if (blueprint.chartType === "bar" || blueprint.chartType === "horizontal_bar" || blueprint.chartType === "stacked_bar") {
    if (blueprint.groupBy) {
      const groupByLabel = humanizeLabel(canonicalDimensionKey(context, blueprint.groupBy) ?? blueprint.groupBy);
      return `${metricName} by ${dimensionName} and ${groupByLabel || "Segment"}`;
    }
    return `${metricName} by ${dimensionName}`;
  }

  return humanizeLabel(blueprint.title) || metricName;
}

function buildTopBottomSubtitle(
  data: Record<string, string | number | boolean | null>[],
  yKey: string,
  xKey: string,
  metric?: string | null,
  dimension?: string | null
) {
  const ranked = [...data]
    .map((entry) => ({
      label: String(entry[xKey] ?? ""),
      value: valueAsNumber(entry[yKey])
    }))
    .filter((entry) => entry.label && Number.isFinite(entry.value))
    .sort((left, right) => right.value - left.value);

  if (ranked.length === 0) {
    return "";
  }

  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const second = ranked[1];
  const total = ranked.reduce((sum, entry) => sum + entry.value, 0);
  const topShare = total > 0 ? top.value / total : undefined;
  const top3Share = total > 0 ? ranked.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / total : undefined;
  const leaderGapRatio = second && second.value > 0 ? top.value / second.value : undefined;

  const metricLabel = humanizeLabel(metric) || "the metric";
  const metricLower = metricLabel.toLowerCase();
  const dimensionLabel = pluralizeLabel(humanizeLabel(dimension ?? xKey) || "segment");
  const concentrationVerb = /s$/i.test(metricLabel) ? "are" : "is";

  if (top3Share !== undefined && top3Share >= 0.72) {
    return `${metricLabel} ${concentrationVerb} concentrated in ${top.label}, and the top 3 ${dimensionLabel} drive ${Math.round(top3Share * 1000) / 10}% of total ${metricLower}.`;
  }

  if (topShare !== undefined && topShare >= 0.45) {
    return `${top.label} contributes ${Math.round(topShare * 1000) / 10}% of total ${metricLower}, making it the clear leader.`;
  }

  if (topShare !== undefined && topShare <= 0.28) {
    return `${metricLabel} is broadly distributed across ${dimensionLabel}, with no single segment far ahead.`;
  }

  if (leaderGapRatio !== undefined && leaderGapRatio <= 1.15) {
    return `${top.label} leads ${metricLower}, but the leading ${dimensionLabel} remain closely grouped.`;
  }

  if (leaderGapRatio !== undefined && leaderGapRatio <= 1.35) {
    return `${top.label} holds a modest lead in ${metricLower}, with nearby competitors still in range.`;
  }

  if (bottom.label && bottom.label !== top.label) {
    return `${top.label} leads ${metricLower}, while ${bottom.label} trails well behind.`;
  }

  return `${top.label} is the leading ${humanizeLabel(dimension ?? xKey) || "segment"} for ${metricLower}.`;
}

function buildTrendSubtitle(data: Record<string, string | number | boolean | null>[], yKey: string, xKey: string, metric?: string | null) {
  if (data.length < 2) {
    return "";
  }

  const ordered = [...data].sort((left, right) => String(left[xKey] ?? "").localeCompare(String(right[xKey] ?? "")));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const peak = [...ordered].sort((left, right) => valueAsNumber(right[yKey]) - valueAsNumber(left[yKey]))[0];
  const firstValue = valueAsNumber(first[yKey]);
  const lastValue = valueAsNumber(last[yKey]);
  const peakValue = valueAsNumber(peak[yKey]);
  const metricLabel = humanizeLabel(metric) || "Performance";
  const changeRatio = firstValue === 0 ? (lastValue > 0 ? 1 : 0) : (lastValue - firstValue) / Math.abs(firstValue);
  const peakLabel = formatReadableDateLabel(String(peak[xKey] ?? "").trim());

  if (Math.abs(changeRatio) <= 0.08) {
    return peak && peakLabel
      ? `${metricLabel} stays broadly steady, with the clearest spike around ${peakLabel}.`
      : `${metricLabel} stays broadly steady across the period.`;
  }

  if (changeRatio > 0) {
    return peak && peak !== last && peakLabel
      ? `${metricLabel} finishes above its starting level, with the strongest burst around ${peakLabel}.`
      : `${metricLabel} builds over the period and ends above its starting level.`;
  }

  return peak && peakLabel
    ? `${metricLabel} softens over time after an earlier high around ${peakLabel}.`
    : `${metricLabel} softens over the period and does not recover to its earlier level.`;
}

function buildScatterSubtitle(data: Record<string, string | number | boolean | null>[], xKey: string, yKey: string) {
  const pairs = data
    .map((entry) => ({
      x: valueAsNumber(entry[xKey]),
      y: valueAsNumber(entry[yKey])
    }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));

  if (pairs.length < 3) {
    return "";
  }

  const meanX = pairs.reduce((sum, entry) => sum + entry.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, entry) => sum + entry.y, 0) / pairs.length;
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (const pair of pairs) {
    numerator += (pair.x - meanX) * (pair.y - meanY);
    denominatorX += (pair.x - meanX) ** 2;
    denominatorY += (pair.y - meanY) ** 2;
  }

  const correlation = numerator / Math.sqrt(denominatorX * denominatorY || 1);
  const strength = Math.abs(correlation) >= 0.55 ? "clear" : Math.abs(correlation) >= 0.25 ? "loose" : "weak";
  if (correlation >= 0.55) {
    return `${humanizeLabel(yKey) || "Performance"} rises alongside ${humanizeLabel(xKey) || "the comparison metric"}, with a few outliers worth checking.`;
  }
  if (correlation <= -0.55) {
    return `${humanizeLabel(xKey) || "The first metric"} and ${humanizeLabel(yKey) || "the second metric"} move in opposite directions, suggesting a trade-off.`;
  }
  return `Outliers matter more than the overall relationship in this view.`;
}

function buildHistogramSubtitle(data: Record<string, string | number | boolean | null>[], yKey: string) {
  if (data.length === 0) {
    return "";
  }

  const total = data.reduce((sum, entry) => sum + valueAsNumber(entry.count ?? entry[yKey]), 0);
  const peak = [...data].sort((left, right) => valueAsNumber(right.count ?? right[yKey]) - valueAsNumber(left.count ?? left[yKey]))[0];
  if (!peak) {
    return "";
  }

  const peakCount = valueAsNumber(peak.count ?? peak[yKey]);
  const share = total > 0 ? peakCount / total : 0;
  const rangeStart = typeof peak.rangeStart === "number" ? peak.rangeStart : null;
  const rangeEnd = typeof peak.rangeEnd === "number" ? peak.rangeEnd : null;
  const rangeText =
    rangeStart !== null && rangeEnd !== null
      ? `${formatReadableValue(yKey, rangeStart)} and ${formatReadableValue(yKey, rangeEnd)}`
      : String(peak.bucketLabel ?? peak.bucket ?? peak.label ?? "the main range");
  const metricNoun = `${humanizeLabel(yKey).toLowerCase() || "values"} values`;
  if (share >= 0.35) {
    return `Most ${metricNoun} fall between ${rangeText}, with only a small tail above that range.`;
  }
  return `${humanizeLabel(yKey) || "Values"} are spread across several ranges rather than one dominant band.`;
}

function buildFunnelSubtitle(data: Record<string, string | number | boolean | null>[], yKey: string, xKey: string) {
  if (data.length < 2) {
    return "";
  }

  type FunnelDrop = { drop: number; from: string; to: string };
  const ordered = [...data].sort((left, right) => valueAsNumber(right[yKey]) - valueAsNumber(left[yKey]));
  const first = ordered[0];
  const second = ordered[1];
  const last = ordered[ordered.length - 1];
  const biggestDrop = ordered.slice(1).reduce<FunnelDrop>(
    (best, current, index) => {
      const previous = ordered[index];
      const drop = valueAsNumber(previous[yKey]) - valueAsNumber(current[yKey]);
      return drop > best.drop ? { drop, from: String(previous[xKey] ?? previous.stage ?? "stage"), to: String(current[xKey] ?? current.stage ?? "stage") } : best;
    },
    { drop: 0, from: "", to: "" }
  );

  if (biggestDrop.drop > 0 && biggestDrop.from && biggestDrop.to) {
    return `The sharpest drop happens between ${biggestDrop.from} and ${biggestDrop.to}.`;
  }

  if (second) {
    return `The biggest loss happens immediately after ${String(first[xKey] ?? first.stage ?? "the first stage")}.`;
  }

  return `${String(first[xKey] ?? first.stage ?? "The first stage")} carries the most volume, while the final stage trails furthest behind.`;
}

function buildChartSubtitle(blueprint: ChartBlueprint, data: Record<string, string | number | boolean | null>[], xKey: string, yKey: string) {
  if (blueprint.chartType === "line" || blueprint.chartType === "anomaly_trend") {
    return buildTrendSubtitle(data, yKey, xKey);
  }
  if (blueprint.chartType === "scatter" || blueprint.chartType === "heatmap") {
    return buildScatterSubtitle(data, xKey, yKey);
  }
  if (blueprint.chartType === "histogram" || blueprint.chartType === "box_plot") {
    return buildHistogramSubtitle(data, blueprint.metric ?? yKey);
  }
  if (blueprint.chartType === "funnel") {
    return buildFunnelSubtitle(data, yKey, xKey);
  }
  if (blueprint.chartType === "bar" || blueprint.chartType === "horizontal_bar" || blueprint.chartType === "stacked_bar" || blueprint.chartType === "donut") {
    return buildTopBottomSubtitle(data, yKey, xKey, blueprint.metric, blueprint.dimension ?? blueprint.groupBy ?? null);
  }
  return "";
}

function sortChartData(
  data: Record<string, string | number | boolean | null>[],
  key: string,
  direction: "asc" | "desc" | null | undefined,
  limit: number | undefined
) {
  const sorted = [...data];
  if (direction) {
    sorted.sort((left, right) => {
      const leftValue = Number(left[key] ?? 0);
      const rightValue = Number(right[key] ?? 0);
      return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }

  if (limit && limit > 0) {
    return sorted.slice(0, limit);
  }
  return sorted;
}

function sortFunnelData(data: Record<string, string | number | boolean | null>[], xKey: string) {
  return [...data].sort((left, right) => {
    const leftLabel = String(left[xKey] ?? "");
    const rightLabel = String(right[xKey] ?? "");
    const leftRank = funnelStageRank(leftLabel);
    const rightRank = funnelStageRank(rightLabel);

    if (leftRank !== null && rightRank !== null) {
      return leftRank - rightRank;
    }
    if (leftRank !== null) {
      return -1;
    }
    if (rightRank !== null) {
      return 1;
    }
    return leftLabel.localeCompare(rightLabel);
  });
}

function buildMissingValuesChart(context: ChartSelectionContext, blueprint: ChartBlueprint): ChartConfig | null {
  const data = context.profile.columns
    .map((column) => ({ column: column.name, missing_count: column.missingCount }))
    .filter((entry) => entry.missing_count > 0);

  if (data.length === 0) {
    return null;
  }

  return {
    id: blueprint.id,
    title: buildModernChartTitle(blueprint, context),
    subtitle: buildTopBottomSubtitle(data, "missing_count", "column", "missing count", "column") || undefined,
    semanticSignature: semanticSignature(blueprint, context),
    analysisRole: inferAnalysisRole(blueprint),
    chartType: blueprint.chartType,
    intent: blueprint.intent,
    description: blueprint.description,
    reason: blueprint.reason,
    whyThisChart: blueprint.whyThisChart,
    xAxis: "column",
    yAxis: "missing_count",
    xKey: "column",
    yKey: "missing_count",
    metric: blueprint.metric ?? "missing_count",
    dimension: blueprint.dimension ?? "column",
    groupBy: blueprint.groupBy ?? null,
    sort: blueprint.sort ?? "desc",
    limit: blueprint.limit ?? 12,
    filters: blueprint.filters ?? [],
    data: sortChartData(data, "missing_count", blueprint.sort ?? "desc", blueprint.limit ?? 12)
  };
}

export function buildChartConfig(
  blueprint: ChartBlueprint,
  context: ChartSelectionContext
): ChartConfig | null {
  const rows = filterRows(context.rows, blueprint.filters ?? []);
  let data: Record<string, string | number | boolean | null>[] = [];
  let series: string[] | undefined;

  if (blueprint.metric === "missing_count" && blueprint.dimension === "column") {
    return buildMissingValuesChart(context, blueprint);
  }

  if (blueprint.metric === "row_count" && blueprint.dimension) {
    data = aggregateByDimension(
      rows.map((row) => ({ ...row, row_count: 1 })),
      blueprint.dimension,
      "row_count",
      context.capabilities,
      context.profile
    );
  } else if (blueprint.chartType === "kpi_card" && blueprint.metric) {
    data = buildKpiCardData(rows, blueprint.metric, context.capabilities, context.profile);
  } else if (blueprint.chartType === "line" || blueprint.chartType === "anomaly_trend") {
    if (!blueprint.metric || !blueprint.xAxis) {
      return null;
    }
    data = aggregateByDate(rows, blueprint.xAxis, blueprint.metric, context.capabilities, context.profile, blueprint.groupBy);
    series = blueprint.groupBy ? [...new Set(data.flatMap((entry) => Object.keys(entry).filter((key) => key !== "date")))] : undefined;
  } else if (blueprint.chartType === "bar" || blueprint.chartType === "horizontal_bar" || blueprint.chartType === "stacked_bar" || blueprint.chartType === "funnel" || blueprint.chartType === "donut") {
    if (!blueprint.metric || !blueprint.dimension) {
      return null;
    }
    data = aggregateByDimension(rows, blueprint.dimension, blueprint.metric, context.capabilities, context.profile, blueprint.groupBy);
    if (blueprint.groupBy) {
      series = [...new Set(data.flatMap((entry) => Object.keys(entry).filter((key) => key !== blueprint.dimension)))];
    }
    data =
      blueprint.chartType === "funnel"
        ? sortFunnelData(data, blueprint.dimension)
        : sortChartData(data, blueprint.metric, blueprint.sort ?? "desc", blueprint.limit ?? 10);
  } else if (blueprint.chartType === "histogram" || blueprint.chartType === "box_plot") {
    if (!blueprint.metric) {
      return null;
    }
    data = buildHistogramData(rows, blueprint.metric, context.capabilities, context.profile);
  } else if (blueprint.chartType === "scatter" || blueprint.chartType === "heatmap") {
    if (!blueprint.metric || !blueprint.secondaryMetric) {
      return null;
    }
    data = buildScatterData(rows, blueprint.metric, blueprint.secondaryMetric, context.capabilities, context.profile);
  }

  if (data.length === 0) {
    return null;
  }

  const xKey =
    blueprint.chartType === "line" || blueprint.chartType === "anomaly_trend"
      ? "date"
      : blueprint.xAxis ?? blueprint.dimension ?? "label";
  const yKey =
    blueprint.chartType === "histogram" || blueprint.chartType === "box_plot"
      ? "count"
      : blueprint.yAxis ?? blueprint.metric ?? "value";

  if (blueprint.chartType === "anomaly_trend" && blueprint.metric) {
    const outlierInfo = context.profile.outliers.find((entry) => entry.column === blueprint.metric);
    if (outlierInfo) {
      data = data.map((entry) => {
        const value = Number(entry[blueprint.metric!] ?? 0);
        const isAnomaly = value >= outlierInfo.max || value <= outlierInfo.min;
        return {
          ...entry,
          anomaly_marker: isAnomaly ? value : null
        };
      });
      series = [blueprint.metric, "anomaly_marker"];
    }
  }

  return {
    id: blueprint.id,
    title: buildModernChartTitle(blueprint, context),
    subtitle: buildChartSubtitle(blueprint, data, xKey, yKey) || undefined,
    semanticSignature: semanticSignature(blueprint, context),
    analysisRole: inferAnalysisRole(blueprint),
    chartType: blueprint.chartType,
    intent: blueprint.intent,
    description: blueprint.description,
    reason: blueprint.reason,
    whyThisChart: blueprint.whyThisChart,
    xAxis: xKey,
    yAxis: yKey,
    xKey,
    yKey,
    metric: blueprint.metric ?? null,
    dimension: blueprint.dimension ?? null,
    groupBy: blueprint.groupBy ?? null,
    sort: blueprint.sort ?? null,
    limit: blueprint.limit ?? 10,
    filters: blueprint.filters ?? [],
    series,
    data
  };
}

export function buildChartConfigs(
  blueprints: ChartBlueprint[],
  context: ChartSelectionContext
) {
  return blueprints
    .map((blueprint) => buildChartConfig(blueprint, context))
    .filter((chart): chart is ChartConfig => chart !== null);
}
