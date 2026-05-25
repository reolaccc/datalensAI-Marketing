import type { DatasetCapabilities, IntentDetectionResult, IntentType } from "../../../analytics/types.js";
import { KPI_ALIASES } from "../../../utils/inference.js";
import { detectSemanticBusinessIntent } from "./semanticBusinessIntent.js";

const INTENT_KEYWORDS: Record<IntentType, string[]> = {
  trend_analysis: ["trend", "over time", "change", "decline", "increase", "decrease", "growing", "dropping", "monthly", "daily", "weekly", "growth", "momentum"],
  comparison: ["compare", "versus", "vs", "difference", "by channel", "by device", "by campaign", "by region"],
  ranking: ["best", "worst", "top", "bottom", "highest", "lowest", "perform", "underperform", "potential", "efficient", "scalable", "winning"],
  anomaly_detection: ["anomaly", "abnormal", "unusual", "spike", "outlier", "sudden", "strange"],
  correlation: ["relationship", "affect", "impact", "related", "correlation", "what drives", "what affects"],
  distribution: ["distribution", "spread", "range", "average", "median", "mix"],
  segmentation: ["segment", "group", "customer type", "device", "channel", "region"],
  efficiency_analysis: ["roi", "roas", "conversion rate", "cvr", "cost", "revenue", "efficiency", "return", "cpc", "cpa", "budget", "spend"],
  funnel_analysis: ["funnel", "drop-off", "drop off", "stage", "step", "journey"],
  data_quality: ["missing", "duplicate", "data quality", "invalid", "dirty data"],
  general_overview: []
};

function normalize(text: string) {
  return text.toLowerCase();
}

function extractMetrics(question: string, capabilities: DatasetCapabilities) {
  const normalizedQuestion = normalize(question);
  const matches = new Set<string>();

  for (const [metric, aliases] of Object.entries(KPI_ALIASES)) {
    const found = [metric, ...aliases].some((alias) => normalizedQuestion.includes(alias.replace(/_/g, " ")));
    if (!found) {
      continue;
    }

    const availableMetric = [...capabilities.numericMetrics, ...capabilities.derivedMetrics].find(
      (candidate) => candidate === metric || aliases.some((alias) => candidate.includes(alias))
    );
    if (availableMetric) {
      matches.add(availableMetric);
    }
  }

  const semantic = detectSemanticBusinessIntent(question, {
    availableMetrics: [...capabilities.numericMetrics, ...capabilities.derivedMetrics],
    availableDimensions: capabilities.categoricalDimensions
  });
  for (const signal of semantic.metricSignals) {
    const candidate = [...capabilities.numericMetrics, ...capabilities.derivedMetrics].find(
      (metric) => metric === signal.metric || metric.includes(signal.metric)
    );
    if (candidate) {
      matches.add(candidate);
    }
  }

  return [...matches];
}

function extractDimensions(question: string, capabilities: DatasetCapabilities) {
  const normalizedQuestion = normalize(question);
  const matches = new Set<string>();

  for (const dimension of capabilities.categoricalDimensions) {
    if (normalizedQuestion.includes(dimension.replace(/_/g, " "))) {
      matches.add(dimension);
    }
  }

  const byClause = normalizedQuestion.match(/\bby\s+([a-z_ ]+)/i)?.[1]?.trim();
  if (byClause) {
    const matchedDimension = capabilities.categoricalDimensions.find((dimension) =>
      byClause.includes(dimension.replace(/_/g, " "))
    );
    if (matchedDimension) {
      matches.add(matchedDimension);
    }
  }

  return [...matches];
}

