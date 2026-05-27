import { formatCompactNumber } from "../utils/numberFormatting";
import type { PrimitiveValue } from "../types";
import { getChartColorForKey, getCompositionColor, SINGLE_SERIES_COMPARISON_COLOR } from "./chartPalette";

const STOP_WORDS = new Set(["and", "or", "of", "the", "by", "to", "for", "with", "in", "on", "at", "per"]);
const ACRONYMS = new Set(["roas", "roi", "ctr", "cvr", "cpc", "cpa", "aov", "gmv", "ltv", "kpi"]);

function looksLikeIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?/i.test(value.trim());
}

function parseDisplayDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function isTimeLikeLabel(value?: string | null) {
  const normalized = normalize(String(value ?? ""));
  return (
    normalized === "date" ||
    normalized.includes("date") ||
    normalized.includes("day") ||
    normalized.includes("week") ||
    normalized.includes("month") ||
    normalized.includes("hour") ||
    normalized.includes("time") ||
    normalized.includes("timestamp") ||
    normalized.includes("start local")
  );
}

const SEMANTIC_LABEL_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Revenue", aliases: ["revenue", "sales value", "sales", "income", "gmv", "net sales", "gross sales", "conversion value"] },
  { canonical: "Spend", aliases: ["spend", "total outlay", "cost", "ad spend", "media spend", "paid media cost", "budget"] },
  { canonical: "Clicks", aliases: ["clicks", "click count", "click through count"] },
  { canonical: "Impressions", aliases: ["impressions", "impression count", "ad view count"] },
  { canonical: "Conversions", aliases: ["conversions", "conversion count", "closed won count", "orders", "purchases"] },
  { canonical: "ROAS", aliases: ["roas", "return on ad spend"] },
  { canonical: "CTR", aliases: ["ctr", "click through rate", "click-through rate"] },
  { canonical: "CVR", aliases: ["cvr", "conversion rate", "conversion_rate"] },
  { canonical: "Date", aliases: ["date", "day", "week", "month", "event day", "activity date", "created at"] },
  { canonical: "Campaign", aliases: ["campaign", "campaign name", "campaign label", "campaign_nm", "campaign_name", "campaign_label", "campaign_lab"] },
  { canonical: "Campaign", aliases: ["campaign", "program", "initiative", "offer", "initiative label", "program name"] },
  { canonical: "Channel", aliases: ["channel", "distribution channel", "channel mix", "source", "medium"] },
  { canonical: "Location", aliases: ["location", "branch", "branch name", "branch_name", "office", "region location"] },
  { canonical: "Outcome", aliases: ["outcome", "outcome text", "outcome_text", "call outcome", "call_outcome", "calloutcome"] },
  { canonical: "Account", aliases: ["account", "account name", "queue", "queue name", "queue_name", "customer type", "customer_type"] },
  { canonical: "Call Duration", aliases: ["call duration", "callduration"] },
  { canonical: "Talk Time", aliases: ["talk time", "talktime"] },
  { canonical: "Handle Time", aliases: ["handle time", "handletime"] },
  { canonical: "Qualified Calls", aliases: ["qualifiedcall", "qualified call", "qualified calls"] },
  { canonical: "Device", aliases: ["device", "device type", "device class", "platform"] },
  { canonical: "Region", aliases: ["region", "geo", "market area", "country", "market"] }
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceSemanticAliases(text: string) {
  let output = text;

  for (const entry of SEMANTIC_LABEL_ALIASES) {
    for (const alias of [...entry.aliases].sort((left, right) => right.length - left.length)) {
      const pattern = new RegExp(`\\b${escapeRegExp(alias.replace(/_/g, " "))}\\b`, "gi");
      output = output.replace(pattern, entry.canonical);
    }
  }

  return output;
}

