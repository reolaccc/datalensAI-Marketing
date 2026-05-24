import type { AnalysisResponse } from "../types";

function uniq(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function pickPrimaryMetric(analysis: AnalysisResponse) {
  return analysis.kpis[0]?.label ?? analysis.profile.numericColumns[0] ?? "revenue";
}

function pickSecondaryMetric(analysis: AnalysisResponse, primaryMetric: string) {
  const candidate = analysis.profile.numericColumns.find(
    (column) => column.toLowerCase() !== primaryMetric.toLowerCase()
  );
  return candidate ?? primaryMetric;
}

function pickPrimaryDimension(analysis: AnalysisResponse) {
  return analysis.profile.categoricalColumns[0] ?? "channel";
}

function pickSecondaryDimension(analysis: AnalysisResponse, primaryDimension: string) {
  return (
    analysis.profile.categoricalColumns.find(
      (column) => column.toLowerCase() !== primaryDimension.toLowerCase()
    ) ?? "device"
  );
}

function pickComparisonValues(analysis: AnalysisResponse, dimension: string) {
  const values =
    analysis.profile.columns.find((column) => column.name === dimension)?.topCategories?.map((item) => item.value) ?? [];
  const fallbackValues =
    analysis.profile.columns
      .filter((column) => column.kind === "categorical")
      .flatMap((column) => column.topCategories?.map((item) => item.value) ?? []) ?? [];

  const merged = uniq([...values, ...fallbackValues]);
  return {
    first: merged[0] ?? "Desktop",
    second: merged[1] ?? merged[0] ?? "Mobile"
  };
}

function pickTopCategory(analysis: AnalysisResponse, dimension: string) {
  return (
    analysis.profile.columns.find((column) => column.name === dimension)?.topCategories?.[0]?.value ??
    analysis.profile.columns.find((column) => column.kind === "categorical")?.topCategories?.[0]?.value ??
    "selected category"
  );
}

function hasDatetime(analysis: AnalysisResponse) {
  return analysis.profile.datetimeColumns.length > 0;
}

function hasFunnel(analysis: AnalysisResponse) {
  return analysis.profile.columns.some(
    (column) => column.kind === "categorical" && /stage|step|funnel|pipeline|status/i.test(column.name)
  );
}

function hasMultipleNumericMetrics(analysis: AnalysisResponse) {
  return analysis.profile.numericColumns.length > 1;
}

export function buildQuestionSuggestions(analysis: AnalysisResponse): string[] {
  const primaryMetric = pickPrimaryMetric(analysis).toLowerCase();
  const secondaryMetric = pickSecondaryMetric(analysis, primaryMetric);
  const primaryDimension = pickPrimaryDimension(analysis);
  const secondaryDimension = pickSecondaryDimension(analysis, primaryDimension);
  const categoryValue = pickTopCategory(analysis, primaryDimension);
  const comparisons = pickComparisonValues(analysis, primaryDimension);
  const timeText = hasDatetime(analysis) ? " over time" : "";
  const suggestions = [
    `Which ${primaryDimension} has the highest ${primaryMetric}?`,
    `Top 3 ${primaryDimension} by ${primaryMetric}.`,
    `Show the ${primaryMetric} trend${timeText}.`,
    `Show ${primaryMetric} and ${secondaryMetric} trend${timeText}.`,
    `Show ${primaryMetric} trend by ${secondaryDimension}.`,
    `Compare ${comparisons.first} versus ${comparisons.second} ${primaryMetric} by ${primaryDimension}.`,
    `What is the average ${secondaryMetric} by ${primaryDimension}?`,
    `Show ${primaryMetric} within ${categoryValue} by ${primaryDimension}.`,
    `What is the relationship between ${primaryMetric} and ${secondaryMetric}?`,
    `Show the ${primaryMetric} distribution.`,
    `Which anomalies should I investigate in ${secondaryMetric}?`,
    `What rows have the most missing values?`,
    `Are there any duplicate rows in this dataset?`
  ];

  if (hasFunnel(analysis)) {
    suggestions.splice(
      8,
      0,
      `Which funnel stage has the lowest ${primaryMetric}?`,
      `Show ${primaryMetric} by funnel stage.`
    );
  }

  if (hasMultipleNumericMetrics(analysis)) {
    suggestions.splice(
      8,
      0,
      `Show the relationship between ${primaryMetric} and ${secondaryMetric}.`,
      `Which channel has the highest ${primaryMetric} and strong ${secondaryMetric}?`
    );
  }

  if (analysis.profile.numericColumns.includes("cost") && analysis.profile.numericColumns.includes("revenue")) {
    suggestions.splice(
      8,
      0,
      `Which channel has the highest ROAS?`,
      `Show cost versus revenue by ${primaryDimension}.`,
      `Are there any negative cost values to investigate?`
    );
  }

  if (analysis.profile.numericColumns.includes("conversion_rate")) {
    suggestions.splice(8, 0, `Which rows have conversion rates above 1?`);
  }

  if (hasDatetime(analysis)) {
    suggestions.splice(8, 0, `Which dates look malformed or suspicious?`);
  }

  return uniq(suggestions);
}
