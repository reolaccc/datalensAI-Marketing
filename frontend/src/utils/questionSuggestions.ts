import type { AnalysisResponse, SemanticDatasetContract } from "../types";

function uniq(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function humanizeLabel(value: string | undefined | null) {
  return (value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\bmissed call\b/gi, "missed call rate")
    .replace(/\banswered call\b/gi, "answered call rate")
    .replace(/\bpct\b/gi, "pct")
    .replace(/\broas\b/gi, "ROAS")
    .replace(/\bcpqc\b/gi, "CPQC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\broas\b/g, "ROAS")
    .replace(/\bcpqc\b/g, "CPQC");
}

function isDataQualityQuestion(question: string) {
  return /missing values|missing rows|duplicate rows|malformed|suspicious|invalid|anomal|quality|dirty data|outlier/i.test(question);
}

function isVisualLookupQuestion(question: string) {
  const text = normalize(question);
  return (
    (
      /^which\b/.test(text) &&
      /\b(highest|lowest|most|least|biggest|smallest|largest|fewest|best)\b/.test(text)
    ) ||
    /\bdriving the strongest performance\b/.test(text)
  ) &&
    !/\b(risk|reliab|caveat|limitation|inconsistent|imbalance|bottleneck|pressure|review|investigat)\b/.test(text)
  ;
}

function isMarketingDomain(contract: SemanticDatasetContract | null) {
  const domain = contract?.detectedDomain?.domain;
  return domain === "call_tracking" || domain === "marketing_attribution" || domain === "mixed_call_tracking_attribution";
}

function usesUngroundedMarketingLanguage(question: string, analysis: AnalysisResponse) {
  const contract = getSemanticContract(analysis);
  if (isMarketingDomain(contract)) {
    return false;
  }

  return /\b(roas|campaign efficiency|marketing attribution|qualified calls?|qualified call rate|qualified efficiency|cost per qualified|traffic source)\b/i.test(question);
}

function isUnsafeSuggestedQuestion(question: string, analysis: AnalysisResponse) {
  return (
    isVisualLookupQuestion(question) ||
    usesUngroundedMarketingLanguage(question, analysis) ||
    (!isMarketingDomain(getSemanticContract(analysis)) && /\b(spend|spending|budget)\b/i.test(question)) ||
    /\bclearest trade-off between scale and efficiency\b/i.test(question)
  );
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
    `Can missed call rate be compared reliably by ${humanizeLabel(primaryDimension)}?`,
    `Where does call handling time look inconsistent across ${humanizeLabel(primaryDimension)}?`,
    `Which ${humanizeLabel(secondaryDimension)} segments show concentrated service risk?`,
    "What operational bottlenecks deserve further investigation?",
    "What reliability limitations affect decision confidence?"
  ];

  return uniq(suggestions).slice(0, 5);
}

function buildSemanticFallbackBusinessQuestions(analysis: AnalysisResponse) {
  if (isOperationsFocusedDataset(analysis)) {
    return buildOperationsFallbackQuestions(analysis);
  }

  const dimensions = preferredDimensionLabels(analysis);
  const metrics = preferredMetricLabels(analysis);
  const primaryDimension = dimensions[0] ?? "segment";
  const secondaryDimension = dimensions[1] ?? primaryDimension;
  const primaryMetric = metrics[0] ?? "performance";
  const secondaryMetric = metrics[1] ?? primaryMetric;
  const questions = [
    `Can ${humanizeLabel(primaryMetric)} be compared reliably by ${humanizeLabel(primaryDimension)}?`,
    `Where does ${humanizeLabel(primaryMetric)} look inconsistent across ${humanizeLabel(primaryDimension)}?`,
    `Is ${humanizeLabel(primaryMetric)} too concentrated in one ${humanizeLabel(primaryDimension)}?`,
    `Which ${humanizeLabel(secondaryDimension)} segments show concentrated risk?`,
    "What reliability limitations affect decision confidence?"
  ];

  if (hasFunnel(analysis)) {
    questions.push("Where do funnel stages show unusual drop-off pressure?");
  }

  if (hasMultipleNumericMetrics(analysis)) {
    questions.push(`Where do ${humanizeLabel(primaryMetric)} and ${humanizeLabel(secondaryMetric)} look inconsistent?`);
  }

  if (hasDatetime(analysis)) {
    questions.push(`Where does ${humanizeLabel(primaryMetric)} show unusual movement over time?`);
  }

  return uniq(questions)
    .filter((question) => !isDataQualityQuestion(question))
    .filter((question) => !isUnsafeSuggestedQuestion(question, analysis))
    .slice(0, 5);
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
  const backendSuggestions = uniq(analysis.executiveSummary.suggestedQuestions)
    .filter((question) => !isDataQualityQuestion(question))
    .filter((question) => !isUnsafeSuggestedQuestion(question, analysis));
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