export function humanizeLabel(value?: string | null) {
  if (!value) {
    return "";
  }

  return value
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (lower === "vs") {
        return "vs";
      }
      if (ACRONYMS.has(lower)) {
        return lower.toUpperCase();
      }
      if (index > 0 && STOP_WORDS.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function getSemanticDisplayLabel(value?: string | null) {
  if (!value) {
    return "";
  }

  const normalized = normalize(value);
  const exactMatch = SEMANTIC_LABEL_ALIASES.find((entry) =>
    entry.aliases.some((alias) => normalized === normalize(alias))
  );

  if (exactMatch) {
    return exactMatch.canonical;
  }

  return humanizeLabel(replaceSemanticAliases(value));
}

export function getMetricUnit(metric?: string | null) {
  const value = normalize(String(metric ?? ""));
  if (!value) {
    return "";
  }
  if (
    value.includes("duration") ||
    value.includes("talk time") ||
    value.includes("handle time") ||
    value.includes("wait time") ||
    value.includes("ring time")
  ) {
    return "";
  }
  if (value.includes("roas") || value.includes("roi")) {
    return "x";
  }
  if (value.includes("ctr") || value.includes("cvr") || value.includes("conversion rate") || value.includes("rate") || value.includes("percent")) {
    return "%";
  }
  if (value.includes("revenue") || value.includes("sales") || value.includes("cost") || value.includes("spend")) {
    return "$";
  }
  if (
    value.includes("click") ||
    value.includes("impression") ||
    value.includes("order") ||
    value.includes("unit") ||
    value.includes("quantity") ||
    value.includes("conversion") ||
    value.includes("record")
  ) {
    return "count";
  }
  return "";
}

function formatFullNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2
  }).format(value);
}

