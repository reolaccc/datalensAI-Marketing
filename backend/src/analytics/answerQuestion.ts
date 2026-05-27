import type { ChartConfig, DatasetProfile, DatasetRow, IntentDetectionResult, QuestionAnswer, QuestionContextInput, TrustedQuestionFacts } from "./types.js";
import { detectKpis } from "./detectKpis.js";
import { selectRuleBasedCharts } from "../services/analytics/chart-selection/selectRuleBasedCharts.js";
import {
  applyChartNarratives,
  buildAnalyticsFactsFromAnalysis,
  buildFallbackAskAnswerNarrative,
  buildFallbackChartExplanations,
  buildQuestionNarrativeInput,
  generateAskAnswer,
  generateChartExplanations
} from "../llm/insightService.js";
import { buildTrustedQuestionFacts } from "./trustedQuestionFacts.js";

interface QuestionContext {
  fileName?: string;
  rows: DatasetRow[];
  profile: DatasetProfile;
  input?: QuestionContextInput;
}

function humanizeMetricLabel(value: string | null | undefined) {
  if (!value) {
    return "Metric";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\bcpqc\b/gi, "CPQC")
    .replace(/\broas\b/gi, "ROAS")
    .replace(/\broi\b/gi, "ROI")
    .replace(/\bcpa\b/gi, "CPA")
    .replace(/\bcpc\b/gi, "CPC")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatChartMetricValue(metric: string | null | undefined, value: string | number | boolean | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value ?? "");
  }

  const normalizedMetric = (metric ?? "").toLowerCase();
  if (
    normalizedMetric.includes("roas") ||
    normalizedMetric.includes("roi")
  ) {
    return `${value.toFixed(2)}x`;
  }

  if (
    normalizedMetric.includes("rate") ||
    normalizedMetric.includes("share") ||
    normalizedMetric.includes("ratio")
  ) {
    return `${value.toFixed(2)}%`;
  }

  if (
    normalizedMetric.includes("cost") ||
    normalizedMetric.includes("revenue") ||
    normalizedMetric.includes("spend") ||
    normalizedMetric.includes("profit")
  ) {
    return `$${value.toFixed(2)}`;
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2);
}

function isLowerBetterMetric(metric: string | null | undefined) {
  const normalizedMetric = (metric ?? "").toLowerCase();
  return (
    normalizedMetric.includes("cost_per") ||
    normalizedMetric.includes("cost per") ||
    normalizedMetric.includes("cpa") ||
    normalizedMetric.includes("cpc") ||
    normalizedMetric.includes("cpqc") ||
    normalizedMetric.includes("missed_call_rate")
  );
}

function buildTrustedChartDescription(questionFacts: TrustedQuestionFacts, chartSuggestion: NonNullable<QuestionAnswer["chartSuggestion"]>) {
  const dimensionKey = chartSuggestion.xKey;
  const metricKey = chartSuggestion.yKey;
  const metricLabel = humanizeMetricLabel(metricKey).toLowerCase();
  const leader = chartSuggestion.data[0];
  const trailer = chartSuggestion.data[chartSuggestion.data.length - 1];
  const lowerBetter = isLowerBetterMetric(metricKey);
  const directionWord = lowerBetter ? "lowest" : "highest";
  const trailingWord = lowerBetter ? "highest" : "lowest";

  const leaderLabel = leader?.[dimensionKey];
  const leaderValue = leader?.[metricKey];
  const trailerLabel = trailer?.[dimensionKey];
  const trailerValue = trailer?.[metricKey];

  const subtitle =
    typeof leaderLabel === "string" || typeof leaderLabel === "number"
      ? `${String(leaderLabel)} has the ${directionWord} ${metricLabel}.`
      : questionFacts.answer.directAnswer.split(".")[0]?.trim() || questionFacts.answer.directAnswer;

  const descriptionParts: string[] = [];
  if (leaderLabel !== undefined && leaderValue !== undefined) {
    descriptionParts.push(
      `${String(leaderLabel)} has the ${directionWord} ${metricLabel} at ${formatChartMetricValue(metricKey, leaderValue)}.`
    );
  }
  if (trailerLabel !== undefined && trailerValue !== undefined && trailerLabel !== leaderLabel) {
    descriptionParts.push(
      `${String(trailerLabel)} sits ${trailingWord} at ${formatChartMetricValue(metricKey, trailerValue)}.`
    );
  }

  return {
    subtitle,
    description: descriptionParts.join(" ")
  };
}

