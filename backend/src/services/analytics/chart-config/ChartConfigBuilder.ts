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
    title: blueprint.title,
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
    title: blueprint.title,
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