function formatPercentValue(value: number) {
  const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: percentValue % 1 === 0 ? 0 : 2 }).format(percentValue)}%`;
}

function formatCurrencyValue(value: number, compact: boolean) {
  return compact ? `$${formatCompactNumber(value)}` : `$${formatFullNumber(value)}`;
}

function isDurationMetric(metric?: string | null) {
  const normalized = normalize(String(metric ?? ""));
  return (
    normalized.includes("duration") ||
    normalized.includes("talk time") ||
    normalized.includes("handle time") ||
    normalized.includes("wait time") ||
    normalized.includes("ring time")
  );
}

function formatDurationValue(value: number, compact: boolean) {
  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return compact
      ? `${hours}h ${minutes}m`
      : seconds > 0
        ? `${hours}h ${minutes}m ${seconds}s`
        : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return compact ? `${minutes}m` : seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

export function formatChartValue(value: unknown, metric?: string | null, mode: "axis" | "tooltip" = "axis") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value ?? "");
  }

  const normalizedMetric = normalize(String(metric ?? ""));
  const compact = mode === "axis";

  if (isDurationMetric(normalizedMetric)) {
    return formatDurationValue(value, compact);
  }

  if (normalizedMetric.includes("roas") || normalizedMetric.includes("roi")) {
    return `${compact ? formatCompactNumber(value) : formatFullNumber(value)}x`;
  }

  if (
    normalizedMetric.includes("ctr") ||
    normalizedMetric.includes("cvr") ||
    normalizedMetric.includes("conversion rate") ||
    normalizedMetric.includes("rate") ||
    normalizedMetric.includes("percent")
  ) {
    return formatPercentValue(value);
  }

  if (
    normalizedMetric.includes("click") ||
    normalizedMetric.includes("impression") ||
    normalizedMetric.includes("order") ||
    normalizedMetric.includes("unit") ||
    normalizedMetric.includes("quantity") ||
    normalizedMetric.includes("conversion")
  ) {
    return compact ? formatCompactNumber(value) : formatFullNumber(value);
  }

  if (normalizedMetric.includes("revenue") || normalizedMetric.includes("sales") || normalizedMetric.includes("cost") || normalizedMetric.includes("spend")) {
    return formatCurrencyValue(value, compact);
  }

  return compact ? formatCompactNumber(value) : formatFullNumber(value);
}

export function formatChartDateLabel(
  value: unknown,
  mode: "axis" | "tooltip" = "axis",
  options: { includeYear?: boolean } = {}
) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  if (!looksLikeIsoDate(raw)) {
    return raw;
  }

  const parsed = parseDisplayDate(raw);
  if (!parsed) {
    return raw;
  }

  const hasTime = /[ t]\d{2}:\d{2}/i.test(raw);
  if (mode === "tooltip") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: options.includeYear || parsed.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {})
    }).format(parsed);
  }

  return new Intl.DateTimeFormat(
    undefined,
    hasTime
      ? { month: "short", day: "numeric", year: options.includeYear ? "numeric" : undefined, hour: "numeric" }
      : { month: "short", day: "numeric", year: options.includeYear ? "numeric" : undefined }
  ).format(parsed);
}

export function getTimeSeriesYearContext(data: Record<string, PrimitiveValue>[], key: string) {
  const years = data
    .map((entry) => String(entry[key] ?? "").trim())
    .map((value) => {
      if (/^\d{4}$/.test(value)) {
        return value;
      }
      if (!looksLikeIsoDate(value)) {
        return "";
      }
      const parsed = parseDisplayDate(value);
      return parsed ? String(parsed.getFullYear()) : "";
    })
    .filter(Boolean);
  const uniqueYears = [...new Set(years)];

  return {
    includeYearInTicks: uniqueYears.length > 1,
    axisYearLabel: uniqueYears.length === 1 ? uniqueYears[0] : uniqueYears.length > 1 ? `${uniqueYears[0]}-${uniqueYears[uniqueYears.length - 1]}` : ""
  };
}

export function buildTimeSeriesTicks(data: Record<string, PrimitiveValue>[], key: string, targetCount = 6) {
  const labels = data
    .map((entry) => String(entry[key] ?? "").trim())
    .filter(Boolean);

  if (labels.length <= targetCount) {
    return labels;
  }

  const ticks: string[] = [];
  const lastIndex = labels.length - 1;
  const step = Math.max(1, Math.floor(lastIndex / Math.max(1, targetCount - 1)));

  for (let index = 0; index < labels.length; index += step) {
    ticks.push(labels[index]);
  }

  if (ticks[ticks.length - 1] !== labels[lastIndex]) {
    ticks.push(labels[lastIndex]);
  }

  return [...new Set(ticks)];
}

export function isTimeSeriesChartAxis(source?: string | null, xKey?: string | null) {
  return xKey === "date" || isTimeLikeLabel(source) || isTimeLikeLabel(xKey);
}

export function getTimeSeriesAxisLabel(source?: string | null, xKey?: string | null, yearLabel = "") {
  const normalizedSource = normalize(String(source ?? ""));
  const normalizedKey = normalize(String(xKey ?? ""));
  const suffix = yearLabel ? ` (${yearLabel})` : "";
  const dailySuffix = yearLabel ? ` (${yearLabel}, Daily)` : " (Daily)";

  if (normalizedSource.includes("month")) {
    return `Month${suffix}`;
  }
  if (normalizedSource.includes("week")) {
    return `Week${suffix}`;
  }
  if (normalizedKey === "date") {
    return normalizedSource.includes("call") ? `Call Date${dailySuffix}` : `Date${dailySuffix}`;
  }
  if (normalizedSource.includes("hour")) {
    return "Hour of Day";
  }
  if (normalizedSource.includes("time") || normalizedSource.includes("timestamp")) {
    return `Call Date / Time${suffix}`;
  }
  if (normalizedKey === "date") {
    return `Date${dailySuffix}`;
  }
  return `Date${suffix}`;
}

export function formatHistogramRangeLabel(entry: Record<string, PrimitiveValue> | null | undefined) {
  if (!entry) {
    return "";
  }
  const bucketLabel = entry.bucketLabel;
  if (typeof bucketLabel === "string" && bucketLabel.trim()) {
    return bucketLabel;
  }
  const bucket = entry.bucket;
  return typeof bucket === "string" ? bucket : "";
}

function formatCompactHistogramBoundary(metric: string, value: number) {
  const normalizedMetric = normalize(metric);

  if (
    normalizedMetric.includes("revenue") ||
    normalizedMetric.includes("sales") ||
    normalizedMetric.includes("cost") ||
    normalizedMetric.includes("spend") ||
    normalizedMetric.includes("income") ||
    normalizedMetric.includes("amount") ||
    normalizedMetric.includes("value")
  ) {
    const rounded = Math.abs(value) >= 10 ? Math.round(value) : Number(value.toFixed(1));
    return `$${formatFullNumber(rounded)}`;
  }

  if (
    normalizedMetric.includes("rate") ||
    normalizedMetric.includes("ctr") ||
    normalizedMetric.includes("cvr") ||
    normalizedMetric.includes("percent")
  ) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    const rounded = Math.abs(percentValue) >= 10 ? Math.round(percentValue) : Number(percentValue.toFixed(1));
    return `${formatFullNumber(rounded)}%`;
  }

  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Number(value.toFixed(1));
  return formatFullNumber(rounded);
}

export function formatHistogramAxisLabel(entry: Record<string, PrimitiveValue> | null | undefined, metric?: string | null) {
  if (!entry) {
    return "";
  }

  const rangeStart = typeof entry.rangeStart === "number" ? entry.rangeStart : null;
  const rangeEnd = typeof entry.rangeEnd === "number" ? entry.rangeEnd : null;
  if (rangeStart !== null && rangeEnd !== null) {
    const metricLabel = String(metric ?? "");
    return `${formatCompactHistogramBoundary(metricLabel, rangeStart)}–${formatCompactHistogramBoundary(metricLabel, rangeEnd)}`;
  }

  return formatHistogramRangeLabel(entry);
}

export function formatCategoryTickLabel(value: unknown, maxLength = 16) {
  const label = getSemanticDisplayLabel(String(value ?? ""));
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function getAxisLabel(metric?: string | null, dimension?: string | null) {
  const source = metric ?? dimension ?? "";
  const normalized = normalize(source);
  if (normalized.includes("month")) {
    return "Month";
  }
  if (normalized.includes("week")) {
    return "Week";
  }
  if (normalized.includes("hour") || normalized.includes("time") || normalized.includes("timestamp")) {
    return "Call Date / Time";
  }
  if (normalized.includes("date") || normalized.includes("day") || normalized.includes("start local")) {
    return "Call Date";
  }

  const label = getSemanticDisplayLabel(source);
  const unit = getMetricUnit(metric);
  return unit ? `${label} (${unit})` : label;
}

type LegendableChart = {
  chartType: string;
  data: Record<string, PrimitiveValue>[];
  xKey: string;
  yKey?: string;
  series?: string[];
  metric?: string | null;
  title?: string;
  id?: string;
};

function getCategoryKey(chart: LegendableChart) {
  return chart.chartType === "horizontal_bar" ? chart.yKey ?? chart.xKey : chart.xKey;
}

function getLegendLabel(chart: LegendableChart, entry: Record<string, PrimitiveValue>, index: number) {
  const rawValue = entry[getCategoryKey(chart)];
  if (rawValue !== null && rawValue !== undefined && String(rawValue).trim()) {
    return getSemanticDisplayLabel(String(rawValue));
  }

  if (chart.series?.[index]) {
    return getSemanticDisplayLabel(chart.series[index]);
  }

  return getSemanticDisplayLabel(chart.metric ?? chart.title ?? `Item ${index + 1}`);
}

export function buildChartLegendPayload(chart: LegendableChart) {
  const seriesKeys = chart.series?.filter(Boolean) ?? [];
  if (chart.chartType === "histogram" || chart.chartType === "funnel") {
    return [];
  }

  if (seriesKeys.length > 1) {
    return seriesKeys.map((seriesKey) => ({
      value: getSemanticDisplayLabel(seriesKey),
      color: getChartColorForKey(seriesKey),
      type: chart.chartType === "line" ? "line" : "square"
    }));
  }

  if (chart.chartType === "bar" || chart.chartType === "horizontal_bar") {
    return [];
  }

  if (chart.chartType === "scatter") {
    return [];
  }

  if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
    const label = getSemanticDisplayLabel(chart.metric ?? chart.yKey ?? chart.title ?? "");
    if (!label) {
      return [];
    }
    return [
      {
        value: label,
        color: SINGLE_SERIES_COMPARISON_COLOR,
        type: chart.chartType === "line" ? "line" : "circle"
      }
    ];
  }

  const categoryEntries = chart.data
    .map((entry, index) => ({
      value: getLegendLabel(chart, entry, index),
      color:
        chart.chartType === "donut"
          ? getCompositionColor(index, String(entry[getCategoryKey(chart)] ?? index))
          : getChartColorForKey(String(entry[getCategoryKey(chart)] ?? index)),
      type: "square"
    }))
    .filter((entry, index, entries) => entry.value && entries.findIndex((candidate) => candidate.value === entry.value) === index);

  return categoryEntries.slice(0, 8);
}
