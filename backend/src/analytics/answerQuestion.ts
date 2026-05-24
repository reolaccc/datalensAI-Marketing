import type { DatasetProfile, DatasetRow, QuestionAnswer, QuestionContextInput } from "./types.js";
import { executePlannedQuery } from "./queryEngine.js";
import { planQuery } from "./queryPlanner.js";
import { detectKpis } from "./detectKpis.js";
import { selectRuleBasedCharts } from "../services/analytics/chart-selection/selectRuleBasedCharts.js";

interface QuestionContext {
  rows: DatasetRow[];
  profile: DatasetProfile;
  input?: QuestionContextInput;
}

export function answerDatasetQuestion(question: string, context: QuestionContext): QuestionAnswer {
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

  return {
    ...answer,
    detectedIntent: chartSelection.intent,
    analysisSummary: chartSelection.summary,
    chartSelectionSummary: chartSelection.explanation,
    missingFieldWarnings: chartSelection.warnings,
    suggestedFollowUps: chartSelection.followUps,
    recommendedCharts: chartSelection.charts
  };
}
