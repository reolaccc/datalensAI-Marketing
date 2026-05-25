import type { DatasetProfile, PlannedQuery, QuestionContextInput } from "./types.js";
import { KPI_ALIASES } from "../utils/inference.js";
import {
  buildSemanticMetricList,
  detectSemanticBusinessIntent
} from "../services/analytics/intent/semanticBusinessIntent.js";

function normalize(text: string) {
  return text.toLowerCase();
}

function replaceToken(question: string, pattern: RegExp, replacement?: string | number) {
  if (replacement === undefined || replacement === null || replacement === "") {
    return question;
  }
  return question.replace(pattern, String(replacement));
}

function resolveDynamicContextReferences(question: string, input?: QuestionContextInput) {
  let resolvedQuestion = question;
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined date|selected date|chosen date)\b/gi,
    input?.selectedDate
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined threshold|selected threshold|chosen threshold)\b/gi,
    input?.selectedThreshold
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined metric|selected metric|chosen metric)\b/gi,
    input?.selectedMetric
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined dimension|selected dimension|chosen dimension)\b/gi,
    input?.selectedDimension
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined category|selected category|chosen category)\b/gi,
    input?.selectedCategory
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined segment a|selected segment a|chosen segment a)\b/gi,
    input?.selectedSegmentA
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined segment b|selected segment b|chosen segment b)\b/gi,
    input?.selectedSegmentB
  );
  return resolvedQuestion;
}

function resolveMetrics(question: string, profile: DatasetProfile): string[] {
  const normalizedQuestion = normalize(question);
  const matches: string[] = [];

  for (const [metric, aliases] of Object.entries(KPI_ALIASES)) {
    if (
      normalizedQuestion.includes(metric.replace(/_/g, " ")) ||
      aliases.some((alias) => normalizedQuestion.includes(alias.replace(/_/g, " ")))
    ) {
      const matched = profile.numericColumns.find(
        (column) => column.includes(metric) || aliases.some((alias) => column.includes(alias))
      );
      if (matched) {
        matches.push(matched);
      }
    }
  }

  return [...new Set(matches)];
}

function resolveDimension(
  question: string,
  profile: DatasetProfile,
  input?: QuestionContextInput,
  comparisonValues: string[] = [],
  semanticHints: string[] = []
): string | null {
  const normalizedQuestion = normalize(question);
  const normalizedSemanticHints = semanticHints.map((hint) => normalize(hint));

  if (input?.selectedDimension && profile.categoricalColumns.includes(input.selectedDimension)) {
    return input.selectedDimension;
  }

  const scoredDimensions = profile.columns
    .filter((column) => column.kind === "categorical")
    .map((column) => {
      let score = 0;
      const readableName = column.name.replace(/_/g, " ");

      if (normalizedQuestion.includes(readableName)) {
        score += 10;
      }

      if (normalizedSemanticHints.some((hint) => readableName.includes(hint) || hint.includes(readableName))) {
        score += 8;
      }

      const values = column.topCategories?.map((entry) => entry.value.toLowerCase()) ?? [];
      for (const comparisonValue of comparisonValues) {
        if (values.includes(comparisonValue.toLowerCase())) {
          score += 3;
        }
      }

      for (const category of column.topCategories ?? []) {
        if (normalizedQuestion.includes(category.value.toLowerCase())) {
          score += 1;
        }
      }

      return { name: column.name, score };
    })
    .sort((left, right) => right.score - left.score);

  if (scoredDimensions[0] && scoredDimensions[0].score > 0) {
    return scoredDimensions[0].name;
  }

  const preferred = ["channel", "campaign", "device", "source"];
  return preferred.find((column) => profile.categoricalColumns.includes(column)) ?? profile.categoricalColumns[0] ?? null;
}