function buildChartFromSuggestion(questionFacts: TrustedQuestionFacts, chartSuggestion: NonNullable<QuestionAnswer["chartSuggestion"]>): ChartConfig {
  const metricLabel = humanizeMetricLabel(chartSuggestion.yKey);
  const dimensionLabel = humanizeMetricLabel(chartSuggestion.xKey);
  const { subtitle, description } = buildTrustedChartDescription(questionFacts, chartSuggestion);
  const chartType: ChartConfig["chartType"] =
    chartSuggestion.chartType === "table"
      ? "bar"
      : chartSuggestion.chartType;
  const intent: ChartConfig["intent"] =
    questionFacts.answer.mode === "trend"
      ? "trend_analysis"
      : questionFacts.answer.mode === "comparison"
        ? "comparison"
        : questionFacts.answer.mode === "anomaly"
          ? "anomaly_detection"
          : questionFacts.answer.mode === "ranking"
            ? "ranking"
            : "general_overview";

  return {
    id: `ask-${chartSuggestion.chartType}-${chartSuggestion.xKey}-${chartSuggestion.yKey}`,
    title:
      chartSuggestion.chartType === "line"
        ? `${metricLabel} Trend`
        : `${dimensionLabel} by ${metricLabel}`,
    subtitle,
    semanticSignature: `ask:${questionFacts.resolvedIntent.intent}:${chartSuggestion.yKey}:${chartSuggestion.xKey}`,
    businessArea: questionFacts.answer.mode === "ranking" || questionFacts.answer.mode === "comparison"
      ? "efficiency"
      : questionFacts.answer.mode === "trend"
        ? "volume"
        : "quality",
    analysisRole:
      questionFacts.answer.mode === "trend"
        ? "trend"
        : questionFacts.answer.mode === "comparison"
          ? "comparison"
          : questionFacts.answer.mode === "anomaly"
            ? "anomaly"
            : questionFacts.answer.mode === "ranking"
              ? "efficiency"
              : "comparison",
    chartType,
    intent,
    description,
    reason: "This chart reuses the deterministic Ask result so the visual stays aligned with the answer.",
    whyThisChart: "It visualizes the same metric and dimension already used to compute the Ask answer.",
    recommendations: [],
    xAxis: dimensionLabel,
    yAxis: metricLabel,
    metric: chartSuggestion.yKey,
    dimension: chartSuggestion.xKey,
    groupBy: null,
    sort: questionFacts.chartSupportRequest?.sort ?? null,
    limit: questionFacts.chartSupportRequest?.limit ?? chartSuggestion.data.length,
    filters: [],
    xKey: chartSuggestion.xKey,
    yKey: chartSuggestion.yKey,
    series: chartSuggestion.series,
    data: chartSuggestion.data.map((row) => ({ ...row }))
  };
}

function buildChartSelectionQuestion(questionFacts: TrustedQuestionFacts) {
  const request = questionFacts.chartSupportRequest;
  if (!request || request.kind === "none" || questionFacts.answerability.status === "unsupported") {
    return "";
  }

  if (request.kind === "line") {
    return request.dimension
      ? `Show trend of ${request.metric ?? "the metric"} by ${request.dimension}`
      : `Show trend of ${request.metric ?? "the metric"}`;
  }

  if (request.kind === "table") {
    return request.dimension
      ? `Compare ${request.metric ?? "the metric"} by ${request.dimension}`
      : `Compare ${request.metric ?? "the metric"}`;
  }

  return request.dimension
    ? `Show ${request.metric ?? "the metric"} by ${request.dimension}`
    : `Show ${request.metric ?? "the metric"}`;
}

