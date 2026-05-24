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

export function buildQuestionSuggestions(analysis: AnalysisResponse): string[] {
  const primaryMetric = pickPrimaryMetric(analysis).toLowerCase();
  const secondaryMetric = pickSecondaryMetric(analysis, primaryMetric);
  const primaryDimension = pickPrimaryDimension(analysis);
  const secondaryDimension = pickSecondaryDimension(analysis, primaryDimension);
  const categoryValue = pickTopCategory(analysis, primaryDimension);
  const comparisons = pickComparisonValues(analysis, primaryDimension);
  const timeText = hasDatetime(analysis) ? " over time" : "";

  return [
    `Which ${primaryDimension} has the highest ${primaryMetric}?`,
    `Top 3 ${primaryDimension} by ${primaryMetric}.`,
    `Show the ${primaryMetric} trend${timeText}.`,
    `Show ${primaryMetric} and ${secondaryMetric} trend${timeText}.`,
    `Show ${primaryMetric} trend by ${secondaryDimension}.`,
    `Compare ${comparisons.first} versus ${comparisons.second} ${primaryMetric} by ${primaryDimension}.`,
    `What is the average ${secondaryMetric} by ${primaryDimension}?`,
    `Show ${primaryMetric} within ${categoryValue} by ${primaryDimension}.`,
    `Which anomalies should I investigate in ${secondaryMetric}?`,
    `What rows have the most missing values?`
  ];
}
