import type { DatasetProfile, DatasetRow, PlannedQuery, QuestionAnswer } from "./types.js";
import { parseDateValue, parseNumber } from "../utils/inference.js";
import {
  aggregateSemanticMetric as aggregateSemanticRowsMetric,
  normalizeSemanticDimensionValue,
  resolveSemanticMetricValue
} from "./semanticContract.js";

interface QueryContext {
  rows: DatasetRow[];
  profile: DatasetProfile;
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function humanizeDimension(value: string) {
  const cleaned = value
    .replace(/^(source_|geo_)/i, "")
    .replace(/_name$/i, "")
    .replace(/_type$/i, "");
  return humanize(cleaned);
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const absolute = Math.abs(value);
  if (absolute < 1000) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: value % 1 === 0 ? 0 : 2
    }).format(value);
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

function metricUnit(metric: string) {
  const normalized = metric.toLowerCase();
  if (normalized.includes("roas")) {
    return "x";
  }
  if (normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("rate")) {
    return "%";
  }
  if (normalized.includes("revenue")) {
    return "$";
  }
  if (normalized.includes("cost") || normalized.includes("spend")) {
    return "$";
  }
  if (normalized.includes("impression")) {
    return "impressions";
  }
  if (normalized.includes("click")) {
    return "clicks";
  }
  return humanize(metric).toLowerCase();
}

