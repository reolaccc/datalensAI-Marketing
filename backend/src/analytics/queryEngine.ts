import type { DatasetProfile, DatasetRow, PlannedQuery, QuestionAnswer } from "./types.js";
import { parseDateValue, parseNumber } from "../utils/inference.js";

interface QueryContext {
  rows: DatasetRow[];
  profile: DatasetProfile;
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function matchesFilter(row: DatasetRow, filter: PlannedQuery["filters"][number]) {
  const rawValue = row[filter.column];

  if (filter.operator === "eq") {
    return String(rawValue ?? "").toLowerCase() === String(filter.value).toLowerCase();
  }

  if (filter.operator === "gt" || filter.operator === "gte" || filter.operator === "lt" || filter.operator === "lte") {
    const parsed = parseNumber(rawValue);
    if (parsed === null || typeof filter.value !== "number") {
      return false;
    }

    if (filter.operator === "gt") {
      return parsed > filter.value;
    }
    if (filter.operator === "gte") {
      return parsed >= filter.value;
    }
    if (filter.operator === "lt") {
      return parsed < filter.value;
    }
    return parsed <= filter.value;
  }

  const parsedDate = parseDateValue(rawValue);
  const targetDate = parseDateValue(String(filter.value));
  if (!parsedDate || !targetDate) {
    return false;
  }

  if (filter.operator === "after") {
    return parsedDate > targetDate;
  }

  return parsedDate < targetDate;
}

function formatFilterScope(query: PlannedQuery) {
  return query.filters.length > 0
    ? ` within ${query.filters
        .map((filter) => {
          if (filter.operator === "eq") {
            return `${filter.column}=${filter.value}`;
          }
          if (filter.operator === "after" || filter.operator === "before") {
            return `${filter.column} ${filter.operator} ${filter.value}`;
          }
          return `${filter.column} ${filter.operator} ${filter.value}`;
        })
        .join(", ")}`
    : "";
}

function applyFilters(rows: DatasetRow[], query: PlannedQuery) {
  return rows.filter((row) => query.filters.every((filter) => matchesFilter(row, filter)));
}

function aggregateValues(values: number[], operation: PlannedQuery["aggregateOperation"]) {
  if (values.length === 0) {
    return 0;
  }

  if (operation === "average") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  if (operation === "min") {
    return Math.min(...values);
  }

  if (operation === "max") {
    return Math.max(...values);
  }

  return values.reduce((sum, value) => sum + value, 0);
}

function groupByMetric(
  rows: DatasetRow[],
  dimension: string,
  metric: string,
  operation: PlannedQuery["aggregateOperation"],
  sortDirection: PlannedQuery["sortDirection"]
) {
  const grouped = new Map<string, number[]>();

  for (const row of rows) {
    const key = row[dimension];
    const metricValue = parseNumber(row[metric]);
    if (key === null || metricValue === null) {
      continue;
    }
    const current = grouped.get(String(key)) ?? [];
    current.push(metricValue);
    grouped.set(String(key), current);
  }

  return [...grouped.entries()]
    .map(([label, values]) => ({ label, value: aggregateValues(values, operation) }))
    .sort((left, right) =>
      sortDirection === "asc" ? left.value - right.value : right.value - left.value
    );
}

function groupByMetrics(
  rows: DatasetRow[],
  dimension: string,
  metrics: string[],
  operation: PlannedQuery["aggregateOperation"],
  sortDirection: PlannedQuery["sortDirection"]
) {
  const grouped = new Map<string, Record<string, number[]>>();

  for (const row of rows) {
    const key = row[dimension];
    if (key === null) {
      continue;
    }

    const groupKey = String(key);
    const current = grouped.get(groupKey) ?? {};

    for (const metric of metrics) {
      const metricValue = parseNumber(row[metric]);
      if (metricValue === null) {
        continue;
      }
      const metricValues = current[metric] ?? [];
      metricValues.push(metricValue);
      current[metric] = metricValues;
    }

    grouped.set(groupKey, current);
  }

  const primaryMetric = metrics[0];
  return [...grouped.entries()]
    .map(([label, metricMap]) => {
      const row: Record<string, string | number> = { [dimension]: label };
      for (const metric of metrics) {
        row[metric] = Number(aggregateValues(metricMap[metric] ?? [], operation).toFixed(2));
      }
      return row;
    })
    .sort((left, right) =>
      sortDirection === "asc"
        ? Number(left[primaryMetric] ?? 0) - Number(right[primaryMetric] ?? 0)
        : Number(right[primaryMetric] ?? 0) - Number(left[primaryMetric] ?? 0)
    );
}

function answerAnomaly(question: string, context: QueryContext): QuestionAnswer {
  const outlier = context.profile.outliers[0];
  if (!outlier) {
    return {
      question,
      interpretation: "anomaly scan",
      answer: "No major anomalies were detected by the current outlier heuristic.",
      supportingData: []
    };
  }

  return {
    question,
    interpretation: "anomaly scan",
    answer: `${humanize(outlier.column)} is the strongest anomaly signal with ${outlier.count} outlier values between ${outlier.min.toFixed(2)} and ${outlier.max.toFixed(2)}.`,
    supportingData: [
      { label: "column", value: outlier.column },
      { label: "outlier_count", value: outlier.count },
      { label: "min_outlier", value: Number(outlier.min.toFixed(2)) },
      { label: "max_outlier", value: Number(outlier.max.toFixed(2)) }
    ]
  };
}

function answerTrend(question: string, rows: DatasetRow[], query: PlannedQuery): QuestionAnswer {
  if (!query.datetimeColumn || !query.metric) {
    return {
      question,
      interpretation: "trend fallback",
      answer: "A trend answer requires both a datetime column and a numeric metric.",
      supportingData: []
    };
  }

  if (query.metrics.length > 1) {
    const grouped = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const date = parseDateValue(row[query.datetimeColumn]);
      if (!date) {
        continue;
      }

      const key = date.toISOString().slice(0, 10);
      const current = grouped.get(key) ?? {};

      for (const metric of query.metrics) {
        const metricValue = parseNumber(row[metric]);
        if (metricValue === null) {
          continue;
        }
        current[metric] = (current[metric] ?? 0) + metricValue;
      }

      grouped.set(key, current);
    }

    const data = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, metricMap]) => {
        const row: Record<string, string | number> = { date };
        for (const metric of query.metrics) {
          row[metric] = Number((metricMap[metric] ?? 0).toFixed(2));
        }
        return row;
      });

    const primaryMetric = query.metrics[0];
    const first = data[0];
    const last = data[data.length - 1];
    if (!first || !last) {
      return {
        question,
        interpretation: "trend fallback",
        answer: "Not enough time-series data was available to calculate a trend.",
        supportingData: []
      };
    }

    const firstValue = Number(first[primaryMetric] ?? 0);
    const lastValue = Number(last[primaryMetric] ?? 0);
    const direction = lastValue > firstValue ? "upward" : lastValue < firstValue ? "downward" : "flat";
    const filterText = formatFilterScope(query);

    return {
      question,
      interpretation: `trend of ${query.metrics.join(", ")}`,
      answer: `${humanize(primaryMetric)} shows a ${direction} trend${filterText} from ${firstValue.toFixed(2)} on ${String(first.date)} to ${lastValue.toFixed(2)} on ${String(last.date)}, alongside ${query.metrics
        .slice(1)
        .map((metric) => `${humanize(metric).toLowerCase()} ${Number(last[metric] ?? 0).toFixed(2)} at the latest point`)
        .join(" and ")}.`,
      supportingData: query.metrics.map((metric) => ({
        label: metric,
        value: Number(last[metric] ?? 0)
      })),
      resultTable: {
        columns: ["date", ...query.metrics],
        rows: data
      },
      chartSuggestion: {
        chartType: "line",
        xKey: "date",
        yKey: primaryMetric,
        series: query.metrics,
        data
      }
    };
  }

  const grouped = new Map<string, number>();
  for (const row of rows) {
    const date = parseDateValue(row[query.datetimeColumn]);
    const metricValue = parseNumber(row[query.metric]);
    if (!date || metricValue === null) {
      continue;
    }
    const key = date.toISOString().slice(0, 10);
    grouped.set(key, (grouped.get(key) ?? 0) + metricValue);
  }

  const data = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));

  const first = data[0];
  const last = data[data.length - 1];
  if (!first || !last) {
    return {
      question,
      interpretation: "trend fallback",
      answer: "Not enough time-series data was available to calculate a trend.",
      supportingData: []
    };
  }

  const direction = last.value > first.value ? "upward" : last.value < first.value ? "downward" : "flat";
  const filterText = formatFilterScope(query);

  return {
    question,
    interpretation: `trend of ${query.metric}`,
    answer: `${humanize(query.metric)} shows a ${direction} trend${filterText} from ${first.value.toFixed(2)} on ${first.date} to ${last.value.toFixed(2)} on ${last.date}.`,
    supportingData: data.slice(-5).map((entry) => ({
      label: entry.date,
      value: Number(entry.value.toFixed(2))
    })),
    chartSuggestion: {
      chartType: "line",
      xKey: "date",
      yKey: query.metric,
      data: data.map((entry) => ({
        date: entry.date,
        [query.metric!]: Number(entry.value.toFixed(2))
      }))
    }
  };
}

