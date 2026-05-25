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

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
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

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "";
  }

  const stopWords = new Set(["and", "or", "of", "the", "by", "to", "for", "with", "in", "on", "at", "per"]);
  const acronyms = new Set(["roas", "roi", "ctr", "cvr", "cpc", "cpa", "aov", "gmv", "ltv", "kpi"]);
  return value
    .replace(/_/g, " ")
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

function valueAsNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0);
}

function buildModernChartTitle(blueprint: ChartBlueprint) {
  const metricLabel = humanizeLabel(blueprint.metric ?? blueprint.title);
  const dimensionLabel = humanizeLabel(blueprint.dimension ?? blueprint.groupBy ?? "segment");
  const secondaryMetricLabel = humanizeLabel(blueprint.secondaryMetric ?? "");
  const metricName = metricLabel || "Metric";
  const dimensionName = dimensionLabel || "Segment";

  if (blueprint.chartType === "line" || blueprint.chartType === "anomaly_trend") {
    return `${metricName} momentum`;
  }

  if (blueprint.chartType === "histogram" || blueprint.chartType === "box_plot") {
    return `${metricName} spread`;
  }

  if (blueprint.chartType === "scatter" || blueprint.chartType === "heatmap") {
    return `${metricName} vs ${secondaryMetricLabel || humanizeLabel(blueprint.yAxis ?? "") || "another metric"}`;
  }

  if (blueprint.chartType === "funnel") {
    return `${metricName} funnel`;
  }

  if (blueprint.chartType === "kpi_card") {
    return `${metricName} snapshot`;
  }

  if (blueprint.intent === "ranking") {
    const isBottom = /bottom|worst/i.test(blueprint.title);
    return `${isBottom ? "Bottom" : "Top"} ${dimensionName} by ${metricName}`;
  }

  if (blueprint.chartType === "bar" || blueprint.chartType === "horizontal_bar" || blueprint.chartType === "stacked_bar" || blueprint.chartType === "donut") {
    const lowerMetric = (blueprint.metric ?? "").toLowerCase();
    const isVolumeMetric = ["revenue", "sales", "cost", "spend", "clicks", "impressions", "orders", "units", "value"].some((label) =>
      lowerMetric.includes(label)
    );
    if (blueprint.groupBy && blueprint.dimension) {
      return `${metricName} mix by ${dimensionName}`;
    }
    if (isVolumeMetric && blueprint.dimension) {
      return `${dimensionName} ${metricName} mix`;
    }
    return `${metricName} by ${dimensionName}`;
  }

  return humanizeLabel(blueprint.title) || metricName;
}

function buildTopBottomSubtitle(data: Record<string, string | number | boolean | null>[], yKey: string, xKey: string, metric?: string | null) {
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
  const total = ranked.reduce((sum, entry) => sum + entry.value, 0);
  const topShare = total > 0 ? top.value / total : undefined;
  const top3Share = total > 0 ? ranked.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / total : undefined;

  const pieces: string[] = [];
  if (top.label) {
    pieces.push(`${top.label} leads at ${formatMetricSummaryValue(metric, top.value)}`);
  }
  if (bottom.label && bottom.label !== top.label) {
    pieces.push(`${bottom.label} trails at ${formatMetricSummaryValue(metric, bottom.value)}`);
  }
  if (topShare !== undefined && topShare >= 0.2) {
    pieces.push(`leader share ${Math.round(topShare * 1000) / 10}%`);
  } else if (top3Share !== undefined && top3Share >= 0.35) {
    pieces.push(`top 3 share ${Math.round(top3Share * 1000) / 10}%`);
  }

  return pieces.join(" · ");
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

  const pieces = [
    `${formatMetricSummaryValue(metric, firstValue)} at the start`,
    `${formatMetricSummaryValue(metric, lastValue)} at the end`
  ];

  if (peak && peak !== first && peak !== last) {
    pieces.push(`peak ${formatMetricSummaryValue(metric, peakValue)} on ${String(peak[xKey] ?? "")}`);
  }

  return pieces.join(" · ");
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
    return `${strength} positive relationship · a few points sit above the main cluster`;
  }
  if (correlation <= -0.55) {
    return `${strength} inverse relationship · watch for trade-offs between the two metrics`;
  }
  return `${strength} relationship · segment-level outliers matter more than the overall pattern`;
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
  if (share >= 0.35) {
    return `Most values cluster in ${String(peak.bucket ?? peak.label ?? "one band")} · the tail stretches to the high end`;
  }
  return `Spread is fairly even, with no single bucket dominating the distribution`;
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

  const pieces = [
    `${String(first[xKey] ?? first.stage ?? "top stage")} starts strongest`,
    `${String(last[xKey] ?? last.stage ?? "final stage")} ends weakest`
  ];
  if (biggestDrop.drop > 0 && biggestDrop.from && biggestDrop.to) {
    pieces.push(`largest drop between ${biggestDrop.from} and ${biggestDrop.to}`);
  } else if (second) {
    pieces.push(`sharp drop after ${String(first[xKey] ?? first.stage ?? "the first stage")}`);
  }
  return pieces.join(" · ");
}

