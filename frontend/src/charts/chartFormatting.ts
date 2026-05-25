import { formatCompactNumber } from "../utils/numberFormatting";
import type { PrimitiveValue } from "../types";

const COLOR_PALETTE = [
  "#ff6b6b",
  "#ff8e72",
  "#f7b267",
  "#f9d56e",
  "#7bd389",
  "#57cc99",
  "#38a3a5",
  "#5aa9e6"
];

const STOP_WORDS = new Set(["and", "or", "of", "the", "by", "to", "for", "with", "in", "on", "at", "per"]);
const ACRONYMS = new Set(["roas", "roi", "ctr", "cvr", "cpc", "cpa", "aov", "gmv", "ltv", "kpi"]);

function normalize(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
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

export function getChartColorForKey(key?: string | null) {
  const label = normalize(String(key ?? ""));
  if (!label) {
    return COLOR_PALETTE[0];
  }

  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }

  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
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
  if (value.includes("click") || value.includes("impression") || value.includes("order") || value.includes("unit") || value.includes("quantity")) {
    return "";
  }
  return "";
}

export function formatChartValue(value: unknown, metric?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value ?? "");
  }

  const normalizedMetric = normalize(String(metric ?? ""));
  if (normalizedMetric.includes("roas") || normalizedMetric.includes("roi")) {
    return `${formatCompactNumber(value)}x`;
  }

  if (normalizedMetric.includes("ctr") || normalizedMetric.includes("cvr") || normalizedMetric.includes("conversion rate") || normalizedMetric.includes("rate") || normalizedMetric.includes("percent")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: percentValue % 1 === 0 ? 0 : 2 }).format(percentValue)}%`;
  }

  if (normalizedMetric.includes("click") || normalizedMetric.includes("impression") || normalizedMetric.includes("order") || normalizedMetric.includes("unit") || normalizedMetric.includes("quantity")) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
  }

  if (normalizedMetric.includes("revenue") || normalizedMetric.includes("sales") || normalizedMetric.includes("cost") || normalizedMetric.includes("spend")) {
    return `$${formatCompactNumber(value)}`;
  }

  return formatCompactNumber(value);
}

export function getAxisLabel(metric?: string | null, dimension?: string | null) {
  const label = humanizeLabel(metric ?? dimension ?? "");
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

function getLegendLabel(chart: LegendableChart, entry: Record<string, PrimitiveValue>, index: number) {
  const rawValue = entry[chart.xKey];
  if (rawValue !== null && rawValue !== undefined && String(rawValue).trim()) {
    return humanizeLabel(String(rawValue));
  }

  if (chart.series?.[index]) {
    return humanizeLabel(chart.series[index]);
  }

  return humanizeLabel(chart.metric ?? chart.title ?? `Item ${index + 1}`);
}

export function buildChartLegendPayload(chart: LegendableChart) {
  const seriesKeys = chart.series?.filter(Boolean) ?? [];
  if (seriesKeys.length > 1) {
    return seriesKeys.map((seriesKey) => ({
      value: humanizeLabel(seriesKey),
      color: getChartColorForKey(seriesKey),
      type: chart.chartType === "line" ? "line" : "square"
    }));
  }

  if (chart.chartType === "line" || chart.chartType === "anomaly_trend" || chart.chartType === "scatter") {
    const label = humanizeLabel(chart.metric ?? chart.yKey ?? chart.title ?? "");
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
      color: getChartColorForKey(String(entry[chart.xKey] ?? index)),
      type: "square"
    }))
    .filter((entry, index, entries) => entry.value && entries.findIndex((candidate) => candidate.value === entry.value) === index);

  return categoryEntries.slice(0, 8);
}
