export type SemanticBusinessIntent =
  | "high_potential"
  | "best_performing"
  | "scalable"
  | "efficient"
  | "underperforming"
  | "wasting_budget"
  | "growth_opportunity"
  | "neutral";

export interface SemanticMetricSignal {
  metric: string;
  direction: "high" | "low";
  weight: number;
}

export interface SemanticBusinessIntentAnalysis {
  businessIntent: SemanticBusinessIntent;
  matchedPhrases: string[];
  metricSignals: SemanticMetricSignal[];
  dimensionHints: string[];
  confidence: number;
  summary: string;
}

interface SemanticProfile {
  availableMetrics: string[];
  availableDimensions: string[];
}

interface SemanticRule {
  intent: Exclude<SemanticBusinessIntent, "neutral">;
  phrases: string[];
  metricSignals: SemanticMetricSignal[];
  dimensionHints: string[];
  summary: string;
}

const SEMANTIC_RULES: SemanticRule[] = [
  {
    intent: "high_potential",
    phrases: ["high potential", "potential", "good", "winning", "best", "strong", "promising", "high upside"],
    metricSignals: [
      { metric: "roas", direction: "high", weight: 0.32 },
      { metric: "conversion_rate", direction: "high", weight: 0.24 },
      { metric: "revenue", direction: "high", weight: 0.18 },
      { metric: "clicks", direction: "high", weight: 0.08 },
      { metric: "cpa", direction: "low", weight: 0.18 }
    ],
    dimensionHints: ["campaign", "channel", "audience", "ad set", "segment", "group"],
    summary: "high potential / winning performance"
  },
  {
    intent: "best_performing",
    phrases: ["best performing", "best performer", "top performing", "winning", "best", "strongest"],
    metricSignals: [
      { metric: "roas", direction: "high", weight: 0.3 },
      { metric: "conversion_rate", direction: "high", weight: 0.25 },
      { metric: "revenue", direction: "high", weight: 0.2 },
      { metric: "cpa", direction: "low", weight: 0.15 },
      { metric: "cpc", direction: "low", weight: 0.1 }
    ],
    dimensionHints: ["campaign", "channel", "audience", "ad set", "segment", "device"],
    summary: "best performing segment"
  },
  {
    intent: "scalable",
    phrases: ["scalable", "scale", "scaleable", "growth opportunity", "expand", "grow", "increase volume"],
    metricSignals: [
      { metric: "roas", direction: "high", weight: 0.28 },
      { metric: "conversion_rate", direction: "high", weight: 0.22 },
      { metric: "revenue", direction: "high", weight: 0.18 },
      { metric: "impressions", direction: "high", weight: 0.12 },
      { metric: "clicks", direction: "high", weight: 0.1 },
      { metric: "cpa", direction: "low", weight: 0.1 }
    ],
    dimensionHints: ["campaign", "channel", "audience", "ad set", "segment", "source"],
    summary: "scaling potential / growth opportunity"
  },
  {
    intent: "efficient",
    phrases: ["efficient", "most efficient", "efficiency", "efficient ad set", "efficient campaign", "lean", "productive"],
    metricSignals: [
      { metric: "roas", direction: "high", weight: 0.34 },
      { metric: "conversion_rate", direction: "high", weight: 0.24 },
      { metric: "cpa", direction: "low", weight: 0.18 },
      { metric: "cpc", direction: "low", weight: 0.12 },
      { metric: "revenue_per_click", direction: "high", weight: 0.12 }
    ],
    dimensionHints: ["campaign", "channel", "audience", "ad set", "segment", "device"],
    summary: "efficiency leadership"
  },
  {
    intent: "underperforming",
    phrases: ["underperforming", "poor performance", "poor", "weak", "losing", "lagging", "low potential"],
    metricSignals: [
      { metric: "roas", direction: "low", weight: 0.3 },
      { metric: "conversion_rate", direction: "low", weight: 0.24 },
      { metric: "cpa", direction: "high", weight: 0.2 },
      { metric: "cpc", direction: "high", weight: 0.12 },
      { metric: "cost", direction: "high", weight: 0.14 }
    ],
    dimensionHints: ["campaign", "channel", "audience", "ad set", "segment", "device"],
    summary: "underperformance / weak efficiency"
  },
  {
    intent: "wasting_budget",
    phrases: ["wasting budget", "waste budget", "budget waste", "burning spend", "overspending", "expensive", "too much spend"],
    metricSignals: [
      { metric: "cpa", direction: "high", weight: 0.28 },
      { metric: "cpc", direction: "high", weight: 0.22 },
      { metric: "cost", direction: "high", weight: 0.2 },
      { metric: "roas", direction: "low", weight: 0.18 },
      { metric: "conversion_rate", direction: "low", weight: 0.12 }
    ],
    dimensionHints: ["campaign", "channel", "audience", "ad set", "segment"],
    summary: "budget efficiency risk"
  },
  {
    intent: "growth_opportunity",
    phrases: ["growth opportunity", "opportunity", "upside", "room to grow", "expand", "scale up"],
    metricSignals: [
      { metric: "revenue", direction: "high", weight: 0.24 },
      { metric: "roas", direction: "high", weight: 0.28 },
      { metric: "conversion_rate", direction: "high", weight: 0.2 },
      { metric: "clicks", direction: "high", weight: 0.12 },
      { metric: "impressions", direction: "high", weight: 0.08 },
      { metric: "cpa", direction: "low", weight: 0.08 }
    ],
    dimensionHints: ["campaign", "channel", "audience", "ad set", "segment", "source"],
    summary: "growth opportunity"
  }
];