function answerDimensionTrend(question: string, rows: DatasetRow[], query: PlannedQuery): QuestionAnswer {
  if (!query.datetimeColumn || !query.metric || !query.dimension) {
    return answerTrend(question, rows, query);
  }

  const totalsByDimension = new Map<string, number>();
  for (const row of rows) {
    const dimensionValue: string | number | boolean | null = row[query.dimension];
    const metricValue = parseNumber(row[query.metric]);
    if (typeof dimensionValue !== "string" || metricValue === null) {
      continue;
    }
    totalsByDimension.set(dimensionValue, (totalsByDimension.get(dimensionValue) ?? 0) + metricValue);
  }

  const explicitSeries =
    query.comparisonValues.length > 0
      ? query.comparisonValues
      : [...totalsByDimension.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, Math.min(query.limit, 4))
          .map(([label]) => label);

  if (explicitSeries.length === 0) {
    return answerTrend(question, rows, query);
  }

  if (query.metrics.length > 1) {
    const seriesKeys = explicitSeries.flatMap((series) => query.metrics.map((metric) => `${series} ${metric}`));
    const grouped = new Map<string, Record<string, number>>();

    for (const row of rows) {
      const date = parseDateValue(row[query.datetimeColumn]);
      const dimensionValue: string | number | boolean | null = row[query.dimension];
      if (!date || typeof dimensionValue !== "string") {
        continue;
      }

      const matchedSeries: string | undefined = explicitSeries.find(
        (value) => value.toLowerCase() === dimensionValue.toLowerCase()
      );
      if (!matchedSeries) {
        continue;
      }

      const dateKey = date.toISOString().slice(0, 10);
      const current = grouped.get(dateKey) ?? {};

      for (const metric of query.metrics) {
        const metricValue = parseNumber(row[metric]);
        if (metricValue === null) {
          continue;
        }
        const composedKey = `${matchedSeries} ${metric}`;
        current[composedKey] = (current[composedKey] ?? 0) + metricValue;
      }

      grouped.set(dateKey, current);
    }

    const data = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, seriesMap]) => {
        const row: Record<string, string | number> = { date };
        for (const seriesKey of seriesKeys) {
          row[seriesKey] = Number((seriesMap[seriesKey] ?? 0).toFixed(2));
        }
        return row;
      });

    if (data.length === 0) {
      return answerTrend(question, rows, query);
    }

    const primaryMetric = query.metrics[0];
    const metricTotalsByDimension = explicitSeries
      .map((series) => ({
        label: series,
        value: data.reduce(
          (sum, entry) =>
            sum +
            query.metrics.reduce(
              (metricSum, metric) => metricSum + Number(entry[`${series} ${metric}`] ?? 0),
              0
            ),
          0
        )
      }))
      .sort((left, right) => right.value - left.value);
    const leader = metricTotalsByDimension[0];
    const laggard = metricTotalsByDimension[metricTotalsByDimension.length - 1];
    const filterText = formatFilterScope(query);
    const seriesLabelText = seriesKeys.join(", ");

    return {
      question,
      interpretation: `trend of ${query.metrics.join(", ")} by ${query.dimension}`,
      answer: `${leader.label} shows the strongest ${humanize(primaryMetric).toLowerCase()}-anchored trend${filterText} across ${query.dimension} for ${seriesLabelText}, with totals of ${leader.value.toFixed(2)} vs ${laggard.value.toFixed(2)} over the selected period.`,
      supportingData: metricTotalsByDimension.map((entry) => ({
        label: entry.label,
        value: Number(entry.value.toFixed(2))
      })),
      resultTable: {
        columns: ["date", ...seriesKeys],
        rows: data
      },
      chartSuggestion: {
        chartType: "line",
        xKey: "date",
        yKey: primaryMetric,
        series: seriesKeys,
        data
      }
    };
  }

  const grouped = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const date = parseDateValue(row[query.datetimeColumn]);
    const dimensionValue: string | number | boolean | null = row[query.dimension];
    const metricValue = parseNumber(row[query.metric]);

    if (!date || metricValue === null || typeof dimensionValue !== "string") {
      continue;
    }

    const matchedSeries = explicitSeries.find(
      (value) => value.toLowerCase() === dimensionValue.toLowerCase()
    );
    if (!matchedSeries) {
      continue;
    }

    const dateKey = date.toISOString().slice(0, 10);
    const current = grouped.get(dateKey) ?? {};
    current[matchedSeries] = (current[matchedSeries] ?? 0) + metricValue;
    grouped.set(dateKey, current);
  }

  const data = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, seriesMap]) => {
      const row: Record<string, string | number> = { date };
      for (const series of explicitSeries) {
        row[series] = Number((seriesMap[series] ?? 0).toFixed(2));
      }
      return row;
    });

  if (data.length === 0) {
    return answerTrend(question, rows, query);
  }

  const totals = explicitSeries.map((series) => ({
    label: series,
    value: data.reduce((sum, entry) => sum + Number(entry[series] ?? 0), 0)
  })).sort((left, right) => right.value - left.value);
  const leader = totals[0];
  const laggard = totals[totals.length - 1];
  const filterText = formatFilterScope(query);
  const seriesLabelText = explicitSeries.join(" and ");

  return {
    question,
    interpretation: `trend of ${query.metric} by ${query.dimension}`,
    answer: `${leader.label} shows the strongest ${humanize(query.metric).toLowerCase()} trend${filterText} across ${query.dimension} for ${seriesLabelText}, with totals of ${leader.value.toFixed(2)} vs ${laggard.value.toFixed(2)} over the selected period.`,
    supportingData: totals.map((entry) => ({
      label: entry.label,
      value: Number(entry.value.toFixed(2))
    })),
    resultTable: {
      columns: ["date", ...explicitSeries],
      rows: data
    },
    chartSuggestion: {
      chartType: "line",
      xKey: "date",
      yKey: query.metric,
      series: explicitSeries,
      data
    }
  };
}

