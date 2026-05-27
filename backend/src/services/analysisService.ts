import type { AnalysisResult } from "../analytics/types.js";
import { createAnalysisSession } from "./analysisSessionStore.js";
import { detectKpis } from "../analytics/detectKpis.js";
import { buildKpiCards } from "../analytics/kpiCards.js";
import { buildCleanedDatasetProfile } from "../analytics/normalization/index.js";
import { buildDataSummaryNotes } from "../analytics/normalization/warnings.js";
import { generateEdaSummary } from "../ai/generateExecutiveSummary.js";
import { loadRowsIntoDuckDb } from "../providers/duckdbProvider.js";
import { parseDataset } from "../profiling/datasetParser.js";
import { profileDataset } from "../profiling/profileDataset.js";
import { selectRuleBasedCharts } from "./analytics/chart-selection/selectRuleBasedCharts.js";
import {
  applyChartNarratives,
  buildAnalyticsFactsFromAnalysis,
  generateChartExplanations,
  generateExecutiveInsights,
  mapExecutiveInsightToLegacy
} from "../llm/insightService.js";
import { applyChartRecommendations } from "./analytics/recommendations/ChartRecommendationBuilder.js";
import { buildSafeSuggestedQuestions } from "../analytics/suggestedQuestions.js";

export async function analyzeUploadedDataset(buffer: Buffer, fileName: string): Promise<AnalysisResult> {
  const parsed = parseDataset(buffer, fileName);
  const cleanedDatasetProfile = buildCleanedDatasetProfile(parsed.rows);
  const profile = profileDataset(parsed.rows);
  const session = createAnalysisSession({
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    rows: parsed.rows,
    profile
  });
  const kpis = detectKpis(parsed.rows, profile);
  const kpiCards = buildKpiCards(parsed.rows, profile);
  const charts = selectRuleBasedCharts({
    question: "",
    rows: parsed.rows,
    profile,
    kpis
  }).charts;
  const edaSummary = generateEdaSummary(profile, kpis);
  const duckDbSnapshot = await loadRowsIntoDuckDb(parsed.rows);
  const facts = buildAnalyticsFactsFromAnalysis({
    fileName: parsed.fileName,
    profile,
    kpis,
    charts
  });
  const [executiveSummaryNarrative, chartNarratives] = await Promise.all([
    generateExecutiveInsights(facts),
    generateChartExplanations(facts, charts)
  ]);
  const executiveSummary = mapExecutiveInsightToLegacy(executiveSummaryNarrative);
  const safeSuggestedQuestions = buildSafeSuggestedQuestions(
    executiveSummary.suggestedQuestions,
    {
      rows: parsed.rows,
      profile,
      input: { useAi: false }
    },
    5
  );
  executiveSummary.suggestedQuestions = safeSuggestedQuestions.questions;
  const chartsWithNarratives = applyChartNarratives(charts, chartNarratives);
  const chartsWithRecommendations = applyChartRecommendations(chartsWithNarratives);

  return {
    analysisId: session.analysisId,
    fileName: parsed.fileName,
    dataSummaryNotes: buildDataSummaryNotes(cleanedDatasetProfile, parsed.rows),
    datasetSummary: {
      rowCount: duckDbSnapshot.rowCount,
      columnCount: duckDbSnapshot.columnCount,
      sheetName: parsed.sheetName
    },
    profile,
    kpis,
    kpiCards,
    charts: chartsWithRecommendations,
    edaSummary,
    executiveSummary
  };
}
