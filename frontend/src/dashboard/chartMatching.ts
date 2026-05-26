import type { AnalysisResponse, QuestionAnswer } from "../types";

function normalize(value: string | undefined | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDashboardMeaningKey(chart: AnalysisResponse["charts"][number]) {
  return [
    normalize(chart.chartType),
    normalize(chart.metric ?? chart.yKey ?? ""),
    normalize(chart.dimension ?? chart.groupBy ?? chart.xKey),
    normalize(chart.groupBy ?? "")
  ].join("|");
}

function buildQuestionChartMeaningKey(chart: NonNullable<QuestionAnswer["recommendedCharts"]>[number]) {
  return [
    normalize(chart.chartType),
    normalize(chart.metric ?? chart.yKey ?? ""),
    normalize(chart.dimension ?? chart.groupBy ?? chart.xKey),
    normalize(chart.groupBy ?? "")
  ].join("|");
}

function chartText(chart: AnalysisResponse["charts"][number]) {
  return normalize(
    `${chart.title} ${chart.description} ${chart.metric ?? ""} ${chart.dimension ?? ""} ${chart.groupBy ?? ""} ${chart.xKey} ${chart.yKey ?? ""}`
  );
}

function suggestionText(suggestion: NonNullable<QuestionAnswer["chartSuggestion"]>) {
  return normalize(
    `${suggestion.chartType} ${suggestion.xKey} ${suggestion.yKey} ${(suggestion.series ?? []).join(" ")}`
  );
}

export function findRelevantChartId(
  analysis: AnalysisResponse | null,
  questionAnswer: QuestionAnswer | null
) {
  if (!analysis || !questionAnswer?.chartSuggestion) {
    return null;
  }

  const suggestion = questionAnswer.chartSuggestion;
  const targetX = normalize(suggestion.xKey);
  const targetY = normalize(suggestion.yKey);
  const targetSeries = new Set(
    [suggestion.yKey, ...(suggestion.series ?? [])].map((value) => normalize(value))
  );

  const exactMatch = analysis.charts.find((chart) => {
    const chartX = normalize(chart.xKey);
    const chartY = normalize(chart.yKey ?? "");
    return chartX === targetX && chartY === targetY;
  });

  if (exactMatch) {
    return exactMatch.id;
  }

  const fuzzyMatch = analysis.charts.find((chart) => {
    const chartText = normalize(`${chart.title} ${chart.description} ${chart.xKey} ${chart.yKey ?? ""}`);
    return (
      chartText.includes(targetX) ||
      chartText.includes(targetY) ||
      [...targetSeries].some((seriesKey) => seriesKey && chartText.includes(seriesKey))
    );
  });

  return fuzzyMatch?.id ?? null;
}

export function shouldSuppressQuestionChartSuggestion(
  analysis: AnalysisResponse | null,
  questionAnswer: QuestionAnswer | null
) {
  if (!analysis || !questionAnswer?.chartSuggestion) {
    return false;
  }

  if (findRelevantChartId(analysis, questionAnswer)) {
    return true;
  }

  const targetText = suggestionText(questionAnswer.chartSuggestion);
  return analysis.charts.some((chart) => {
    const sourceText = chartText(chart);
    return sourceText.includes(targetText) || targetText.includes(sourceText);
  });
}

export function filterRecommendedChartsAgainstDashboard(
  analysis: AnalysisResponse | null,
  recommendedCharts?: QuestionAnswer["recommendedCharts"]
) {
  if (!analysis || !recommendedCharts?.length) {
    return recommendedCharts;
  }

  const dashboardSignatures = new Set(
    analysis.charts.flatMap((chart) => [
      normalize(chart.semanticSignature ?? ""),
      buildDashboardMeaningKey(chart)
    ])
  );

  const filtered = recommendedCharts.filter((chart) => {
    const semanticSignature = normalize(chart.semanticSignature ?? "");
    const meaningKey = buildQuestionChartMeaningKey(chart);
    return !dashboardSignatures.has(semanticSignature) && !dashboardSignatures.has(meaningKey);
  });

  return filtered.length > 0 ? filtered.slice(0, 2) : [];
}

export function getQuestionScrollTargetId(
  analysis: AnalysisResponse | null,
  questionAnswer: QuestionAnswer | null
) {
  const relevantChartId = findRelevantChartId(analysis, questionAnswer);
  return relevantChartId ? `analysis-chart-${relevantChartId}` : "analysis-answer-region";
}