function answerTopSegment(question: string, rows: DatasetRow[], query: PlannedQuery): QuestionAnswer {
  if (!query.metric || !query.dimension) {
    return {
      question,
      interpretation: "top segment fallback",
      answer: "A segment ranking requires both a metric and a categorical dimension.",
      supportingData: []
    };
  }

  const ranked = groupByMetric(
    rows,
    query.dimension,
    query.metric,
    query.aggregateOperation,
    query.sortDirection
  ).slice(0, query.limit);
  const winner = ranked[0];
  const filterText = formatFilterScope(query);

  return {
    question,
    interpretation: `rank ${query.dimension} by ${query.aggregateOperation} ${query.metric}`,
    answer: winner
      ? `${winner.label} has the strongest ${humanize(query.metric).toLowerCase()}${filterText} at ${winner.value.toFixed(2)}.`
      : `No segment-level result could be computed${filterText}.`,
    supportingData: ranked.map((entry) => ({
      label: entry.label,
      value: Number(entry.value.toFixed(2))
    })),
    chartSuggestion: {
      chartType: "bar",
      xKey: query.dimension,
      yKey: query.metric,
      data: ranked.map((entry) => ({
        [query.dimension!]: entry.label,
        [query.metric!]: Number(entry.value.toFixed(2))
      }))
    }
  };
}

