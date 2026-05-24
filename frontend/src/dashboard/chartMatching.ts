import type { AnalysisResponse, QuestionAnswer } from "../types";

function normalize(value: string | undefined | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export function getQuestionScrollTargetId(
  analysis: AnalysisResponse | null,
  questionAnswer: QuestionAnswer | null
) {
  const relevantChartId = findRelevantChartId(analysis, questionAnswer);
  return relevantChartId ? `analysis-chart-${relevantChartId}` : "analysis-answer-region";
}