export function detectRuleBasedIntent(
  question: string,
  capabilities: DatasetCapabilities
): IntentDetectionResult {
  const normalizedQuestion = normalize(question);
  const semantic = detectSemanticBusinessIntent(question, {
    availableMetrics: [...capabilities.numericMetrics, ...capabilities.derivedMetrics],
    availableDimensions: capabilities.categoricalDimensions
  });
  const intentScores = new Map<IntentType, number>();
  const matchedKeywords = new Set<string>();

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as Array<[IntentType, string[]]>) {
    let score = 0;
    for (const keyword of keywords) {
      if (normalizedQuestion.includes(keyword)) {
        score += keyword.includes(" ") ? 2 : 1;
        matchedKeywords.add(keyword);
      }
    }
    intentScores.set(intent, score);
  }

  if (semantic.businessIntent !== "neutral") {
    const semanticKeywords = [...semantic.matchedPhrases, semantic.summary].filter(Boolean);
    for (const keyword of semanticKeywords) {
      matchedKeywords.add(keyword);
    }
    const bump = 5;
    if (bump > 0) {
      intentScores.set("ranking", (intentScores.get("ranking") ?? 0) + bump);
      intentScores.set("efficiency_analysis", (intentScores.get("efficiency_analysis") ?? 0) + Math.max(2, bump - 1));
      intentScores.set("comparison", (intentScores.get("comparison") ?? 0) + 1);
    }
  }

  if (normalizedQuestion.trim().length === 0) {
    intentScores.set("general_overview", 1);
  }

  const sortedIntents = [...intentScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .filter((entry) => entry[1] > 0);

  const primaryIntent =
    semantic.businessIntent !== "neutral" && (sortedIntents[0]?.[0] === "ranking" || sortedIntents.length === 0)
      ? "ranking"
      : sortedIntents[0]?.[0] ?? "general_overview";
  const primaryScore = sortedIntents[0]?.[1] ?? 1;
  const secondaryIntents = sortedIntents.slice(1, 3).map((entry) => entry[0]);
  const targetMetrics = extractMetrics(question, capabilities);
  const targetDimensions = extractDimensions(question, capabilities);

  for (const hint of semantic.dimensionHints) {
    const matchedDimension = capabilities.categoricalDimensions.find(
      (dimension) => normalize(dimension).includes(normalize(hint))
    );
    if (matchedDimension && !targetDimensions.includes(matchedDimension)) {
      targetDimensions.push(matchedDimension);
    }
  }

  if (primaryIntent === "efficiency_analysis" && targetMetrics.length === 0) {
    const defaultEfficiencyMetric = ["roi", "roas", "conversion_rate", "revenue", "cost"].find((metric) =>
      [...capabilities.numericMetrics, ...capabilities.derivedMetrics].includes(metric)
    );
    if (defaultEfficiencyMetric) {
      targetMetrics.push(defaultEfficiencyMetric);
    }
  }

  if ((primaryIntent === "comparison" || primaryIntent === "segmentation") && targetDimensions.length === 0) {
    if (capabilities.defaultDimension) {
      targetDimensions.push(capabilities.defaultDimension);
    }
  }

  if (semantic.businessIntent !== "neutral" && targetMetrics.length === 0) {
    const semanticMetricOrder = semantic.metricSignals
      .map((signal) => signal.metric)
      .filter((metric) => [...capabilities.numericMetrics, ...capabilities.derivedMetrics].includes(metric));
    for (const metric of semanticMetricOrder) {
      if (!targetMetrics.includes(metric)) {
        targetMetrics.push(metric);
      }
    }
  }

  const confidence = Math.min(0.98, Number((0.45 + primaryScore * 0.12 + semantic.confidence * 0.2).toFixed(2)));

  return {
    primaryIntent,
    secondaryIntents,
    targetMetrics,
    targetDimensions,
    timeRequired:
      primaryIntent === "trend_analysis" ||
      primaryIntent === "anomaly_detection" ||
      normalizedQuestion.includes("over time") ||
      normalizedQuestion.includes("trend"),
    comparisonRequired: primaryIntent === "comparison" || normalizedQuestion.includes("compare"),
    anomalyRequired: primaryIntent === "anomaly_detection",
    confidence,
    matchedKeywords: [...matchedKeywords]
  };
}