function answerComparison(question: string, rows: DatasetRow[], query: PlannedQuery): QuestionAnswer {
  if (!query.metric || !query.dimension || query.comparisonValues.length < 2) {
    return answerTopSegment(question, rows, query);
  }

  const grouped = groupByMetric(
    rows,
    query.dimension,
    query.metric,
    query.aggregateOperation,
    query.sortDirection
  ).filter((entry) =>
    query.comparisonValues.some((value) => value.toLowerCase() === entry.label.toLowerCase())
  );

  if (grouped.length < 2) {
    return answerTopSegment(question, rows, query);
  }

  const leader = grouped[0];
  const laggard = grouped[grouped.length - 1];
  const filterText = formatFilterScope(query);

  return {
    question,
    interpretation: `compare ${query.dimension} values on ${query.aggregateOperation} ${query.metric}`,
    answer: `${leader.label} leads ${laggard.label} on ${humanize(query.metric).toLowerCase()}${filterText} by ${(leader.value - laggard.value).toFixed(2)}.`,
    supportingData: grouped.map((entry) => ({
      label: entry.label,
      value: Number(entry.value.toFixed(2))
    })),
    chartSuggestion: {
      chartType: "bar",
      xKey: query.dimension,
      yKey: query.metric,
      data: grouped.map((entry) => ({
        [query.dimension!]: entry.label,
        [query.metric!]: Number(entry.value.toFixed(2))
      }))
    }
  };
}