function chartMatchesRequest(chart: ChartConfig, request: TrustedQuestionFacts["chartSupportRequest"]) {
  if (!request || request.kind === "none") {
    return false;
  }

  const metricMatches = request.metric === null || chart.metric === request.metric || chart.yKey === request.metric;
  const dimensionMatches = request.dimension === null || chart.dimension === request.dimension || chart.xKey === request.dimension;

  if (request.kind === "bar") {
    return (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "stacked_bar") && metricMatches && dimensionMatches;
  }

  if (request.kind === "line") {
    return chart.chartType === "line" && metricMatches && (request.dimension === null || dimensionMatches || Boolean(chart.groupBy));
  }

  if (request.kind === "table") {
    return (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "stacked_bar" || chart.chartType === "line") && metricMatches;
  }

  return false;
}

function chartSuggestionMatchesRequest(
  chartSuggestion: QuestionAnswer["chartSuggestion"] | undefined,
  request: TrustedQuestionFacts["chartSupportRequest"]
) {
  if (!chartSuggestion || !request || request.kind === "none") {
    return false;
  }

  const metricMatches = request.metric === null || chartSuggestion.yKey === request.metric;
  const dimensionMatches = request.dimension === null || chartSuggestion.xKey === request.dimension;

  if (request.kind === "line") {
    return chartSuggestion.chartType === "line" && metricMatches && dimensionMatches;
  }

  if (request.kind === "bar" || request.kind === "table") {
    return chartSuggestion.chartType === "bar" && metricMatches && dimensionMatches;
  }

  return false;
}

function buildAlignedChartSuggestion(
  chartSuggestion: QuestionAnswer["chartSuggestion"] | undefined,
  request: TrustedQuestionFacts["chartSupportRequest"]
): QuestionAnswer["chartSuggestion"] | undefined {
  if (!chartSuggestion || !request || request.kind === "none") {
    return undefined;
  }

  if (chartSuggestionMatchesRequest(chartSuggestion, request)) {
    return chartSuggestion;
  }

  const requestMetric = request.metric;
  const requestDimension = request.dimension;

  if (
    requestMetric &&
    requestDimension &&
    chartSuggestion.xKey === requestDimension &&
    chartSuggestion.chartType === "bar" &&
    chartSuggestion.data.every((row) => row[requestMetric] !== undefined)
  ) {
    return {
      ...chartSuggestion,
      yKey: requestMetric,
      data: chartSuggestion.data.map((row) => ({
        [requestDimension]: row[requestDimension],
        [requestMetric]: row[requestMetric]
      }))
    };
  }

  return undefined;
}

function buildDetectedIntentFromFacts(questionFacts: TrustedQuestionFacts): IntentDetectionResult {
  return {
    primaryIntent:
      questionFacts.answer.mode === "trend"
        ? "trend_analysis"
        : questionFacts.answer.mode === "comparison"
          ? "comparison"
          : questionFacts.answer.mode === "anomaly"
            ? "anomaly_detection"
            : questionFacts.answer.mode === "ranking"
              ? "ranking"
              : "general_overview",
    secondaryIntents: [],
    targetMetrics: [...questionFacts.evidence.metricsUsed],
    targetDimensions: [...questionFacts.evidence.dimensionsUsed],
    explicitDimensionMention: null,
    timeRequired: questionFacts.answer.mode === "trend",
    comparisonRequired: questionFacts.answer.mode === "comparison",
    anomalyRequired: questionFacts.answer.mode === "anomaly",
    confidence: questionFacts.answerability.status === "answerable" ? 0.9 : questionFacts.answerability.status === "weak" ? 0.62 : 0.4,
    matchedKeywords: []
  };
}

function selectChartsFromTrustedFacts(
  questionFacts: TrustedQuestionFacts,
  context: QuestionContext,
  kpis: ReturnType<typeof detectKpis>,
  queryAnswer: QuestionAnswer
) {
  const request = questionFacts.chartSupportRequest;
  const detectedIntent = buildDetectedIntentFromFacts(questionFacts);

  if (!request || request.kind === "none") {
    return {
      intent: detectedIntent,
      charts: [] as ChartConfig[],
      summary: "No additional chart support was needed for this answer.",
      explanation: "No additional chart support was needed for this answer.",
      lookFor: [] as string[],
      warnings: [] as string[],
      followUps: [] as string[]
    };
  }

  const alignedChartSuggestion = buildAlignedChartSuggestion(queryAnswer.chartSuggestion, request);
  const baseChart =
    alignedChartSuggestion
      ? buildChartFromSuggestion(questionFacts, alignedChartSuggestion)
      : null;

  const chartSelection = selectRuleBasedCharts({
    question: buildChartSelectionQuestion(questionFacts),
    rows: context.rows,
    profile: context.profile,
    kpis,
    input: context.input
  });
  const matchingCharts = chartSelection.charts.filter((chart) => chartMatchesRequest(chart, request));
  const charts = [baseChart, ...matchingCharts]
    .filter((chart): chart is ChartConfig => Boolean(chart))
    .filter((chart, index, list) => list.findIndex((entry) => entry.id === chart.id) === index)
    .slice(0, 2);

  return {
    ...chartSelection,
    intent: detectedIntent,
    charts
  };
}

