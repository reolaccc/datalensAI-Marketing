import { formatCompactNumber } from "../utils/numberFormatting";
import type { PrimitiveValue } from "../types";
import { getChartColorForKey } from "./chartPalette";

const STOP_WORDS = new Set(["and", "or", "of", "the", "by", "to", "for", "with", "in", "on", "at", "per"]);
const ACRONYMS = new Set(["roas", "roi", "ctr", "cvr", "cpc", "cpa", "aov", "gmv", "ltv", "kpi"]);

function normalize(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
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
  { canonical: "Campaign", aliases: ["campaign", "program", "initiative", "offer", "initiative label", "program name"] },
  { canonical: "Channel", aliases: ["channel", "distribution channel", "channel mix", "source", "medium"] },
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

export function formatChartValue(value: unknown, metric?: string | null, mode: "axis" | "tooltip" = "axis") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value ?? "");
  }

  const normalizedMetric = normalize(String(metric ?? ""));
  const compact = mode === "axis";

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

export function getAxisLabel(metric?: string | null, dimension?: string | null) {
  const label = getSemanticDisplayLabel(metric ?? dimension ?? "");
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
  if (seriesKeys.length > 1) {
    return seriesKeys.map((seriesKey) => ({
      value: getSemanticDisplayLabel(seriesKey),
      color: getChartColorForKey(seriesKey),
      type: chart.chartType === "line" ? "line" : "square"
    }));
  }

  if (chart.chartType === "line" || chart.chartType === "anomaly_trend" || chart.chartType === "scatter") {
    const label = getSemanticDisplayLabel(chart.metric ?? chart.yKey ?? chart.title ?? "");
    if (!label) {
      return [];
    }
    return [
      {
        value: label,
        color: getChartColorForKey(chart.yKey ?? chart.metric ?? chart.id),
        type: chart.chartType === "line" ? "line" : "circle"
      }
    ];
  }

  const categoryEntries = chart.data
    .map((entry, index) => ({
      value: getLegendLabel(chart, entry, index),
      color: getChartColorForKey(String(entry[getCategoryKey(chart)] ?? index)),
      type: "square"
    }))
    .filter((entry, index, entries) => entry.value && entries.findIndex((candidate) => candidate.value === entry.value) === index);

  return categoryEntries.slice(0, 8);
}