function formatMetricValue(metric: string, value: number) {
  const normalized = metric.toLowerCase();
  if (normalized.includes("roas")) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}x`;
  }

  if (normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("rate")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(percentValue)}%`;
  }

  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income") || normalized.includes("gmv") || normalized.includes("cost") || normalized.includes("spend") || normalized.includes("profit") || normalized.includes("value") || normalized.includes("amount")) {
    return `$${formatCompactNumber(value)}`;
  }

  return `${formatCompactNumber(value)} ${metricUnit(metric)}`;
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(value * 100) >= 10 ? 1 : 2
  }).format(value * 100)}%`;
}

type RankingFocus = "concentration" | "efficiency" | "budget" | "conversion" | "revenue" | "generic";

function detectRankingFocus(question: string, query: PlannedQuery): RankingFocus {
  const normalized = question.toLowerCase();

  if (/(concentrat|share|dominant|too much in one|top 3|mix)/i.test(normalized)) {
    return "concentration";
  }

  if (/(more budget|receive more budget|allocate budget|budget allocation|budget to|high spend|weak revenue|wasting budget|budget waste|burning spend|overspend|underperform|lagging|poor|weak|lowest|bottom)/i.test(normalized)) {
    return "budget";
  }

  if (/(convert|conversion|cvr|ctr|clicks most efficiently|funnel)/i.test(normalized)) {
    return "conversion";
  }

  if (/(roas|roi|efficient|efficiency|return on ad spend|return|scale|scalable)/i.test(normalized)) {
    return "efficiency";
  }

  if (/(revenue|sales|income|gmv|value|amount)/i.test(normalized)) {
    return "revenue";
  }

  if (query.semanticProfile?.businessIntent === "underperforming" || query.semanticProfile?.businessIntent === "wasting_budget") {
    return "budget";
  }

  return "generic";
}

function pickPrimaryMetric(metrics: string[], focus: RankingFocus) {
  const priorities: Record<RankingFocus, string[]> = {
    concentration: ["revenue", "sales", "income", "gmv", "value", "amount"],
    efficiency: ["roas", "roi", "cvr", "ctr", "revenue", "spend"],
    budget: ["roas", "roi", "spend", "revenue", "cvr"],
    conversion: ["cvr", "ctr", "conversions", "clicks", "revenue"],
    revenue: ["revenue", "sales", "income", "gmv", "value", "amount"],
    generic: []
  };

  const priority = priorities[focus];
  return priority.find((metric) => metrics.some((candidate) => candidate.toLowerCase() === metric)) ?? metrics[0];
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

function getSemanticMetricValue(row: DatasetRow, metric: string, profile: DatasetProfile) {
  return resolveSemanticMetricValue(row, metric, profile);
}

function groupByMetric(
  rows: DatasetRow[],
  dimension: string,
  metric: string,
  operation: PlannedQuery["aggregateOperation"],
  sortDirection: PlannedQuery["sortDirection"],
  profile: DatasetProfile
) {
  const grouped = new Map<string, DatasetRow[]>();

  for (const row of rows) {
    const key = row[dimension];
    if (key === null || key === undefined || String(key).trim() === "") {
      continue;
    }
    const normalizedKey = String(normalizeSemanticDimensionValue(key, dimension, profile.semanticContract ?? profile));
    const current = grouped.get(normalizedKey) ?? [];
    current.push(row);
    grouped.set(normalizedKey, current);
  }

  return [...grouped.entries()]
    .map(([label, groupRows]) => ({
      label,
      value:
        semanticMetricAggregation(metric) === "sum"
          ? aggregateValues(
              groupRows
                .map((row) => getSemanticMetricValue(row, metric, profile))
                .filter((value): value is number => value !== null),
              operation
            )
          : aggregateMetricForRows(groupRows, metric, profile)
    }))
    .sort((left, right) =>
      sortDirection === "asc" ? left.value - right.value : right.value - left.value
    );
}

function groupByMetrics(
  rows: DatasetRow[],
  dimension: string,
  metrics: string[],
  operation: PlannedQuery["aggregateOperation"],
  sortDirection: PlannedQuery["sortDirection"],
  profile: DatasetProfile
) {
  const grouped = new Map<string, DatasetRow[]>();

  for (const row of rows) {
    const key = row[dimension];
    if (key === null) {
      continue;
    }

    const groupKey = String(key);
    const current = grouped.get(groupKey) ?? [];
    current.push(row);
    grouped.set(groupKey, current);
  }

  const primaryMetric = metrics[0];
  return [...grouped.entries()]
    .map(([label, groupRows]) => {
      const row: Record<string, string | number> = { [dimension]: label };
      for (const metric of metrics) {
        row[metric] = Number(
          (semanticMetricAggregation(metric) === "sum"
            ? aggregateValues(
                groupRows
                  .map((groupRow) => getSemanticMetricValue(groupRow, metric, profile))
                  .filter((value): value is number => value !== null),
                operation
              )
            : aggregateMetricForRows(groupRows, metric, profile)
          ).toFixed(2)
        );
      }
      return row;
    })
    .sort((left, right) =>
      sortDirection === "asc"
        ? Number(left[primaryMetric] ?? 0) - Number(right[primaryMetric] ?? 0)
        : Number(right[primaryMetric] ?? 0) - Number(left[primaryMetric] ?? 0)
    );
}

function semanticMetricAggregation(metric: string) {
  const normalized = metric.toLowerCase();
  if (
    normalized.includes("roas") ||
    normalized.includes("ctr") ||
    normalized.includes("cvr") ||
    normalized.includes("conversion") ||
    normalized.includes("cost_per") ||
    normalized.includes("cost per") ||
    normalized.includes("duration") ||
    normalized.includes("handle") ||
    normalized.includes("wait") ||
    normalized.includes("ring") ||
    normalized.includes("rate")
  ) {
    return "average";
  }

  return "sum";
}

function aggregateSemanticMetric(metric: string, values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  if (semanticMetricAggregation(metric) === "average") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  return values.reduce((sum, value) => sum + value, 0);
}

function aggregateMetricForRows(rows: DatasetRow[], metric: string, profile: DatasetProfile) {
  if (semanticMetricAggregation(metric) === "sum") {
    const values = rows
      .map((row) => resolveSemanticMetricValue(row, metric, profile))
      .filter((value): value is number => value !== null);
    return values.reduce((sum, value) => sum + value, 0);
  }

  return aggregateSemanticRowsMetric(rows, metric, profile) ?? 0;
}

function inferSemanticMetricDirection(metric: string) {
  const normalized = metric.toLowerCase();
  if (
    normalized.includes("spend") ||
    normalized.includes("cost")
  ) {
    return "low" as const;
  }

  return "high" as const;
}

function questionUsesDirectMetricFocus(question: string, metric: string) {
  const normalizedQuestion = question.toLowerCase();
  const normalizedMetric = metric.toLowerCase();

  if (normalizedMetric === "calls") {
    return /\b(most calls?|highest calls?|least calls?|lowest calls?)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "roas") {
    return /\b(highest roas|lowest roas|best roas)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "repeat_caller_rate") {
    return /\b(highest repeat caller rate|lowest repeat caller rate|repeat caller rate)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "cost_per_qualified_call") {
    return /\b(lowest cost per qualified call|highest cost per qualified call|cpqc)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "cost_per_conversion") {
    return /\b(lowest cost per conversion|highest cost per conversion)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "callDuration") {
    return /\b(longest calls?|shortest calls?|call duration)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "talkTime") {
    return /\b(longest calls?|shortest calls?|call duration|talk time)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "handleTime") {
    return /\b(longest calls?|shortest calls?|call duration|handle time)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "waitTime") {
    return /\b(longest calls?|shortest calls?|call duration|wait time)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "ringTime") {
    return /\b(longest calls?|shortest calls?|call duration|ring time)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "revenue") {
    return /\b(most revenue|highest revenue|lowest revenue)\b/.test(normalizedQuestion);
  }
  if (normalizedMetric === "spend") {
    return /\b(most spend|highest spend|lowest spend)\b/.test(normalizedQuestion);
  }

  return false;
}

function buildSemanticRanking(
  question: string,
  rows: DatasetRow[],
  query: PlannedQuery,
  profile: DatasetProfile
): QuestionAnswer | null {
  if (!query.semanticProfile || !query.dimension || query.metrics.length === 0) {
    return null;
  }

  const grouped = new Map<string, DatasetRow[]>();
  for (const row of rows) {
    const key = row[query.dimension];
    if (key === null || key === undefined || String(key).trim() === "") {
      continue;
    }

    const current = grouped.get(String(key)) ?? [];
    current.push(row);
    grouped.set(String(key), current);
  }

  const metricDetails = query.metrics
    .map((metric) => {
      const signal = query.semanticProfile?.metricSignals.find(
        (entry) => entry.metric.toLowerCase() === metric.toLowerCase()
      );
      return {
        metric,
        direction: signal?.direction ?? inferSemanticMetricDirection(metric),
        weight: signal?.weight ?? 0.1
      };
    })
    .filter((entry) => entry.weight > 0);

  if (grouped.size === 0 || metricDetails.length === 0) {
    return null;
  }

  const focus = detectRankingFocus(question, query);
  const primaryMetric = pickPrimaryMetric(query.metrics, focus);
  const primaryMetricDetails = metricDetails.find((detail) => detail.metric === primaryMetric) ?? metricDetails[0];
  const directMetricHint = query.metrics.find((metric) => questionUsesDirectMetricFocus(question, metric));
  const rankingMetric = directMetricHint ?? primaryMetricDetails?.metric ?? query.metrics[0];
  const questionPrefersLowerValues =
    /(weak|underperform|wasting budget|lowest|bottom|lagging|poor)/i.test(question) ||
    query.semanticProfile?.businessIntent === "underperforming" ||
    query.semanticProfile?.businessIntent === "wasting_budget";

  const aggregatedRows = [...grouped.entries()].map(([label, groupRows]) => {
    const aggregatedMetrics: Record<string, number> = {};

    for (const detail of metricDetails) {
      const value = aggregateMetricForRows(groupRows, detail.metric, profile);
      aggregatedMetrics[detail.metric] = Number(value.toFixed(2));
    }

    return {
      label,
      metrics: aggregatedMetrics
    };
  });

  const totalRankingMetric = aggregatedRows.reduce((sum, entry) => sum + (entry.metrics[rankingMetric] ?? 0), 0);
  const ranges = new Map<string, { min: number; max: number }>();
  for (const detail of metricDetails) {
    const values = aggregatedRows.map((entry) => entry.metrics[detail.metric]).filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      continue;
    }
    ranges.set(detail.metric, {
      min: Math.min(...values),
      max: Math.max(...values)
    });
  }

  const scoredRows = aggregatedRows
    .map((entry) => {
      let weightedScore = 0;
      let totalWeight = 0;

      for (const detail of metricDetails) {
        const range = ranges.get(detail.metric);
        const value = entry.metrics[detail.metric];
        if (!range || !Number.isFinite(value)) {
          continue;
        }

        const normalized =
          range.max === range.min ? 0.5 : (value - range.min) / (range.max - range.min);
        const oriented = detail.direction === "high" ? normalized : 1 - normalized;
        weightedScore += oriented * detail.weight;
        totalWeight += detail.weight;
      }

      const score = totalWeight > 0 ? weightedScore / totalWeight : 0.5;
      return {
        ...entry,
      score: Number(score.toFixed(4))
    };
    });

  const normalizedQuestion = question.toLowerCase();
  if (/\b(cost per qualified call|cpqc)\b/.test(normalizedQuestion) && aggregatedRows.some((entry) => Number.isFinite(entry.metrics.cost_per_qualified_call))) {
    const rankedByCpqc = [...scoredRows]
      .sort((left, right) => (left.metrics.cost_per_qualified_call ?? Number.POSITIVE_INFINITY) - (right.metrics.cost_per_qualified_call ?? Number.POSITIVE_INFINITY));
    const leaderCpqc = rankedByCpqc[0];
    const runnerUpCpqc = rankedByCpqc[1];
    const leaderValueCpqc = leaderCpqc?.metrics.cost_per_qualified_call ?? 0;
    const runnerUpValueCpqc = runnerUpCpqc?.metrics.cost_per_qualified_call ?? 0;
    const comparisonCpqc = runnerUpCpqc && Number.isFinite(runnerUpValueCpqc)
      ? ` It is below ${runnerUpCpqc.label} by ${formatMetricValue("cost_per_qualified_call", Math.abs(leaderValueCpqc - runnerUpValueCpqc))}.`
      : "";
    return {
      question,
      interpretation: "semantic ranking for cost per qualified call",
      answer: `${leaderCpqc.label} has the lowest cost per qualified call at ${formatMetricValue("cost_per_qualified_call", leaderValueCpqc)}.${comparisonCpqc}`,
      supportingData: rankedByCpqc.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: formatMetricValue("cost_per_qualified_call", entry.metrics.cost_per_qualified_call ?? 0)
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedByCpqc.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "cost_per_qualified_call",
        data: rankedByCpqc.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          cost_per_qualified_call: Number((entry.metrics.cost_per_qualified_call ?? 0).toFixed(2)),
          semantic_score: Number(entry.score.toFixed(4))
        }))
      }
    };
  }

  if (/\b(spending but not converting|not converting|wasting spend|waste budget)\b/.test(normalizedQuestion)) {
    const rankedByPressure = [...scoredRows].sort((left, right) => right.score - left.score);
    const leaderPressure = rankedByPressure[0];
    const runnerUpPressure = rankedByPressure[1];
    const leaderSpend = leaderPressure?.metrics.spend ?? 0;
    const leaderConverted = leaderPressure?.metrics.convertedCall ?? 0;
    const comparisonPressure =
      runnerUpPressure && Number.isFinite(runnerUpPressure.score)
        ? ` It is ahead of ${runnerUpPressure.label} on the underperformance score by ${Math.abs(leaderPressure.score - runnerUpPressure.score).toFixed(2)}.`
        : "";
    return {
      question,
      interpretation: "semantic ranking for budget pressure",
      answer: `${leaderPressure.label} shows the strongest budget pressure with ${formatMetricValue("spend", leaderSpend)} spend and ${formatCompactNumber(leaderConverted)} converted calls.${comparisonPressure}`,
      supportingData: rankedByPressure.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: `spend ${formatMetricValue("spend", entry.metrics.spend ?? 0)} · converted ${formatMetricValue("convertedCall", entry.metrics.convertedCall ?? 0)}`
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedByPressure.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "semantic_score",
        data: rankedByPressure.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          spend: Number((entry.metrics.spend ?? 0).toFixed(2)),
          convertedCall: Number((entry.metrics.convertedCall ?? 0).toFixed(2))
        }))
      }
    };
  }

  if (/\brevenue but low call volume\b/.test(normalizedQuestion)) {
    const rankedByGrowth = [...scoredRows].sort((left, right) => right.score - left.score);
    const leaderGrowth = rankedByGrowth[0];
    const runnerUpGrowth = rankedByGrowth[1];
    const leaderRevenue = leaderGrowth?.metrics.revenue ?? 0;
    const leaderCalls = leaderGrowth?.metrics.calls ?? 0;
    const comparisonGrowth =
      runnerUpGrowth && Number.isFinite(runnerUpGrowth.score)
        ? ` It is ahead of ${runnerUpGrowth.label} on the growth score by ${Math.abs(leaderGrowth.score - runnerUpGrowth.score).toFixed(2)}.`
        : "";
    return {
      question,
      interpretation: "semantic ranking for revenue with low call volume",
      answer: `${leaderGrowth.label} combines high revenue and low call volume, with ${formatMetricValue("revenue", leaderRevenue)} revenue and ${formatCompactNumber(leaderCalls)} calls.${comparisonGrowth}`,
      supportingData: rankedByGrowth.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: `revenue ${formatMetricValue("revenue", entry.metrics.revenue ?? 0)} · calls ${formatMetricValue("calls", entry.metrics.calls ?? 0)}`
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedByGrowth.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "semantic_score",
        data: rankedByGrowth.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          revenue: Number((entry.metrics.revenue ?? 0).toFixed(2)),
          calls: Number((entry.metrics.calls ?? 0).toFixed(2))
        }))
      }
    };
  }

  const useCompositeRanking =
    !questionUsesDirectMetricFocus(question, rankingMetric) &&
    !questionUsesDirectMetricFocus(question, primaryMetric) &&
    (focus === "generic" ||
    metricDetails.length > 1 ||
    query.semanticProfile?.businessIntent === "underperforming" ||
    query.semanticProfile?.businessIntent === "wasting_budget" ||
    query.semanticProfile?.businessIntent === "scalable" ||
    query.semanticProfile?.businessIntent === "growth_opportunity" ||
    query.semanticProfile?.businessIntent === "high_potential" ||
    query.semanticProfile?.businessIntent === "best_performing" ||
    query.semanticProfile?.businessIntent === "efficient");

  const rankedRows = useCompositeRanking
    ? scoredRows.sort((left, right) => right.score - left.score)
    : scoredRows.sort((left, right) => {
        const leftValue = left.metrics[rankingMetric] ?? 0;
        const rightValue = right.metrics[rankingMetric] ?? 0;
        return questionPrefersLowerValues ? leftValue - rightValue : rightValue - leftValue;
      });

  if (rankedRows.length === 0) {
    return null;
  }

  const leader = rankedRows[0];
  const runnerUp = rankedRows[1];
  const leaderValue = leader.metrics[rankingMetric] ?? 0;
  const runnerUpValue = runnerUp?.metrics[rankingMetric] ?? 0;
  const dimensionLabel = humanizeDimension(query.dimension).toLowerCase();
  const metricLabel = humanize(rankingMetric).toLowerCase();
  const highlightedSignals = [...metricDetails]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 3)
    .map((detail) => `${humanize(detail.metric).toLowerCase()} ${formatMetricValue(detail.metric, leader.metrics[detail.metric] ?? 0)}`);
  const comparisonText =
    runnerUp && Number.isFinite(runnerUpValue)
      ? ` It is ${questionPrefersLowerValues ? "below" : "ahead of"} ${runnerUp.label} by ${formatMetricValue(rankingMetric, Math.abs(leaderValue - runnerUpValue))}.`
      : "";

  if (focus === "concentration") {
    const leaderShare = totalRankingMetric > 0 ? leaderValue / totalRankingMetric : 0;
    const top3Share =
      totalRankingMetric > 0
        ? rankedRows.slice(0, 3).reduce((sum, entry) => sum + (entry.metrics[rankingMetric] ?? 0), 0) / totalRankingMetric
        : 0;
    return {
      question,
      interpretation: "semantic ranking for concentration",
      answer: `${leader.label} accounts for ${formatPercent(leaderShare)} of ${metricLabel}, and the top 3 ${dimensionLabel} segments contribute ${formatPercent(top3Share)}.`,
      supportingData: rankedRows.slice(0, query.limit).map((entry) => {
        const share = totalRankingMetric > 0 ? (entry.metrics[rankingMetric] ?? 0) / totalRankingMetric : 0;
        return {
          label: entry.label,
          value: `${formatPercent(share)} share`
        };
      }),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "semantic_score",
        data: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      }
    };
  }

  if (focus === "efficiency") {
    const spend = leader.metrics.spend !== undefined ? ` and ${formatMetricValue("spend", leader.metrics.spend)} spend` : "";
    const revenue = leader.metrics.revenue !== undefined ? ` with ${formatMetricValue("revenue", leader.metrics.revenue)} revenue` : "";
    return {
      question,
      interpretation: `semantic ranking for ${metricLabel}`,
      answer: `${leader.label} is the efficiency leader at ${formatMetricValue(rankingMetric, leaderValue)}${revenue}${spend}.${comparisonText}`,
      supportingData: rankedRows.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: formatMetricValue(rankingMetric, entry.metrics[rankingMetric] ?? 0)
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "semantic_score",
        data: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      }
    };
  }

  if (focus === "budget") {
    const spend = leader.metrics.spend !== undefined ? ` with ${formatMetricValue("spend", leader.metrics.spend)} spend` : "";
    const revenue = leader.metrics.revenue !== undefined ? ` and ${formatMetricValue("revenue", leader.metrics.revenue)} revenue` : "";
    const budgetLabel = questionPrefersLowerValues ? "the weakest efficiency signal" : "the strongest scale candidate";
    return {
      question,
      interpretation: `semantic ranking for budget allocation`,
      answer: `${leader.label} is ${budgetLabel} at ${formatMetricValue(rankingMetric, leaderValue)}${spend}${revenue}.${comparisonText}`,
      supportingData: rankedRows.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: formatMetricValue(rankingMetric, entry.metrics[rankingMetric] ?? 0)
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "semantic_score",
        data: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      }
    };
  }

  if (focus === "conversion") {
    const clicks = leader.metrics.clicks !== undefined ? ` with ${formatMetricValue("clicks", leader.metrics.clicks)} of traffic` : "";
    const revenue = leader.metrics.revenue !== undefined ? ` with ${formatMetricValue("revenue", leader.metrics.revenue)} revenue` : "";
    return {
      question,
      interpretation: `semantic ranking for conversion efficiency`,
      answer: `${leader.label} converts most efficiently at ${formatMetricValue(rankingMetric, leaderValue)}${clicks}${revenue}.${comparisonText}`,
      supportingData: rankedRows.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: formatMetricValue(rankingMetric, entry.metrics[rankingMetric] ?? 0)
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "semantic_score",
        data: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      }
    };
  }

  if (focus === "revenue") {
    return {
      question,
      interpretation: `semantic ranking for revenue`,
      answer: `${leader.label} leads ${metricLabel} at ${formatMetricValue(rankingMetric, leaderValue)}, ahead of ${runnerUp?.label ?? "the next segment"} by ${formatMetricValue(rankingMetric, Math.abs(leaderValue - runnerUpValue))}.`,
      supportingData: rankedRows.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: formatMetricValue(rankingMetric, entry.metrics[rankingMetric] ?? 0)
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: "semantic_score",
        data: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      }
    };
  }

  if (questionUsesDirectMetricFocus(question, rankingMetric)) {
    return {
      question,
      interpretation: `semantic ranking for ${humanize(rankingMetric).toLowerCase()}`,
      answer: `${leader.label} has the ${questionPrefersLowerValues ? "lowest" : "highest"} ${humanize(rankingMetric).toLowerCase()} at ${formatMetricValue(rankingMetric, leaderValue)}.${comparisonText}`,
      supportingData: rankedRows.slice(0, query.limit).map((entry) => ({
        label: entry.label,
        value: formatMetricValue(rankingMetric, entry.metrics[rankingMetric] ?? 0)
      })),
      resultTable: {
        columns: [query.dimension, "semantic_score", ...query.metrics],
        rows: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          semantic_score: Number(entry.score.toFixed(4)),
          ...entry.metrics
        }))
      },
      chartSuggestion: {
        chartType: "bar",
        xKey: query.dimension,
        yKey: rankingMetric,
        data: rankedRows.slice(0, query.limit).map((entry) => ({
          [query.dimension!]: entry.label,
          [rankingMetric]: Number(entry.metrics[rankingMetric]?.toFixed?.(2) ?? entry.metrics[rankingMetric] ?? 0),
          semantic_score: Number(entry.score.toFixed(4))
        }))
      }
    };
  }

  return {
    question,
    interpretation: `semantic ranking for ${questionPrefersLowerValues ? "weaker performance" : "broad performance"}`,
    answer: `${leader.label} shows the strongest ${humanize(primaryMetric).toLowerCase()}-anchored signal because it combines ${highlightedSignals.join(", ")}.${comparisonText}`,
    supportingData: rankedRows.slice(0, query.limit).map((entry) => ({
      label: entry.label,
      value: formatMetricValue(rankingMetric, entry.metrics[rankingMetric] ?? 0)
    })),
    resultTable: {
      columns: [query.dimension, "semantic_score", ...query.metrics],
      rows: rankedRows.slice(0, query.limit).map((entry) => ({
        [query.dimension!]: entry.label,
        semantic_score: Number(entry.score.toFixed(4)),
        ...entry.metrics
      }))
    },
    chartSuggestion: {
      chartType: "bar",
      xKey: query.dimension,
      yKey: "semantic_score",
      data: rankedRows.slice(0, query.limit).map((entry) => ({
        [query.dimension!]: entry.label,
        semantic_score: Number(entry.score.toFixed(4)),
        ...entry.metrics
      }))
    }
  };
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
    answer: `${humanize(outlier.column)} is the strongest anomaly signal with ${outlier.count} outlier values between ${formatMetricValue(outlier.column, outlier.min)} and ${formatMetricValue(outlier.column, outlier.max)}.`,
    supportingData: [
      { label: "column", value: outlier.column },
      { label: "outlier_count", value: outlier.count },
      { label: "min_outlier", value: Number(outlier.min.toFixed(2)) },
      { label: "max_outlier", value: Number(outlier.max.toFixed(2)) }
    ]
  };
}

function answerTrend(question: string, rows: DatasetRow[], query: PlannedQuery, profile: DatasetProfile): QuestionAnswer {
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
        const metricValue = getSemanticMetricValue(row, metric, profile);
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
      answer: `${humanize(primaryMetric)} shows a ${direction} trend${filterText} from ${formatMetricValue(primaryMetric, firstValue)} on ${String(first.date)} to ${formatMetricValue(primaryMetric, lastValue)} on ${String(last.date)}, alongside ${query.metrics
        .slice(1)
        .map((metric) => `${humanize(metric).toLowerCase()} ${formatMetricValue(metric, Number(last[metric] ?? 0))} at the latest point`)
        .join(" and ")}.`,
      supportingData: query.metrics.map((metric) => ({
        label: metric,
        value: Number(last[metric] ?? 0)
      })),
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
    const metricValue = getSemanticMetricValue(row, query.metric, profile);
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
    answer: `${humanize(query.metric)} shows a ${direction} trend${filterText} from ${formatMetricValue(query.metric, first.value)} on ${first.date} to ${formatMetricValue(query.metric, last.value)} on ${last.date}.`,
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

function answerDimensionTrend(question: string, rows: DatasetRow[], query: PlannedQuery, profile: DatasetProfile): QuestionAnswer {
  if (!query.datetimeColumn || !query.metric || !query.dimension) {
    return answerTrend(question, rows, query, profile);
  }

  const totalsByDimension = new Map<string, number>();
  for (const row of rows) {
    const dimensionValue: string | number | boolean | null = row[query.dimension];
    const metricValue = getSemanticMetricValue(row, query.metric, profile);
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
    return answerTrend(question, rows, query, profile);
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
        const metricValue = getSemanticMetricValue(row, metric, profile);
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
      return answerTrend(question, rows, query, profile);
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
      answer: `${leader.label} shows the strongest ${humanize(primaryMetric).toLowerCase()}-anchored trend${filterText} across ${query.dimension} for ${seriesLabelText}, with totals of ${formatMetricValue(primaryMetric, leader.value)} vs ${formatMetricValue(primaryMetric, laggard.value)} over the selected period.`,
      supportingData: metricTotalsByDimension.map((entry) => ({
        label: entry.label,
        value: Number(entry.value.toFixed(2))
      })),
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
    const metricValue = getSemanticMetricValue(row, query.metric, profile);

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
    return answerTrend(question, rows, query, profile);
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
    answer: `${leader.label} shows the strongest ${humanize(query.metric).toLowerCase()} trend${filterText} across ${query.dimension} for ${seriesLabelText}, with totals of ${formatMetricValue(query.metric, leader.value)} vs ${formatMetricValue(query.metric, laggard.value)} over the selected period.`,
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

function answerTopSegment(question: string, rows: DatasetRow[], query: PlannedQuery, profile: DatasetProfile): QuestionAnswer {
  if (query.semanticProfile && query.metrics.length > 0) {
    const semanticAnswer = buildSemanticRanking(question, rows, query, profile);
    if (semanticAnswer) {
      return semanticAnswer;
    }
  }

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
    query.sortDirection,
    profile
  ).slice(0, query.limit);
  const winner = ranked[0];
  const filterText = formatFilterScope(query);

  return {
    question,
    interpretation: `rank ${query.dimension} by ${query.aggregateOperation} ${query.metric}`,
    answer: winner
      ? `${winner.label} has the strongest ${humanize(query.metric).toLowerCase()}${filterText} at ${formatMetricValue(query.metric, winner.value)}.`
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

function answerComparison(question: string, rows: DatasetRow[], query: PlannedQuery, profile: DatasetProfile): QuestionAnswer {
  if (!query.metric || !query.dimension || query.comparisonValues.length < 2) {
    return answerTopSegment(question, rows, query, profile);
  }

  const grouped = groupByMetric(
    rows,
    query.dimension,
    query.metric,
    query.aggregateOperation,
    query.sortDirection,
    profile
  ).filter((entry) =>
    query.comparisonValues.some((value) => value.toLowerCase() === entry.label.toLowerCase())
  );

  if (grouped.length < 2) {
    return answerTopSegment(question, rows, query, profile);
  }

  const leader = grouped[0];
  const laggard = grouped[grouped.length - 1];
  const filterText = formatFilterScope(query);

  return {
    question,
    interpretation: `compare ${query.dimension} values on ${query.aggregateOperation} ${query.metric}`,
    answer: `${leader.label} leads ${laggard.label} on ${humanize(query.metric).toLowerCase()}${filterText} by ${formatMetricValue(query.metric, leader.value - laggard.value)}.`,
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

function answerComparisonTrend(question: string, rows: DatasetRow[], query: PlannedQuery, profile: DatasetProfile): QuestionAnswer {
  if (!query.metric || !query.dimension || !query.datetimeColumn || query.comparisonValues.length < 2) {
    return answerComparison(question, rows, query, profile);
  }

  const grouped = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const date = parseDateValue(row[query.datetimeColumn]);
    const dimensionValue: string | number | boolean | null = row[query.dimension];
    const metricValue = getSemanticMetricValue(row, query.metric, profile);

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
    return answerComparison(question, rows, query, profile);
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
    .map((series) => `${series} ${formatMetricValue(query.metric!, Number(latestBySeries.get(series) ?? 0))}`)
    .join(" and ");

  return {
    question,
    interpretation: `compare ${query.dimension} trend of ${query.metric}`,
    answer: `${leader.label} shows the stronger ${humanize(query.metric).toLowerCase()} trend${filterText} across the selected period, with period totals of ${formatMetricValue(query.metric, leader.value)} vs ${formatMetricValue(query.metric, laggard.value)} and latest observed values of ${latestSummary}.`,
    supportingData: totals.map((entry) => ({
      label: entry.label,
      value: Number(entry.value.toFixed(2))
    })),
    chartSuggestion: {
      chartType: "line",
      xKey: "date",
      yKey: query.metric,
      series: query.comparisonValues,
      data
    }
  };
}

function answerAggregateSegments(question: string, rows: DatasetRow[], query: PlannedQuery, profile: DatasetProfile): QuestionAnswer {
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
      query.sortDirection,
      profile
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
            .map((metric) => `${humanize(metric).toLowerCase()} ${formatMetricValue(metric, Number(leader[metric] ?? 0))}`)
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
    query.sortDirection,
    profile
  ).slice(0, query.limit);
  const leader = grouped[0];
  const filterText = formatFilterScope(query);

  return {
    question,
    interpretation: `${query.aggregateOperation} ${query.metric} by ${query.dimension}`,
    answer: leader
      ? `${leader.label} has the ${query.sortDirection === "asc" ? "lowest" : "highest"} ${query.aggregateOperation} ${humanize(query.metric).toLowerCase()}${filterText} at ${formatMetricValue(query.metric, leader.value)}.`
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

function answerSummary(question: string, rows: DatasetRow[], query: PlannedQuery, profile: DatasetProfile): QuestionAnswer {
  if (query.semanticProfile && query.dimension && query.metrics.length > 0) {
    const semanticAnswer = buildSemanticRanking(question, rows, query, profile);
    if (semanticAnswer) {
      return semanticAnswer;
    }
  }

  if (!query.metric) {
    return {
      question,
      interpretation: "summary fallback",
      answer: "I could not build a numeric ranking from the available fields, so this is a high-level business read only.",
      supportingData: []
    };
  }

  const values = rows
    .map((row) => getSemanticMetricValue(row, query.metric!, profile))
    .filter((value): value is number => value !== null);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length > 0 ? total / values.length : 0;

  return {
    question,
    interpretation: `summarize ${query.metric}`,
    answer: `${humanize(query.metric)} totals ${formatMetricValue(query.metric, total)} with an average of ${formatMetricValue(query.metric, average)} across ${values.length} records.`,
    supportingData: [
      { label: "total", value: Number(total.toFixed(2)) },
      { label: "average", value: Number(average.toFixed(2)) },
      { label: "records", value: values.length }
    ]
  };
}

export function executePlannedQuery(question: string, query: PlannedQuery, context: QueryContext): QuestionAnswer {
  if (query.unavailableMetricReasons && query.unavailableMetricReasons.length > 0) {
    return {
      question,
      interpretation: "missing semantic requirements",
      answer: query.unavailableMetricReasons[0],
      supportingData: query.unavailableMetricReasons.map((reason, index) => ({
        label: index === 0 ? "reason" : `reason ${index + 1}`,
        value: reason
      }))
    };
  }

  const filteredRows = applyFilters(context.rows, query);

  if (query.intent === "anomaly") {
    return answerAnomaly(question, context);
  }
  if (query.intent === "compare_trend") {
    return answerComparisonTrend(question, filteredRows, query, context.profile);
  }
  if (query.intent === "dimension_trend") {
    return answerDimensionTrend(question, filteredRows, query, context.profile);
  }
  if (query.intent === "trend") {
    return answerTrend(question, filteredRows, query, context.profile);
  }
  if (query.intent === "compare_segments") {
    return answerComparison(question, filteredRows, query, context.profile);
  }
  if (query.intent === "aggregate_segments") {
    return answerAggregateSegments(question, filteredRows, query, context.profile);
  }
  if (query.intent === "top_segment") {
    return answerTopSegment(question, filteredRows, query, context.profile);
  }

  return answerSummary(question, filteredRows, query, context.profile);
}
