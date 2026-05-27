import type {
  ChartConfig,
  DatasetProfile,
  DatasetRow,
  IntentDetectionResult,
  KpiCandidate,
  QuestionContextInput
} from "../../../analytics/types.js";
import { analyzeDatasetCapabilities } from "../capabilities/DatasetCapabilityAnalyzer.js";
import { buildChartConfigs } from "../chart-config/ChartConfigBuilder.js";
import { generateTemplateBasedChartExplanation } from "../explanations/TemplateBasedExplanationGenerator.js";
import { detectRuleBasedIntent } from "../intent/RuleBasedIntentDetector.js";
import { rankRuleBasedCharts } from "../chart-ranking/RuleBasedChartRanker.js";
import { generateRuleBasedChartCandidates } from "./RuleBasedChartCandidateGenerator.js";
import { buildOpsSupportOverviewFallbackCharts } from "./opsSupportOverviewFallback.js";
import type { ChartSelectionContext } from "./chartSelectionTypes.js";

interface SelectionResult {
  intent: IntentDetectionResult;
  charts: ChartConfig[];
  summary: string;
  explanation: string;
  lookFor: string[];
  warnings: string[];
  followUps: string[];
}

function buildWarnings(context: ChartSelectionContext) {
  const warnings: string[] = [];
  const primaryMetric = context.intent.targetMetrics[0];

  if (context.intent.timeRequired && context.capabilities.datetimeFields.length === 0) {
    warnings.push("No date field was detected, so trend analysis was replaced with comparison and distribution charts.");
  }

  if (primaryMetric === "roi" && !context.capabilities.numericMetrics.includes("roi")) {
    if (context.capabilities.derivedMetrics.includes("roi")) {
      warnings.push("ROI was not present as a source column, so DataLens derived it from revenue and cost.");
    } else {
      warnings.push("ROI was not available, so DataLens fell back to adjacent revenue and cost analysis.");
    }
  }

  if (context.intent.targetDimensions[0] && !context.capabilities.categoricalDimensions.includes(context.intent.targetDimensions[0])) {
    warnings.push(
      `${context.intent.targetDimensions[0]} was not detected as a valid dimension, so DataLens used ${context.capabilities.defaultDimension ?? "another segment field"} instead.`
    );
  }

  return warnings;
}

export function selectRuleBasedCharts(params: {
  question: string;
  rows: DatasetRow[];
  profile: DatasetProfile;
  kpis: KpiCandidate[];
  semanticProfile?: ChartSelectionContext["semanticProfile"];
  input?: QuestionContextInput;
}): SelectionResult {
  const capabilities = analyzeDatasetCapabilities(params.profile, params.kpis);
  const intent = detectRuleBasedIntent(params.question, capabilities);
  const context: ChartSelectionContext = {
    ...params,
    capabilities,
    intent
  };
  const warnings = buildWarnings(context);
  const candidates = generateRuleBasedChartCandidates(context);
  let charts = rankRuleBasedCharts(buildChartConfigs(candidates, context), intent);

  if (charts.length < 4) {
    const fallbackIntent = {
      ...intent,
      primaryIntent: "general_overview" as const
    };
    const fallbackContext: ChartSelectionContext = {
      ...context,
      intent: fallbackIntent
    };
    const fallbackCharts = buildChartConfigs(generateRuleBasedChartCandidates(fallbackContext), fallbackContext);
    charts = rankRuleBasedCharts([...charts, ...fallbackCharts], intent);
  }

  charts = buildOpsSupportOverviewFallbackCharts(context, charts);

  const explanation = generateTemplateBasedChartExplanation({
    question: params.question,
    intent,
    charts,
    capabilities,
    warnings
  });

  return {
    intent,
    charts,
    summary: explanation.summary,
    explanation: explanation.explanation,
    lookFor: explanation.lookFor,
    warnings: explanation.warnings,
    followUps: explanation.followUps
  };
}