function answerComparisonTrend(question: string, rows: DatasetRow[], query: PlannedQuery): QuestionAnswer {
  if (!query.metric || !query.dimension || !query.datetimeColumn || query.comparisonValues.length < 2) {
    return answerComparison(question, rows, query);
  }

  const grouped = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const date = parseDateValue(row[query.datetimeColumn]);
    const dimensionValue: string | number | boolean | null = row[query.dimension];
    const metricValue = parseNumber(row[query.metric]);

    if (!date || metricValue === null || typeof dimensionValue !== "string") {
      continue;
    }

    const matchedSeries = query.comparisonValues.find(
      (value) => value.toLowerCase() === dimensionValue.toLowerCase()
    );
    if (!matchedSeries) {
      continue;
    }

    const dateKey = date.toISOString().slice(0, 10);
    const current = grouped.get(dateKey) ?? {};
    current[matchedSeries] = (current[matchedSeries] ?? 0) + metricValue;
    grouped.set(dateKey, current);
  }

  const data = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, seriesMap]) => {
      const row: Record<string, string | number> = { date };
      for (const series of query.comparisonValues) {
        row[series] = Number((seriesMap[series] ?? 0).toFixed(2));
      }
      return row;
    });

  if (data.length === 0) {
    return answerComparison(question, rows, query);
  }

  const totals = query.comparisonValues.map((series) => ({
    label: series,
    value: data.reduce((sum, entry) => sum + Number(entry[series] ?? 0), 0)
  })).sort((left, right) => right.value - left.value);
  const latestBySeries = new Map<string, number>();
  for (const series of query.comparisonValues) {
    for (let index = data.length - 1; index >= 0; index -= 1) {
      const value = Number(data[index]?.[series] ?? 0);
      if (value > 0) {
        latestBySeries.set(series, value);
        break;
      }
    }
  }
  const leader = totals[0];
  const laggard = totals[totals.length - 1];
  const filterText = formatFilterScope(query);
  const latestSummary = query.comparisonValues
    .map((series) => `${series} ${Number(latestBySeries.get(series) ?? 0).toFixed(2)}`)
    .join(" and ");

  return {
    question,
    interpretation: `compare ${query.dimension} trend of ${query.metric}`,
    answer: `${leader.label} shows the stronger ${humanize(query.metric).toLowerCase()} trend${filterText} across the selected period, with period totals of ${leader.value.toFixed(2)} vs ${laggard.value.toFixed(2)} and latest observed values of ${latestSummary}.`,
    supportingData: totals.map((entry) => ({
      label: entry.label,
      value: Number(entry.value.toFixed(2))
    })),
    resultTable: {
      columns: ["date", ...query.comparisonValues],
      rows: data
    },
    chartSuggestion: {
      chartType: "line",
      xKey: "date",
      yKey: query.metric,
      series: query.comparisonValues,
      data
    }
  };
}