function buildChartSubtitle(blueprint: ChartBlueprint, data: Record<string, string | number | boolean | null>[], xKey: string, yKey: string) {
  if (blueprint.chartType === "line" || blueprint.chartType === "anomaly_trend") {
    return buildTrendSubtitle(data, yKey, xKey);
  }
  if (blueprint.chartType === "scatter" || blueprint.chartType === "heatmap") {
    return buildScatterSubtitle(data, xKey, yKey);
  }
  if (blueprint.chartType === "histogram" || blueprint.chartType === "box_plot") {
    return buildHistogramSubtitle(data, yKey);
  }
  if (blueprint.chartType === "funnel") {
    return buildFunnelSubtitle(data, yKey, xKey);
  }
  if (blueprint.chartType === "bar" || blueprint.chartType === "horizontal_bar" || blueprint.chartType === "stacked_bar" || blueprint.chartType === "donut") {
    return buildTopBottomSubtitle(data, yKey, xKey);
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

function buildMissingValuesChart(context: ChartSelectionContext, blueprint: ChartBlueprint): ChartConfig | null {
  const data = context.profile.columns
    .map((column) => ({ column: column.name, missing_count: column.missingCount }))
    .filter((entry) => entry.missing_count > 0);

  if (data.length === 0) {
    return null;
  }

  return {
    id: blueprint.id,
    title: buildModernChartTitle(blueprint),
    subtitle: buildTopBottomSubtitle(data, "missing_count", "column") || undefined,
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
      context.capabilities
    );
  } else if (blueprint.chartType === "kpi_card" && blueprint.metric) {
    data = buildKpiCardData(rows, blueprint.metric, context.capabilities);
  } else if (blueprint.chartType === "line" || blueprint.chartType === "anomaly_trend") {
    if (!blueprint.metric || !blueprint.xAxis) {
      return null;
    }
    data = aggregateByDate(rows, blueprint.xAxis, blueprint.metric, context.capabilities, blueprint.groupBy);
    series = blueprint.groupBy ? [...new Set(data.flatMap((entry) => Object.keys(entry).filter((key) => key !== "date")))] : undefined;
  } else if (blueprint.chartType === "bar" || blueprint.chartType === "horizontal_bar" || blueprint.chartType === "stacked_bar" || blueprint.chartType === "funnel" || blueprint.chartType === "donut") {
    if (!blueprint.metric || !blueprint.dimension) {
      return null;
    }
    data = aggregateByDimension(rows, blueprint.dimension, blueprint.metric, context.capabilities, blueprint.groupBy);
    if (blueprint.groupBy) {
      series = [...new Set(data.flatMap((entry) => Object.keys(entry).filter((key) => key !== blueprint.dimension)))];
    }
    data = sortChartData(data, blueprint.metric, blueprint.sort ?? "desc", blueprint.limit ?? 10);
  } else if (blueprint.chartType === "histogram" || blueprint.chartType === "box_plot") {
    if (!blueprint.metric) {
      return null;
    }
    data = buildHistogramData(rows, blueprint.metric, context.capabilities);
  } else if (blueprint.chartType === "scatter" || blueprint.chartType === "heatmap") {
    if (!blueprint.metric || !blueprint.secondaryMetric) {
      return null;
    }
    data = buildScatterData(rows, blueprint.metric, blueprint.secondaryMetric, context.capabilities);
  }

  if (data.length === 0) {
    return null;
  }

  const xKey = blueprint.xAxis ?? blueprint.dimension ?? "label";
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
    title: buildModernChartTitle(blueprint),
    subtitle: buildChartSubtitle(blueprint, data, xKey, yKey) || undefined,
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