function detectIntent(question: string, semanticProfile?: ReturnType<typeof detectSemanticBusinessIntent>): PlannedQuery["intent"] {
  const normalizedQuestion = normalize(question);
  const hasByClause = normalizedQuestion.includes(" by ");
  const hasMultipleMetrics =
    normalizedQuestion.includes(" and ") &&
    (
      normalizedQuestion.includes("revenue") ||
      normalizedQuestion.includes("cost") ||
      normalizedQuestion.includes("conversion rate") ||
      normalizedQuestion.includes("roas") ||
      normalizedQuestion.includes("clicks") ||
      normalizedQuestion.includes("impressions")
    );
  if (
    normalizedQuestion.includes("compare") ||
    normalizedQuestion.includes("versus") ||
    normalizedQuestion.includes(" vs ")
  ) {
    if (normalizedQuestion.includes("trend") || normalizedQuestion.includes("over time")) {
      return "compare_trend";
    }
    return "compare_segments";
  }
  if ((normalizedQuestion.includes("trend") || normalizedQuestion.includes("over time")) && hasByClause) {
    return "dimension_trend";
  }
  if (
    hasByClause &&
    (
      normalizedQuestion.includes("average") ||
      normalizedQuestion.includes("avg") ||
      normalizedQuestion.includes("mean") ||
      normalizedQuestion.includes("sum") ||
      normalizedQuestion.includes("total") ||
      normalizedQuestion.includes("minimum") ||
      normalizedQuestion.includes("maximum") ||
      normalizedQuestion.includes("lowest") ||
      hasMultipleMetrics
    )
  ) {
    return "aggregate_segments";
  }
  if (normalizedQuestion.includes("trend") || normalizedQuestion.includes("over time")) {
    return "trend";
  }
  if (
    normalizedQuestion.includes("anomaly") ||
    normalizedQuestion.includes("anomalies") ||
    normalizedQuestion.includes("outlier") ||
    normalizedQuestion.includes("investigate") ||
    normalizedQuestion.includes("issue")
  ) {
    return "anomaly";
  }
  if (
    normalizedQuestion.includes("best") ||
    normalizedQuestion.includes("top") ||
    normalizedQuestion.includes("highest") ||
    normalizedQuestion.includes("strongest") ||
    normalizedQuestion.includes("winner") ||
    normalizedQuestion.includes("winning") ||
    normalizedQuestion.includes("potential") ||
    normalizedQuestion.includes("scalable") ||
    normalizedQuestion.includes("efficient") ||
    normalizedQuestion.includes("underperforming") ||
    normalizedQuestion.includes("wasting budget") ||
    semanticProfile?.businessIntent !== "neutral"
  ) {
    return "top_segment";
  }
  return "summary";
}

function resolveAggregateOperation(
  question: string,
  metric: string | null,
  intent: PlannedQuery["intent"]
): PlannedQuery["aggregateOperation"] {
  const normalizedQuestion = normalize(question);
  const isRateMetric = metric?.includes("rate") ?? false;

  if (normalizedQuestion.includes("average") || normalizedQuestion.includes("avg") || normalizedQuestion.includes("mean")) {
    return "average";
  }

  if (normalizedQuestion.includes("sum") || normalizedQuestion.includes("total")) {
    return "sum";
  }

  if (normalizedQuestion.includes("minimum") || normalizedQuestion.includes("min")) {
    return "min";
  }

  if (normalizedQuestion.includes("maximum") || normalizedQuestion.includes("max")) {
    return "max";
  }

  if (normalizedQuestion.includes("lowest")) {
    return isRateMetric ? "average" : "min";
  }

  if (normalizedQuestion.includes("highest")) {
    return intent === "aggregate_segments" ? (isRateMetric ? "average" : "max") : "sum";
  }

  return "sum";
}

function resolveSortDirection(question: string): PlannedQuery["sortDirection"] {
  const normalizedQuestion = normalize(question);
  if (
    normalizedQuestion.includes("lowest") ||
    normalizedQuestion.includes("minimum") ||
    normalizedQuestion.includes("bottom")
  ) {
    return "asc";
  }

  return "desc";
}

function extractFilters(question: string, profile: DatasetProfile): PlannedQuery["filters"] {
  const normalizedQuestion = normalize(question);
  const filters: PlannedQuery["filters"] = [];

  for (const column of profile.categoricalColumns) {
    const profileEntry = profile.columns.find((entry) => entry.name === column);
    for (const category of profileEntry?.topCategories ?? []) {
      if (normalizedQuestion.includes(category.value.toLowerCase())) {
        filters.push({ column, operator: "eq", value: category.value });
      }
    }
  }

  return filters.filter(
    (filter, index, allFilters) =>
      allFilters.findIndex(
        (candidate) =>
          candidate.column === filter.column &&
          candidate.operator === filter.operator &&
          candidate.value === filter.value
      ) === index
  );
}