function answerAggregateSegments(question: string, rows: DatasetRow[], query: PlannedQuery): QuestionAnswer {
  if (!query.metric || !query.dimension) {
    return {
      question,
      interpretation: "aggregate fallback",
      answer: "A grouped aggregate requires both a metric and a categorical dimension.",
      supportingData: []
    };
  }

  if (query.metrics.length > 1) {
    const groupedRows = groupByMetrics(
      rows,
      query.dimension,
      query.metrics,
      query.aggregateOperation,
      query.sortDirection
    ).slice(0, query.limit);
    const leader = groupedRows[0];
    const filterText = formatFilterScope(query);
    const primaryMetric = query.metrics[0];
    const secondaryMetrics = query.metrics.slice(1);
    const dimensionKey = query.dimension;
    const leaderLabel = String(leader?.[dimensionKey] ?? "");

    return {
      question,
      interpretation: `${query.aggregateOperation} ${query.metrics.join(", ")} by ${query.dimension}`,
      answer: leader
        ? `${leaderLabel} has the ${query.sortDirection === "asc" ? "lowest" : "highest"} ${query.aggregateOperation} ${humanize(primaryMetric).toLowerCase()}${filterText}, with ${secondaryMetrics
            .map((metric) => `${humanize(metric).toLowerCase()} ${leader[metric]}`)
            .join(" and ")}.`
        : `No grouped aggregate could be computed${filterText}.`,
      supportingData: query.metrics.map((metric) => ({
        label: metric,
        value: Number(leader?.[metric] ?? 0)
      })),
      resultTable: {
        columns: [query.dimension, ...query.metrics],
        rows: groupedRows
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: primaryMetric,
        series: query.metrics,
        data: groupedRows
      }
    };
  }

  const grouped = groupByMetric(
    rows,
    query.dimension,
    query.metric,
    query.aggregateOperation,
    query.sortDirection
  ).slice(0, query.limit);
  const leader = grouped[0];
  const filterText = formatFilterScope(query);

  return {
    question,
    interpretation: `${query.aggregateOperation} ${query.metric} by ${query.dimension}`,
    answer: leader
      ? `${leader.label} has the ${query.sortDirection === "asc" ? "lowest" : "highest"} ${query.aggregateOperation} ${humanize(query.metric).toLowerCase()}${filterText} at ${leader.value.toFixed(2)}.`
      : `No grouped aggregate could be computed${filterText}.`,
    supportingData: grouped.map((entry) => ({
      label: entry.label,
      value: Number(entry.value.toFixed(2))
    })),
    chartSuggestion: {
      chartType: "bar",
      xKey: query.dimension,
      yKey: query.metric,
      data: grouped.map((entry) => ({
        [query.dimension!]: entry.label,
        [query.metric!]: Number(entry.value.toFixed(2))
      }))
    }
  };
}

function answerSummary(question: string, rows: DatasetRow[], query: PlannedQuery): QuestionAnswer {
  if (!query.metric) {
    return {
      question,
      interpretation: "summary fallback",
      answer: "I could not identify a numeric metric for that question.",
      supportingData: []
    };
  }

  const values = rows
    .map((row) => parseNumber(row[query.metric!]))
    .filter((value): value is number => value !== null);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length > 0 ? total / values.length : 0;

  return {
    question,
    interpretation: `summarize ${query.metric}`,
    answer: `${humanize(query.metric)} totals ${total.toFixed(2)} with an average of ${average.toFixed(2)} across ${values.length} populated records.`,
    supportingData: [
      { label: "total", value: Number(total.toFixed(2)) },
      { label: "average", value: Number(average.toFixed(2)) },
      { label: "records", value: values.length }
    ]
  };
}

export function executePlannedQuery(question: string, query: PlannedQuery, context: QueryContext): QuestionAnswer {
  const filteredRows = applyFilters(context.rows, query);

  if (query.intent === "anomaly") {
    return answerAnomaly(question, context);
  }
  if (query.intent === "compare_trend") {
    return answerComparisonTrend(question, filteredRows, query);
  }
  if (query.intent === "dimension_trend") {
    return answerDimensionTrend(question, filteredRows, query);
  }
  if (query.intent === "trend") {
    return answerTrend(question, filteredRows, query);
  }
  if (query.intent === "compare_segments") {
    return answerComparison(question, filteredRows, query);
  }
  if (query.intent === "aggregate_segments") {
    return answerAggregateSegments(question, filteredRows, query);
  }
  if (query.intent === "top_segment") {
    return answerTopSegment(question, filteredRows, query);
  }

  return answerSummary(question, filteredRows, query);
}