export async function answerDatasetQuestion(question: string, context: QuestionContext): Promise<QuestionAnswer> {
  const trustedQuestion = buildTrustedQuestionFacts(question, context);
  const kpis = detectKpis(context.rows, context.profile);
  const chartSelection = selectChartsFromTrustedFacts(trustedQuestion.facts, context, kpis, trustedQuestion.queryAnswer);
  const alignedChartSuggestion = buildAlignedChartSuggestion(trustedQuestion.queryAnswer.chartSuggestion, trustedQuestion.facts.chartSupportRequest);
  const facts = buildAnalyticsFactsFromAnalysis({
    fileName: context.fileName ?? "dataset",
    profile: context.profile,
    kpis,
    charts: chartSelection.charts
  });
  const useAi = context.input?.useAi ?? false;
  const narrativeInput = buildQuestionNarrativeInput({
    question,
    answer: trustedQuestion.facts.answer.directAnswer,
    trustedQuestionFacts: trustedQuestion.facts,
    detectedIntent: trustedQuestion.detectedIntent,
    semanticProfile: trustedQuestion.plan.semanticProfile,
    semanticContract: context.profile.semanticContract,
    conversationHistory: context.input?.conversationHistory,
    supportingData: trustedQuestion.facts.answer.supportingData,
    resultTable: trustedQuestion.facts.answer.resultTable,
    datasetSchema: context.profile.columns.map((column) => ({
      name: column.name,
      kind: column.kind,
      sampleValues: column.sampleValues,
      min: column.min,
      max: column.max,
      mean: column.mean,
      median: column.median,
      topCategories: column.topCategories
    })),
    sampleRows: context.rows.slice(0, 6),
    chartSelectionSummary: chartSelection.summary,
    chartSelectionExplanation: chartSelection.explanation,
    chartSelectionWarnings: chartSelection.warnings,
    suggestedFollowUps: chartSelection.followUps,
    recommendedCharts: chartSelection.charts,
    context: context.input,
    facts
  });

  const allowAiRewrite =
    useAi &&
    trustedQuestion.facts.answerability.status === "answerable" &&
    trustedQuestion.facts.routing.mode === "standard";
  const chartNarratives = allowAiRewrite
    ? await generateChartExplanations(facts, chartSelection.charts, question)
    : buildFallbackChartExplanations(facts, chartSelection.charts);
  const chartsWithNarratives = applyChartNarratives(chartSelection.charts, chartNarratives).map((chart, index) =>
    chartSelection.charts[index]?.id.startsWith("ask-")
      ? { ...chart, description: chartSelection.charts[index]?.description ?? chart.description }
      : chart
  );
  const narrative = allowAiRewrite
    ? await generateAskAnswer(narrativeInput)
    : buildFallbackAskAnswerNarrative(narrativeInput);

  return {
    ...trustedQuestion.queryAnswer,
    answer: narrative.directAnswer,
    detectedIntent: chartSelection.intent,
    analysisSummary: narrative.analysisSummary,
    chartSelectionSummary: narrative.chartSelectionSummary,
    missingFieldWarnings: chartSelection.warnings,
    suggestedFollowUps: chartSelection.followUps,
    chartSuggestion: alignedChartSuggestion,
    recommendedCharts: chartsWithNarratives,
    narrative: {
      directAnswer: narrative.directAnswer,
      evidence: narrative.evidence,
      caution: narrative.caution,
      suggestedNextQuestion: narrative.suggestedNextQuestion,
      warning: narrative.warning,
      source: narrative.source
    }
  };
}