const DIRECTIONAL_HINTS = [
  { intent: "wasting_budget" as const, phrases: ["wasting budget", "budget waste", "burning spend", "too much spend"] },
  { intent: "underperforming" as const, phrases: ["underperforming", "poor", "weak", "lagging", "low potential"] },
  { intent: "scalable" as const, phrases: ["scalable", "scale", "growth opportunity", "expand"] },
  { intent: "efficient" as const, phrases: ["efficient", "efficiency", "most efficient"] },
  { intent: "high_potential" as const, phrases: ["high potential", "potential", "good", "winning", "best"] }
];

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function availableMetricMatches(metric: string, availableMetrics: string[]) {
  const normalizedMetric = normalize(metric);
  return availableMetrics.some((candidate) => normalize(candidate) === normalizedMetric || normalize(candidate).includes(normalizedMetric));
}

function hasDerivedSupport(metric: string, availableMetrics: string[]) {
  const set = new Set(availableMetrics.map(normalize));
  if (metric === "roas" || metric === "roi") {
    return set.has("revenue") && set.has("cost");
  }
  if (metric === "conversion_rate") {
    return (set.has("clicks") && (set.has("conversions") || set.has("orders") || set.has("deals"))) || set.has("conversion rate");
  }
  if (metric === "cpc") {
    return set.has("cost") && set.has("clicks");
  }
  if (metric === "cpa") {
    return set.has("cost") && (set.has("conversions") || set.has("orders") || set.has("deals"));
  }
  if (metric === "revenue_per_click") {
    return set.has("revenue") && set.has("clicks");
  }
  if (metric === "average_order_value") {
    return set.has("revenue") && (set.has("orders") || set.has("deals"));
  }
  if (metric === "margin") {
    return set.has("profit") || set.has("revenue");
  }
  return false;
}

function metricIsAvailable(metric: string, availableMetrics: string[]) {
  return availableMetricMatches(metric, availableMetrics) || hasDerivedSupport(metric, availableMetrics);
}

function resolveSemanticMetrics(rules: SemanticRule[], availableMetrics: string[]) {
  const resolved = rules.flatMap((rule) =>
    rule.metricSignals
      .filter((signal) => metricIsAvailable(signal.metric, availableMetrics))
      .map((signal) => ({ metric: signal.metric, direction: signal.direction, weight: signal.weight }))
  );

  return [...new Map(resolved.map((signal) => [`${signal.metric}:${signal.direction}`, signal])).values()];
}

export function detectSemanticBusinessIntent(
  question: string,
  context: SemanticProfile,
  options?: { preferPhrases?: boolean }
): SemanticBusinessIntentAnalysis {
  const normalizedQuestion = normalize(question);
  const matchedPhrases = new Set<string>();
  const scoredRules = SEMANTIC_RULES.map((rule) => {
    let score = 0;
    for (const phrase of rule.phrases) {
      if (normalizedQuestion.includes(phrase)) {
        matchedPhrases.add(phrase);
        score += phrase.includes(" ") ? 2 : 1;
      }
    }
    for (const hint of rule.dimensionHints) {
      if (normalizedQuestion.includes(hint)) {
        score += 0.4;
      }
    }
    return { rule, score };
  }).sort((left, right) => right.score - left.score);

  const winner = scoredRules[0];
  const matchedRule = winner?.score > 0 ? winner.rule : undefined;
  const businessIntent = matchedRule?.intent ?? "neutral";
  const confidence = Math.min(
    0.98,
    Number((0.44 + Math.min(4, [...matchedPhrases].length) * 0.11 + (matchedRule ? winner.score * 0.04 : 0)).toFixed(2))
  );

  const prioritizedRules = matchedRule ? [matchedRule] : [];
  const metricSignals = matchedRule ? resolveSemanticMetrics(prioritizedRules, context.availableMetrics) : [];
  const dimensionHints = matchedRule?.dimensionHints.filter((hint) =>
    context.availableDimensions.some((dimension) => normalize(dimension).includes(normalize(hint)))
  ) ?? [];

  const summary = matchedRule
    ? `${matchedRule.summary}${dimensionHints.length > 0 ? ` on ${dimensionHints[0]}` : ""}`
    : "no specific business intent detected";

  return {
    businessIntent,
    matchedPhrases: [...matchedPhrases],
    metricSignals,
    dimensionHints,
    confidence,
    summary
  };
}

export function buildSemanticMetricList(analysis: SemanticBusinessIntentAnalysis, availableMetrics: string[]) {
  const signals = analysis.metricSignals.length > 0 ? analysis.metricSignals : [];
  const ordered = [...signals].sort((left, right) => right.weight - left.weight);
  const resolved = ordered
    .map((signal) => signal.metric)
    .filter((metric) => metricIsAvailable(metric, availableMetrics));

  return [...new Set(resolved)];
}

export function semanticIntentLabel(intent: SemanticBusinessIntent) {
  switch (intent) {
    case "high_potential":
      return "high potential";
    case "best_performing":
      return "best performing";
    case "scalable":
      return "scaling potential";
    case "efficient":
      return "efficiency";
    case "underperforming":
      return "underperformance";
    case "wasting_budget":
      return "budget waste";
    case "growth_opportunity":
      return "growth opportunity";
    default:
      return "business performance";
  }
}
