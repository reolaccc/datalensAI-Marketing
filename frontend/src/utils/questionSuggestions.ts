import type { AnalysisResponse, SemanticDatasetContract } from "../types";

function uniq(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isDataQualityQuestion(question: string) {
  return /missing values|missing rows|duplicate rows|malformed|suspicious|invalid|anomal|quality|dirty data|outlier/i.test(question);
}

function hasSemanticContract(analysis: AnalysisResponse) {
  return Boolean(analysis.profile.semanticContract?.availableDimensions?.length || analysis.profile.semanticContract?.availableMetrics?.length);
}

function getSemanticContract(analysis: AnalysisResponse): SemanticDatasetContract | null {
  return analysis.profile.semanticContract ?? null;
}

function preferredDimensionLabels(analysis: AnalysisResponse) {
  const contract = getSemanticContract(analysis);
  const canonicalOrder = ["channel", "campaign", "device", "region", "date", "account", "customer", "client"];
  const available = contract?.availableDimensions?.length ? contract.availableDimensions : analysis.profile.categoricalColumns;
  const labels = canonicalOrder.filter((dimension) => available.includes(dimension));
  return labels.length > 0 ? labels : available;
}

function preferredMetricLabels(analysis: AnalysisResponse) {
  const labels = uniq([
    ...analysis.kpis.map((kpi) => kpi.label),
    ...(analysis.profile.semanticContract?.availableMetrics ?? []),
    ...analysis.profile.numericColumns
  ]);

  const preferredOrder = ["revenue", "spend", "ROAS", "CTR", "CVR", "clicks", "impressions", "conversions"];
  const ordered = preferredOrder.filter((metric) =>
    labels.some((entry) => normalize(entry) === normalize(metric) || normalize(entry).includes(normalize(metric)))
  );

  return ordered.length > 0 ? ordered : labels;
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

function hasMetricHint(analysis: AnalysisResponse, hints: string[]) {
  const metrics = uniq([
    ...analysis.profile.numericColumns,
    ...(analysis.profile.semanticContract?.availableMetrics ?? []),
    ...analysis.kpis.map((kpi) => kpi.label)
  ]).map((value) => normalize(value));

  return hints.some((hint) => metrics.some((metric) => metric.includes(normalize(hint))));
}

function isOperationsFocusedDataset(analysis: AnalysisResponse) {
  const domain = analysis.profile.semanticContract?.detectedDomain?.domain;
  const hasCommercialMetric = hasMetricHint(analysis, ["revenue", "spend", "roas", "roi", "cost per qualified", "cost per conversion"]);
  return (domain === "call_operations" || domain === "call_tracking") && !hasCommercialMetric;
}

function buildOperationsFallbackQuestions(analysis: AnalysisResponse) {
  const dimensions = preferredDimensionLabels(analysis);
  const primaryDimension = dimensions[0] ?? "location";
  const secondaryDimension = dimensions[1] ?? primaryDimension;
  const suggestions = [
    `Which ${primaryDimension} generated the most calls?`,
    `Which ${secondaryDimension} has the highest missed call rate?`,
    `Where did call volume increase or drop the most?`,
    `Which ${primaryDimension} has the longest average handling time?`,
    `Where are repeat callers most concentrated?`
  ];

  return uniq(suggestions).slice(0, 5);
}

function buildSemanticFallbackBusinessQuestions(analysis: AnalysisResponse) {
  if (isOperationsFocusedDataset(analysis)) {
    return buildOperationsFallbackQuestions(analysis);
  }

  const dimensions = preferredDimensionLabels(analysis);
  const metrics = preferredMetricLabels(analysis);
  const primaryDimension = dimensions[0] ?? "channel";
  const secondaryDimension = dimensions[1] ?? primaryDimension;
  const primaryMetric = metrics[0] ?? "revenue";
  const secondaryMetric = metrics[1] ?? primaryMetric;
  const timeText = hasDatetime(analysis) ? " over time" : "";
  const questions = [
    `Which ${primaryDimension} generated the most ${primaryMetric}?`,
    `Is ${primaryMetric} too concentrated in one ${primaryDimension}?`,
    `Where did ${primaryMetric} increase or drop the most?`,
    `Which ${secondaryDimension} has the best ROAS?`,
    `Which ${primaryDimension} should receive more budget?`,
    `Which ${secondaryDimension} converts clicks most efficiently?`
  ];

  if (hasFunnel(analysis)) {
    questions.push("Where are users dropping off between impressions, clicks, and conversions?");
    questions.push(`Which ${secondaryDimension} has the strongest funnel efficiency?`);
  }

  if (hasMultipleNumericMetrics(analysis)) {
    questions.push(`Which ${primaryDimension} has high spend but weak revenue?`);
    questions.push(`What is the relationship between ${primaryMetric} and ${secondaryMetric}?`);
  }

  if (hasDatetime(analysis)) {
    questions.push(`Where did ${primaryMetric} drop the most${timeText}?`);
  }

  return uniq(questions).filter((question) => !isDataQualityQuestion(question)).slice(0, 5);
}

function buildDataQualityFallbackQuestions(analysis: AnalysisResponse) {
  const suggestions = [
    `Which dates look malformed or suspicious?`,
    `What rows have the most missing values?`,
    `Are there any duplicate rows in this dataset?`
  ];

  if (!hasDatetime(analysis)) {
    return suggestions.filter((question) => !question.toLowerCase().includes("dates"));
  }

  return suggestions;
}

export function buildQuestionSuggestions(analysis: AnalysisResponse): string[] {
  const backendSuggestions = uniq(analysis.executiveSummary.suggestedQuestions).filter((question) => !isDataQualityQuestion(question));
  if (backendSuggestions.length > 0) {
    return backendSuggestions.slice(0, 5);
  }

  if (hasSemanticContract(analysis)) {
    return buildSemanticFallbackBusinessQuestions(analysis);
  }

  return [];
}

export function buildDataQualityQuestionSuggestions(analysis: AnalysisResponse): string[] {
  const backendSuggestions = uniq(analysis.executiveSummary.suggestedQuestions).filter(isDataQualityQuestion);
  if (backendSuggestions.length > 0) {
    return backendSuggestions;
  }

  return buildDataQualityFallbackQuestions(analysis);
}