function extractNumericAndDateFilters(
  question: string,
  profile: DatasetProfile
): PlannedQuery["filters"] {
  const filters: PlannedQuery["filters"] = [];

  for (const column of profile.numericColumns) {
    const readable = column.replace(/_/g, "[ _]?");
    const patterns: Array<{ regex: RegExp; operator: PlannedQuery["filters"][number]["operator"] }> = [
      { regex: new RegExp(`${readable}\\s*(?:>|over|greater than|above)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "gt" },
      { regex: new RegExp(`${readable}\\s*(?:>=|at least|min(?:imum)? of)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "gte" },
      { regex: new RegExp(`${readable}\\s*(?:<|under|less than|below)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "lt" },
      { regex: new RegExp(`${readable}\\s*(?:<=|at most|max(?:imum)? of)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "lte" }
    ];

    for (const pattern of patterns) {
      const match = question.match(pattern.regex);
      if (match) {
        filters.push({
          column,
          operator: pattern.operator,
          value: Number(match[1])
        });
      }
    }
  }

  for (const column of profile.datetimeColumns) {
    const readable = column.replace(/_/g, "[ _]?");
    const afterMatch = question.match(new RegExp(`(?:${readable}\\s*)?(?:after|since)\\s*(\\d{4}-\\d{2}-\\d{2})`, "i"));
    const beforeMatch = question.match(new RegExp(`(?:${readable}\\s*)?(?:before|until)\\s*(\\d{4}-\\d{2}-\\d{2})`, "i"));

    if (afterMatch) {
      filters.push({
        column,
        operator: "after",
        value: afterMatch[1]
      });
    }

    if (beforeMatch) {
      filters.push({
        column,
        operator: "before",
        value: beforeMatch[1]
      });
    }
  }

  return filters;
}

function extractFiltersForDimension(
  question: string,
  profile: DatasetProfile,
  excludedColumn: string | null,
  excludedValues: string[]
): PlannedQuery["filters"] {
  const allFilters = [...extractFilters(question, profile), ...extractNumericAndDateFilters(question, profile)];

  return allFilters.filter(
    (filter) => {
      if (filter.operator !== "eq" || filter.column !== excludedColumn || typeof filter.value !== "string") {
        return true;
      }

      const filterValue = filter.value;
      return !excludedValues.some((value) => value.toLowerCase() === filterValue.toLowerCase());
    }
  );
}

function extractComparisonValues(question: string, profile: DatasetProfile): string[] {
  const normalizedQuestion = normalize(question);
  const valuesWithPosition: Array<{ value: string; position: number }> = [];

  for (const column of profile.categoricalColumns) {
    const profileEntry = profile.columns.find((entry) => entry.name === column);
    for (const category of profileEntry?.topCategories ?? []) {
      const value = category.value.toLowerCase();
      const position = normalizedQuestion.indexOf(value);
      if (position >= 0) {
        valuesWithPosition.push({ value: category.value, position });
      }
    }
  }

  return [...new Map(valuesWithPosition.sort((left, right) => left.position - right.position).map((entry) => [entry.value.toLowerCase(), entry.value])).values()].slice(0, 4);
}

function resolveLimit(question: string) {
  const match = normalize(question).match(/top\s+(\d+)/);
  return match ? Number(match[1]) : 5;
}

function extractDimensionTopValues(question: string, profile: DatasetProfile, dimension: string | null): string[] {
  if (!dimension) {
    return [];
  }

  const normalizedQuestion = normalize(question);
  const matchingColumn = profile.columns.find((column) => column.name === dimension);
  const values: Array<{ value: string; position: number }> = [];

  for (const category of matchingColumn?.topCategories ?? []) {
    const position = normalizedQuestion.indexOf(category.value.toLowerCase());
    if (position >= 0) {
      values.push({ value: category.value, position });
    }
  }

  return values
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.value);
}

export function planQuery(
  question: string,
  profile: DatasetProfile,
  input?: QuestionContextInput
): PlannedQuery {
  const resolvedQuestion = resolveDynamicContextReferences(question, input);
  const semanticProfile = detectSemanticBusinessIntent(resolvedQuestion, {
    availableMetrics: profile.numericColumns,
    availableDimensions: profile.categoricalColumns
  });
  const explicitMetrics = resolveMetrics(resolvedQuestion, profile);
  const semanticMetrics = buildSemanticMetricList(semanticProfile, profile.numericColumns);
  const metrics = [...new Set([...explicitMetrics, ...semanticMetrics])];
  const metric = metrics[0] ?? null;
  const intent = detectIntent(resolvedQuestion, semanticProfile);
  const comparisonValues = extractComparisonValues(resolvedQuestion, profile);
  const dimension = resolveDimension(resolvedQuestion, profile, input, comparisonValues, semanticProfile.dimensionHints);
  const dimensionTrendValues = extractDimensionTopValues(resolvedQuestion, profile, dimension);
  const standardFilters = [
    ...extractFilters(resolvedQuestion, profile),
    ...extractNumericAndDateFilters(resolvedQuestion, profile)
  ];

  const resolvedComparisonValues =
    intent === "dimension_trend" && dimensionTrendValues.length > 0
      ? dimensionTrendValues
      : comparisonValues;

  return {
    intent,
    metric,
    metrics,
    dimension,
    datetimeColumn: profile.datetimeColumns[0] ?? null,
    aggregateOperation: resolveAggregateOperation(resolvedQuestion, metric, intent),
    sortDirection: resolveSortDirection(resolvedQuestion),
    limit: resolveLimit(resolvedQuestion),
    filters:
      intent === "compare_segments" || intent === "compare_trend"
        ? extractFiltersForDimension(resolvedQuestion, profile, dimension, resolvedComparisonValues)
        : standardFilters,
    comparisonValues: resolvedComparisonValues,
    semanticProfile: semanticProfile.businessIntent === "neutral" ? undefined : semanticProfile
  };
}
