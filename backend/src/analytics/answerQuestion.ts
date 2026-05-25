import type { DatasetProfile, DatasetRow, QuestionAnswer, QuestionContextInput } from "./types.js";
import { executePlannedQuery } from "./queryEngine.js";
import { planQuery } from "./queryPlanner.js";
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

interface QuestionContext {
  fileName?: string;
  rows: DatasetRow[];
  profile: DatasetProfile;
  input?: QuestionContextInput;
}

export async function answerDatasetQuestion(question: string, context: QuestionContext): Promise<QuestionAnswer> {
  const plan = planQuery(question, context.profile, context.input);
  const answer = executePlannedQuery(question, plan, context);
  const kpis = detectKpis(context.rows, context.profile);
  const chartSelection = selectRuleBasedCharts({
    question,
    rows: context.rows,
    profile: context.profile,
    kpis,
    input: context.input
  });
  const facts = buildAnalyticsFactsFromAnalysis({
    fileName: context.fileName ?? "dataset",
    profile: context.profile,
    kpis,
    charts: chartSelection.charts
  });
  const useAi = context.input?.useAi ?? false;
  const narrativeInput = buildQuestionNarrativeInput({
    question,
    answer: answer.answer,
    detectedIntent: chartSelection.intent,
    semanticProfile: plan.semanticProfile,
    supportingData: answer.supportingData,
    resultTable: answer.resultTable,
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

  const chartNarratives = useAi
    ? await generateChartExplanations(facts, chartSelection.charts, question)
    : buildFallbackChartExplanations(facts, chartSelection.charts);
  const chartsWithNarratives = applyChartNarratives(chartSelection.charts, chartNarratives);
  const narrative = useAi
    ? await generateAskAnswer(narrativeInput)
    : buildFallbackAskAnswerNarrative(narrativeInput);

  return {
    ...answer,
    answer: narrative.directAnswer,
    detectedIntent: chartSelection.intent,
    analysisSummary: narrative.analysisSummary,
    chartSelectionSummary: narrative.chartSelectionSummary,
    missingFieldWarnings: chartSelection.warnings,
    suggestedFollowUps: chartSelection.followUps,
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
