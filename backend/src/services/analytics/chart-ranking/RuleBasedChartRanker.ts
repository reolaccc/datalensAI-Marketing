import type { ChartConfig, IntentDetectionResult } from "../../../analytics/types.js";

const BAR_FAMILY = new Set(["bar", "horizontal_bar", "stacked_bar", "donut"]);

function inferAnalysisRole(chart: ChartConfig) {
  if (chart.analysisRole) {
    return chart.analysisRole;
  }

  if (chart.chartType === "donut") {
    return "composition";
  }
  if (chart.chartType === "funnel") {
    return "funnel";
  }
  if (chart.chartType === "anomaly_trend") {
    return "anomaly";
  }
  if (chart.chartType === "line") {
    return "trend";
  }
  if (chart.chartType === "scatter" || chart.chartType === "heatmap") {
    return "relationship";
  }
  if (chart.chartType === "histogram" || chart.chartType === "box_plot") {
    return "distribution";
  }
  if (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "stacked_bar") {
    return "comparison";
  }
  return "diagnostic";
}

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

  if (intent.comparisonRequired && ["bar", "horizontal_bar", "stacked_bar", "donut"].includes(chart.chartType)) {
    score += 12;
  }

  if (intent.anomalyRequired && ["anomaly_trend", "histogram", "scatter"].includes(chart.chartType)) {
    score += 12;
  }

  if (chart.chartType === "scatter" && intent.primaryIntent === "correlation") {
    score += 20;
  }

  const role = inferAnalysisRole(chart);
  if (role === "composition") {
    score += 10;
  }
  if (role === "efficiency") {
    score += 10;
  }
  if (role === "relationship") {
    score += 14;
  }
  if (role === "funnel") {
    score += 2;
  }

  return score;
}

function meaningKey(chart: ChartConfig) {
  return [chart.chartType, chart.metric ?? "", chart.dimension ?? "", chart.groupBy ?? "", chart.yKey ?? "", chart.xKey ?? ""].join("|");
}

function semanticKey(chart: ChartConfig) {
  return chart.semanticSignature ?? meaningKey(chart);
}

function roleQuota(role: ReturnType<typeof inferAnalysisRole>, intent: IntentDetectionResult) {
  switch (role) {
    case "composition":
      return 1;
    case "trend":
      return intent.primaryIntent === "trend_analysis" ? 2 : 1;
    case "comparison":
      return 2;
    case "efficiency":
      return 1;
    case "relationship":
      return 1;
    case "funnel":
      return 1;
    case "anomaly":
      return 1;
    case "distribution":
      return intent.primaryIntent === "distribution" ? 2 : 1;
    case "diagnostic":
    default:
      return 1;
  }
}

function countSameMetric(selected: ChartConfig[], metric?: string | null) {
  if (!metric) {
    return 0;
  }
  return selected.filter((chart) => chart.metric === metric).length;
}

function countSameDimension(selected: ChartConfig[], dimension?: string | null) {
  if (!dimension) {
    return 0;
  }
  return selected.filter((chart) => chart.dimension === dimension).length;
}

function countSameChartType(selected: ChartConfig[], chartType: string) {
  return selected.filter((chart) => chart.chartType === chartType).length;
}

function sameBarFamilyPair(selected: ChartConfig[], candidate: ChartConfig) {
  if (!candidate.metric || !candidate.dimension || !BAR_FAMILY.has(candidate.chartType)) {
    return false;
  }

  return selected.some(
    (chart) =>
      BAR_FAMILY.has(chart.chartType) &&
      chart.metric === candidate.metric &&
      chart.dimension === candidate.dimension
  );
}

function diversityScore(candidate: ChartConfig, selected: ChartConfig[], roleCounts: Map<string, number>) {
  const role = inferAnalysisRole(candidate);
  const metricCount = countSameMetric(selected, candidate.metric);
  const dimensionCount = countSameDimension(selected, candidate.dimension);
  const chartTypeCount = countSameChartType(selected, candidate.chartType);
  const hasSameRole = (roleCounts.get(role) ?? 0) > 0;

  let score = 0;

  if (!hasSameRole) {
    score += 18;
  }

  if (role === "efficiency" || role === "relationship" || role === "funnel") {
    score += 10;
  }

  if (role === "relationship") {
    score += 6;
  }

  if (role === "funnel") {
    score -= 2;
  }

  if (candidate.metric && metricCount === 0) {
    score += 8;
  } else if (metricCount === 1) {
    score -= 10;
  } else if (metricCount >= 2) {
    score -= 22;
  }

  if (candidate.dimension && dimensionCount === 0) {
    score += 6;
  } else if (dimensionCount === 1) {
    score -= 8;
  } else if (dimensionCount >= 2) {
    score -= 18;
  }

  if (chartTypeCount === 0) {
    score += 4;
  } else if (chartTypeCount >= 1) {
    score -= 8;
  }

  if (sameBarFamilyPair(selected, candidate)) {
    score -= 20;
  }

  return score;
}

function buildSelectionOrder(intent: IntentDetectionResult) {
  if (intent.primaryIntent === "trend_analysis") {
    return ["trend", "composition", "comparison", "efficiency", "relationship", "funnel", "anomaly", "distribution", "diagnostic"] as const;
  }

  return ["trend", "composition", "comparison", "efficiency", "relationship", "funnel", "anomaly", "distribution", "diagnostic"] as const;
}

export function rankRuleBasedCharts(
  charts: ChartConfig[],
  intent: IntentDetectionResult
): ChartConfig[] {
  const scoredCharts = charts
    .map((chart) => ({
      chart,
      baseScore: scoreChart(chart, intent),
      role: inferAnalysisRole(chart)
    }))
    .sort((left, right) => right.baseScore - left.baseScore);

  const selected: ChartConfig[] = [];
  const seenSignatures = new Set<string>();
  const roleCounts = new Map<string, number>();
  const roleOrder = buildSelectionOrder(intent);

  while (selected.length < 4) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < scoredCharts.length; index += 1) {
      const entry = scoredCharts[index];
      if (seenSignatures.has(semanticKey(entry.chart))) {
        continue;
      }

      const currentRole = entry.role;
      const quota = roleQuota(currentRole, intent);
      if ((roleCounts.get(currentRole) ?? 0) >= quota) {
        continue;
      }

      const rolePriority = roleOrder.indexOf(currentRole as (typeof roleOrder)[number]);
      const rolePriorityBonus = rolePriority >= 0 ? (roleOrder.length - rolePriority) * 2 : 0;
      const adjustedScore =
        entry.baseScore +
        rolePriorityBonus +
        diversityScore(entry.chart, selected, roleCounts);

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) {
      break;
    }

    const chosen = scoredCharts[bestIndex];
    selected.push(chosen.chart);
    seenSignatures.add(semanticKey(chosen.chart));
    roleCounts.set(chosen.role, (roleCounts.get(chosen.role) ?? 0) + 1);
  }

  if (selected.length < 4) {
    for (const { chart } of scoredCharts) {
      if (selected.includes(chart)) {
        continue;
      }
      const role = inferAnalysisRole(chart);
      if ((roleCounts.get(role) ?? 0) >= roleQuota(role, intent)) {
        continue;
      }
      if (sameBarFamilyPair(selected, chart)) {
        continue;
      }
      selected.push(chart);
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      if (selected.length === 4) {
        break;
      }
    }
  }

  return selected.slice(0, 4);
}
