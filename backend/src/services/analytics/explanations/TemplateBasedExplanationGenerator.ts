import type { ChartConfig, DatasetCapabilities, IntentDetectionResult } from "../../../analytics/types.js";
import { buildSuggestedQuestionsFromCharts } from "../../../analytics/suggestedQuestions.js";

interface ExplanationInput {
  question: string;
  intent: IntentDetectionResult;
  charts: ChartConfig[];
  capabilities: DatasetCapabilities;
  warnings: string[];
}

function humanizeIntent(intent: string) {
  return intent.replace(/_/g, " ");
}

export function generateTemplateBasedChartExplanation({
  question,
  intent,
  charts,
  capabilities,
  warnings
}: ExplanationInput) {
  const chartTitles = charts.map((chart) => chart.title).join(", ");
  const summary = `DataLens detected ${humanizeIntent(intent.primaryIntent)} for "${question}" and selected ${chartTitles}.`;
  const explanation = `To answer this question, DataLens prioritized one main answer chart, one supporting comparison, one trend or distribution view, and one diagnostic chart. Together, these help validate the same business question from multiple analytical angles.`;
  const lookFor = charts.map((chart) => `${chart.title}: ${chart.reason}`);
  const followUps = buildSuggestedQuestionsFromCharts({
    charts,
    capabilities,
    excludeQuestions: [question],
    limit: 4
  });

  if (followUps.length === 0) {
    followUps.push(
      intent.targetDimensions[0]
        ? `Break ${intent.targetMetrics[0] ?? capabilities.defaultMetric ?? "the metric"} down by ${intent.targetDimensions[0]}.`
        : `Compare the strongest metric by ${capabilities.defaultDimension ?? "the leading segment"}.`
    );
  }

  return {
    summary,
    explanation,
    lookFor,
    warnings,
    followUps
  };
}
