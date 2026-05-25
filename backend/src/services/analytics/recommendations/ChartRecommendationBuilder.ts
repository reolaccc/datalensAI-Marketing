import type { ChartConfig, PrimitiveValue } from "../../../analytics/types.js";
import { parseDateValue, parseNumber } from "../../../utils/inference.js";

interface RecommendationCandidate {
  theme: string;
  text: string;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCompactNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute < 1000) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
  }

  const units = [
    { limit: 1_000_000_000_000, suffix: "T", divisor: 1_000_000_000_000 },
    { limit: 1_000_000_000, suffix: "B", divisor: 1_000_000_000 },
    { limit: 1_000_000, suffix: "M", divisor: 1_000_000 },
    { limit: 1_000, suffix: "K", divisor: 1_000 }
  ];

  const unit = units.find((entry) => absolute >= entry.limit) ?? units[units.length - 1];
  const scaled = value / unit.divisor;
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;

  return `${Number(scaled.toFixed(decimals)).toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0
  })}${unit.suffix}`;
}

function formatMetricValue(metric: string | null | undefined, value: number) {
  const normalized = normalize(metric ?? "");
  if (normalized.includes("roas") || normalized.includes("roi")) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}x`;
  }
  if (normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("rate")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(percentValue)}%`;
  }
  if (
    normalized.includes("revenue") ||
    normalized.includes("sales") ||
    normalized.includes("income") ||
    normalized.includes("gmv") ||
    normalized.includes("cost") ||
    normalized.includes("spend") ||
    normalized.includes("profit") ||
    normalized.includes("value") ||
    normalized.includes("amount")
  ) {
    return `$${formatCompactNumber(value)}`;
  }
  return formatCompactNumber(value);
}

function getNumericEntries(chart: ChartConfig) {
  const excludedKeys = new Set([chart.xKey, chart.yKey, chart.dimension, chart.metric, "date", "bucket"].filter(Boolean));
  return chart.data
    .map((row) => {
      const labelKey = chart.chartType === "line" || chart.chartType === "anomaly_trend" ? chart.xKey : chart.dimension ?? chart.xKey ?? "label";
      const label = String(row[labelKey] ?? row.bucket ?? row.date ?? "");
      const value =
        parseNumber(row[chart.yKey ?? ""]) ??
        parseNumber(row[chart.metric ?? ""]) ??
        Number(
          Object.entries(row)
            .filter(([key]) => !excludedKeys.has(key))
            .map(([, entryValue]) => parseNumber(entryValue))
            .filter((entryValue): entryValue is number => entryValue !== null)
            .reduce((sum, entryValue) => sum + entryValue, 0)
            .toFixed(2)
        );

      return Number.isFinite(value) && label ? { label, value } : null;
    })
    .filter((entry): entry is { label: string; value: number } => entry !== null);
}

function getOrderedSeries(chart: ChartConfig) {
  const entries = getNumericEntries(chart);
  if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
    return [...entries].sort((left, right) => {
      const leftDate = parseDateValue(left.label);
      const rightDate = parseDateValue(right.label);
      if (leftDate && rightDate) {
        return leftDate.getTime() - rightDate.getTime();
      }
      return left.label.localeCompare(right.label);
    });
  }

  return [...entries].sort((left, right) => right.value - left.value);
}

function getScatterPairs(chart: ChartConfig) {
  return chart.data
    .map((row) => ({
      x: parseNumber(row[chart.xKey]),
      y: parseNumber(row[chart.yKey ?? ""])
    }))
    .filter((entry): entry is { x: number; y: number } => entry.x !== null && entry.y !== null) as Array<{
    x: number;
    y: number;
  }>;
}

function estimateCorrelation(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) {
    return 0;
  }

  const meanX = points.reduce((sum, entry) => sum + entry.x, 0) / points.length;
  const meanY = points.reduce((sum, entry) => sum + entry.y, 0) / points.length;
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominatorX += (point.x - meanX) ** 2;
    denominatorY += (point.y - meanY) ** 2;
  }

  return numerator / Math.sqrt(denominatorX * denominatorY || 1);
}

function pushUnique(candidates: RecommendationCandidate[], theme: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const normalized = normalize(trimmed);
  if (candidates.some((candidate) => normalize(candidate.text) === normalized || candidate.theme === theme)) {
    return;
  }

  candidates.push({ theme, text: trimmed });
}

function buildTrendRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  const series = getOrderedSeries(chart);
  if (series.length < 2) {
    return [];
  }

  const first = series[0];
  const last = series[series.length - 1];
  const peak = [...series].sort((left, right) => right.value - left.value)[0];
  const deltas = series.slice(1).map((entry, index) => entry.value - series[index].value);
  const mean = series.reduce((sum, entry) => sum + entry.value, 0) / series.length;
  const averageAbsoluteDelta = deltas.length > 0 ? deltas.reduce((sum, value) => sum + Math.abs(value), 0) / deltas.length : 0;
  const volatility = mean > 0 ? averageAbsoluteDelta / mean : 0;
  const metricLabel = humanizeLabel(chart.metric ?? chart.yKey ?? chart.title) || "the metric";
  const xLabel = humanizeLabel(chart.xAxis ?? chart.xKey) || "the period";
  const peakLabel = peak && peak !== first && peak !== last ? `; the peak at ${formatMetricValue(chart.metric ?? chart.yKey, peak.value)} is worth isolating` : "";
  const recommendations: RecommendationCandidate[] = [];

  if (Math.abs(last.value - first.value) > 0 && volatility >= 0.18) {
    pushUnique(
      recommendations,
      "trend_volatility",
      `${metricLabel} became more volatile across ${xLabel}. Check campaign changes, timing shifts, or seasonal effects around the biggest swings.`
    );
  } else if (last.value > first.value) {
    pushUnique(
      recommendations,
      "trend_up",
      `${metricLabel} is rising across ${xLabel}${peakLabel}. Compare the lift against spend and conversion rate to confirm whether the growth is efficient.`
    );
  } else if (last.value < first.value) {
    pushUnique(
      recommendations,
      "trend_down",
      `${metricLabel} softened over ${xLabel}${peakLabel}. Check whether a campaign change, audience shift, or budget pullback explains the decline.`
    );
  } else {
    pushUnique(
      recommendations,
      "trend_flat",
      `${metricLabel} stayed relatively stable across ${xLabel}. Break it down by campaign or channel to see which segment is holding the line.`
    );
  }

  if (peak && volatility >= 0.12) {
    pushUnique(
      recommendations,
      "trend_spike",
      `The sharpest movement appears around ${peak.label}. Inspect adjacent periods to see whether a brief spike or drop is driving the overall story.`
    );
  }

  return recommendations.slice(0, 2);
}

function buildScatterRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  const pairs = getScatterPairs(chart);
  if (pairs.length < 3) {
    return [];
  }

  const correlation = estimateCorrelation(pairs);
  const xLabel = humanizeLabel(chart.xKey) || "the x metric";
  const yLabel = humanizeLabel(chart.yKey) || "the y metric";
  const metricLabel = humanizeLabel(chart.metric ?? chart.title) || "the chart";
  const recommendations: RecommendationCandidate[] = [];

  if (Math.abs(correlation) < 0.25) {
    pushUnique(
      recommendations,
      "scatter_outliers",
      `${metricLabel} shows a loose relationship between ${xLabel} and ${yLabel}, so inspect the outliers and compare ROAS or CPA to explain the spread.`
    );
    pushUnique(
      recommendations,
      "scatter_segmentation",
      `Segment this view by campaign, channel, or device to see whether the disconnected clusters reflect audience quality or creative differences.`
    );
    return recommendations.slice(0, 2);
  }

  if (correlation >= 0.55) {
    pushUnique(
      recommendations,
      "scatter_positive",
      `${xLabel} and ${yLabel} move together fairly strongly. Look for the clusters where scale and efficiency line up, then compare them against ROAS or CPA.`
    );
    pushUnique(
      recommendations,
      "scatter_cluster",
      `Break this scatter into campaign or audience segments to isolate which cluster is actually driving the relationship.`
    );
    return recommendations.slice(0, 2);
  }

  if (correlation <= -0.55) {
    pushUnique(
      recommendations,
      "scatter_negative",
      `${xLabel} and ${yLabel} pull in opposite directions. Check the high-volume points separately to see whether efficiency is falling as scale rises.`
    );
    pushUnique(
      recommendations,
      "scatter_efficiency",
      `Compare the same segments on ROAS and CPA to see whether the trade-off is driven by audience quality or spend intensity.`
    );
    return recommendations.slice(0, 2);
  }

  pushUnique(
    recommendations,
    "scatter_weak",
    `The relationship between ${xLabel} and ${yLabel} is mixed, so the main signal sits in the outliers rather than the full cluster.`
  );
  pushUnique(
    recommendations,
    "scatter_segment",
    `Split this view by campaign or channel to check which segment explains the better-performing points.`
  );
  return recommendations.slice(0, 2);
}

function buildDistributionRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  const series = getOrderedSeries(chart);
  if (series.length === 0) {
    return [];
  }

  const total = series.reduce((sum, entry) => sum + entry.value, 0);
  const top = series[0];
  const top3Share = total > 0 ? series.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / total : 0;
  const metricLabel = humanizeLabel(chart.metric ?? chart.yKey ?? chart.title) || "the metric";
  const recommendations: RecommendationCandidate[] = [];

  if (top3Share >= 0.6 || (total > 0 && top.value / total >= 0.35)) {
    pushUnique(
      recommendations,
      "distribution_concentration",
      `${metricLabel} is concentrated in a small number of buckets. Drill into the top segments before assuming the long tail matters less.`
    );
    pushUnique(
      recommendations,
      "distribution_pareto",
      `Run a Pareto-style check to see whether a few groups are responsible for most of the outcome.`
    );
  } else {
    pushUnique(
      recommendations,
      "distribution_tail",
      `${metricLabel} is spread more evenly, so inspect the tail for segments that may be under-monetized or unusually inefficient.`
    );
    pushUnique(
      recommendations,
      "distribution_variance",
      `Compare the median bucket against the high and low ends to understand where the variance is coming from.`
    );
  }

  return recommendations.slice(0, 2);
}

function buildFunnelRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  const series = getOrderedSeries(chart);
  if (series.length < 2) {
    return [];
  }

  const biggestDrop = series.slice(1).reduce(
    (best, current, index) => {
      const previous = series[index];
      const drop = previous.value - current.value;
      return drop > best.drop ? { drop, from: previous.label, to: current.label } : best;
    },
    { drop: 0, from: "", to: "" }
  );

  const recommendations: RecommendationCandidate[] = [];
  const stageLabel = humanizeLabel(chart.xAxis ?? chart.xKey) || "the funnel";
  const metricLabel = humanizeLabel(chart.metric ?? chart.yKey ?? chart.title) || "the metric";

  if (biggestDrop.drop > 0) {
    pushUnique(
      recommendations,
      "funnel_leak",
      `The biggest leak sits between ${biggestDrop.from} and ${biggestDrop.to}. Investigate that transition before changing the broader budget plan.`
    );
    pushUnique(
      recommendations,
      "funnel_quality",
      `Compare ${stageLabel} against traffic source or audience quality to see whether the drop is driven by acquisition quality or step friction.`
    );
  } else {
    pushUnique(
      recommendations,
      "funnel_balance",
      `${metricLabel} declines through ${stageLabel}, so check whether the earliest stage or the final conversion step is creating the bottleneck.`
    );
    pushUnique(
      recommendations,
      "funnel_transition",
      `Test the step-to-step transition against campaign or channel mix to see which part of the funnel needs the most attention.`
    );
  }

  return recommendations.slice(0, 2);
}

function buildBarRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  const series = getOrderedSeries(chart);
  if (series.length === 0) {
    return [];
  }

  const total = series.reduce((sum, entry) => sum + entry.value, 0);
  const top = series[0];
  const bottom = series[series.length - 1];
  const top3Share = total > 0 ? series.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / total : 0;
  const metricLabel = humanizeLabel(chart.metric ?? chart.yKey ?? chart.title) || "the metric";
  const dimensionLabel = humanizeLabel(chart.dimension ?? chart.xAxis ?? chart.xKey ?? "segment") || "segment";
  const recommendations: RecommendationCandidate[] = [];

  if (top3Share >= 0.55) {
    pushUnique(
      recommendations,
      "bar_concentration",
      `${metricLabel} is dominated by the leading ${dimensionLabel} buckets. Drill into the top performers before treating the full view as scalable.`
    );
    pushUnique(
      recommendations,
      "bar_long_tail",
      `A long tail remains under-monetized here, so compare the top buckets against the rest of the distribution.`
    );
  }

  if (top.value > 0 && bottom.value > 0 && top.value / bottom.value >= 2.5) {
    pushUnique(
      recommendations,
      "bar_gap",
      `The gap between the strongest and weakest ${dimensionLabel} is wide. Compare conversion efficiency and spend intensity to see whether scale or quality is driving the split.`
    );
  }

  if (chart.chartType === "stacked_bar" || chart.chartType === "donut" || chart.series?.length) {
    pushUnique(
      recommendations,
      "bar_mix",
      `Check how the mix changes across ${dimensionLabel} to see which segment is actually contributing to the result.`
    );
  }

  if (recommendations.length === 0) {
    pushUnique(
      recommendations,
      "bar_breakdown",
      `Break ${metricLabel} down by ${dimensionLabel} to find which segment is carrying the result and which one needs correction.`
    );
  }

  return recommendations.slice(0, 2);
}

function buildKpiRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  const metricLabel = humanizeLabel(chart.metric ?? chart.title) || "the KPI";
  const normalized = normalize(chart.metric ?? chart.title);
  const recommendations: RecommendationCandidate[] = [];

  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income") || normalized.includes("value")) {
    pushUnique(
      recommendations,
      "kpi_revenue",
      `Break ${metricLabel} into segment-level contribution to see whether a few campaigns are dominating the result.`
    );
    pushUnique(
      recommendations,
      "kpi_revenue_efficiency",
      `Compare the strongest contributors against ROAS or CPA before deciding whether to scale spend.`
    );
  } else if (normalized.includes("cost") || normalized.includes("spend") || normalized.includes("budget")) {
    pushUnique(
      recommendations,
      "kpi_cost",
      `Split ${metricLabel} by campaign or channel to see where budget pressure is building.`
    );
    pushUnique(
      recommendations,
      "kpi_cost_efficiency",
      `Check the same segments against revenue or conversion rate to confirm whether spend is translating into return.`
    );
  } else if (normalized.includes("roas") || normalized.includes("roi") || normalized.includes("efficien")) {
    pushUnique(
      recommendations,
      "kpi_efficiency",
      `Compare ${metricLabel} against volume and conversion rate to see whether the efficiency holds at scale.`
    );
    pushUnique(
      recommendations,
      "kpi_efficiency_segments",
      `Break it by channel or campaign to locate the segment that is lifting or dragging the average.`
    );
  } else if (normalized.includes("conversion") || normalized.includes("ctr") || normalized.includes("cvr")) {
    pushUnique(
      recommendations,
      "kpi_rate",
      `Drill into ${metricLabel} by segment to see where traffic quality is strongest and where it weakens.`
    );
    pushUnique(
      recommendations,
      "kpi_rate_volume",
      `Compare the same segments against click or impression volume to separate rate effects from scale effects.`
    );
  } else {
    pushUnique(
      recommendations,
      "kpi_generic",
      `Break ${metricLabel} down by segment or time to identify the main driver behind the headline number.`
    );
    pushUnique(
      recommendations,
      "kpi_generic_compare",
      `Compare the strongest and weakest segments to see whether the gap comes from scale, quality, or mix.`
    );
  }

  return recommendations.slice(0, 2);
}

function buildFallbackRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  const metricLabel = humanizeLabel(chart.metric ?? chart.title) || "the chart";
  const dimensionLabel = humanizeLabel(chart.dimension ?? chart.xAxis ?? chart.xKey ?? "segment") || "segment";
  return [
    { theme: "fallback_primary", text: `Break ${metricLabel} down by ${dimensionLabel} to find the segment-level driver.` },
    { theme: "fallback_secondary", text: `Check whether the strongest segment is also the most efficient before deciding what to scale.` }
  ];
}

function buildChartRecommendations(chart: ChartConfig): RecommendationCandidate[] {
  if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
    return buildTrendRecommendations(chart);
  }

  if (chart.chartType === "scatter" || chart.chartType === "heatmap") {
    return buildScatterRecommendations(chart);
  }

  if (chart.chartType === "histogram" || chart.chartType === "box_plot") {
    return buildDistributionRecommendations(chart);
  }

  if (chart.chartType === "funnel") {
    return buildFunnelRecommendations(chart);
  }

  if (chart.chartType === "kpi_card") {
    return buildKpiRecommendations(chart);
  }

  if (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "stacked_bar" || chart.chartType === "donut") {
    return buildBarRecommendations(chart);
  }

  return buildFallbackRecommendations(chart);
}

export function applyChartRecommendations(charts: ChartConfig[]): ChartConfig[] {
  const usedThemes = new Set<string>();
  const usedTexts = new Set<string>();

  return charts.map((chart) => {
    const candidates = buildChartRecommendations(chart);
    const recommendations: string[] = [];

    for (const candidate of candidates) {
      if (recommendations.length >= 2) {
        break;
      }

      const normalized = normalize(candidate.text);
      if (usedThemes.has(candidate.theme) || usedTexts.has(normalized)) {
        continue;
      }

      usedThemes.add(candidate.theme);
      usedTexts.add(normalized);
      recommendations.push(candidate.text);
    }

    if (recommendations.length === 0) {
      const fallback = buildFallbackRecommendations(chart);
      for (const candidate of fallback) {
        if (recommendations.length >= 2) {
          break;
        }

        const normalized = normalize(candidate.text);
        if (usedThemes.has(candidate.theme) || usedTexts.has(normalized)) {
          continue;
        }

        usedThemes.add(candidate.theme);
        usedTexts.add(normalized);
        recommendations.push(candidate.text);
      }
    }

    if (recommendations.length === 0) {
      recommendations.push(`Break ${humanizeLabel(chart.metric ?? chart.title) || "this chart"} down by segment to find the main driver.`);
    }

    return {
      ...chart,
      recommendations
    };
  });
}
