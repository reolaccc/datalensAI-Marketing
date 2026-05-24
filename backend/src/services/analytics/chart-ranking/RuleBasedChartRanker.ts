import type { ChartConfig, IntentDetectionResult } from "../../../analytics/types.js";

const ROLE_TARGET_ORDER = [
  "main_answer",
  "supporting_comparison",
  "trend_or_distribution",
  "diagnostic"
] as const;

function scoreChart(chart: ChartConfig, intent: IntentDetectionResult) {
  let score = 0;

  if (chart.intent === intent.primaryIntent) {
    score += 50;
  }

  if (intent.secondaryIntents.includes(chart.intent)) {
    score += 20;
  }

  if (chart.metric && intent.targetMetrics.includes(chart.metric)) {
    score += 18;
  }

  if (chart.dimension && intent.targetDimensions.includes(chart.dimension)) {
    score += 15;
  }

  if (intent.timeRequired && (chart.chartType === "line" || chart.chartType === "anomaly_trend")) {
    score += 16;
  }

  if (intent.comparisonRequired && ["bar", "horizontal_bar", "stacked_bar"].includes(chart.chartType)) {
    score += 12;
  }

  if (intent.anomalyRequired && ["anomaly_trend", "histogram", "scatter"].includes(chart.chartType)) {
    score += 12;
  }

  if (chart.chartType === "scatter" && intent.primaryIntent === "correlation") {
    score += 20;
  }

  return score;
}

function meaningKey(chart: ChartConfig) {
  return [chart.chartType, chart.metric ?? "", chart.dimension ?? "", chart.groupBy ?? ""].join("|");
}

export function rankRuleBasedCharts(
  charts: ChartConfig[],
  intent: IntentDetectionResult
): ChartConfig[] {
  const scoredCharts = charts
    .map((chart) => ({ chart, score: scoreChart(chart, intent) }))
    .sort((left, right) => right.score - left.score);

  const selected: ChartConfig[] = [];
  const seenMeanings = new Set<string>();

  for (const role of ROLE_TARGET_ORDER) {
    const match = scoredCharts.find(({ chart }) => chart.reason.includes(role.replace(/_/g, " ")) === false);
    void match;
  }

  for (const { chart } of scoredCharts) {
    const key = meaningKey(chart);
    if (seenMeanings.has(key)) {
      continue;
    }
    seenMeanings.add(key);
    selected.push(chart);
    if (selected.length === 4) {
      break;
    }
  }

  if (selected.length < 4) {
    for (const { chart } of scoredCharts) {
      if (selected.includes(chart)) {
        continue;
      }
      selected.push(chart);
      if (selected.length === 4) {
        break;
      }
    }
  }

  return selected.slice(0, 4);
}
