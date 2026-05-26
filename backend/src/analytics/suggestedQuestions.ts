import type { ChartConfig, DatasetCapabilities, SemanticBusinessIntentAnalysis } from "./types.js";
import type { AnalyticsFacts } from "../llm/types.js";
import type { SemanticDatasetContract } from "./semanticContract.js";
import { resolveCanonicalDimensionKey } from "./semanticContract.js";

export interface SuggestedQuestionCandidate {
  question: string;
  intent: "comparison" | "composition" | "efficiency" | "trend" | "funnel" | "action" | "distribution" | "relationship";
  dimension?: string | null;
  metric?: string | null;
  reason: string;
  score: number;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function canonicalDimensionLabel(dimension: string | null | undefined, semanticContract?: SemanticDatasetContract | null) {
  if (!dimension) {
    return null;
  }

  const canonical = semanticContract ? resolveCanonicalDimensionKey(semanticContract, dimension) : dimension;
  const normalized = canonical.toLowerCase().replace(/_/g, " ");

  if (normalized.includes("account")) {
    return "account";
  }
  if (normalized.includes("customer")) {
    return "customer";
  }
  if (normalized.includes("client")) {
    return "client";
  }
  if (normalized === "date" || normalized.includes("date")) {
    return "date";
  }
  if (normalized === "channel") {
    return "channel";
  }
  if (normalized === "campaign") {
    return "campaign";
  }
  if (normalized === "region") {
    return "region";
  }
  if (normalized === "device") {
    return "device";
  }

  return normalized;
}

function canonicalMetricLabel(metric: string | null | undefined) {
  if (!metric) {
    return null;
  }

  const normalized = metric.toLowerCase().replace(/_/g, " ");
  if (normalized.includes("roas")) {
    return "ROAS";
  }
  if (normalized.includes("ctr")) {
    return "CTR";
  }
  if (normalized.includes("cvr") || normalized.includes("conversion rate")) {
    return "CVR";
  }
  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income") || normalized.includes("gmv")) {
    return "revenue";
  }
  if (normalized.includes("spend") || normalized.includes("cost") || normalized.includes("budget")) {
    return "spend";
  }
  if (normalized.includes("click")) {
    return "clicks";
  }
  if (normalized.includes("impression")) {
    return "impressions";
  }
  if (normalized.includes("conversion")) {
    return "conversions";
  }
  return normalized;
}

function canonicalDimensionKey(dimension: string | null | undefined, semanticContract?: SemanticDatasetContract | null) {
  if (!dimension) {
    return null;
  }

  return semanticContract ? resolveCanonicalDimensionKey(semanticContract, dimension) : dimension.toLowerCase();
}

function dedupeCandidates(candidates: SuggestedQuestionCandidate[]) {
  const seen = new Map<string, SuggestedQuestionCandidate>();

  for (const candidate of candidates) {
    const key = normalize(candidate.question);
    const current = seen.get(key);
    if (!current || candidate.score > current.score) {
      seen.set(key, candidate);
    }
  }

  return [...seen.values()]
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index, all) => all.findIndex((entry) => normalize(entry.question) === normalize(candidate.question)) === index);
}

function hasMetric(candidates: SuggestedQuestionCandidate[], metric: string) {
  return candidates.some((candidate) => canonicalMetricLabel(candidate.metric) === metric);
}

function hasDimension(candidates: SuggestedQuestionCandidate[], dimension: string) {
  return candidates.some((candidate) => canonicalDimensionKey(candidate.dimension, null) === dimension);
}

function buildComparisonQuestion(dimension: string, metric: string) {
  if (metric === "ROAS") {
    return `Which ${dimension} has the best ROAS?`;
  }
  if (metric === "CTR") {
    return `Which ${dimension} has the best CTR?`;
  }
  if (metric === "CVR") {
    return `Which ${dimension} has the best CVR?`;
  }
  if (metric === "clicks") {
    return `Which ${dimension} generated the most clicks?`;
  }
  if (metric === "impressions") {
    return `Which ${dimension} generated the most impressions?`;
  }
  if (metric === "conversions") {
    return `Which ${dimension} generated the most conversions?`;
  }
  return `Which ${dimension} generated the most revenue?`;
}

function buildCompositionQuestion(dimension: string, metric: string) {
  if (metric === "ROAS" || metric === "CTR" || metric === "CVR") {
    return "";
  }
  return `Is ${metric} too concentrated in one ${dimension}?`;
}

function buildTrendQuestion(metric: string) {
  return `Where did ${metric} increase or drop the most?`;
}

function buildEfficiencyQuestion(dimension: string) {
  return `Which ${dimension} should receive more budget?`;
}

function buildFunnelQuestion() {
  return "Where are users dropping off between impressions, clicks, and conversions?";
}

function chartRolePriority(role?: string | null) {
  switch (role) {
    case "comparison":
      return 5;
    case "composition":
      return 4;
    case "efficiency":
      return 4;
    case "relationship":
      return 3;
    case "trend":
      return 3;
    case "funnel":
      return 4;
    case "distribution":
      return 1;
    default:
      return 2;
  }
}

function isCallTrackingContract(contract?: SemanticDatasetContract | null) {
  const domain = contract?.detectedDomain?.domain;
  return (
    domain === "call_tracking" ||
    domain === "call_operations" ||
    domain === "marketing_attribution" ||
    domain === "mixed_call_tracking_attribution"
  );
}

function hasSemanticRole(contract: SemanticDatasetContract | null | undefined, role: string) {
  return Boolean(contract?.roleMappings?.some((mapping) => mapping.semanticRole === role && mapping.confidence >= 0.5));
}

function buildCallTrackingQuestions(contract: SemanticDatasetContract, limit: number, excludeQuestions?: string[]) {
  const questions: SuggestedQuestionCandidate[] = [];
  const domain = contract.detectedDomain?.domain;
  const hasCalls = hasSemanticRole(contract, "callId");
  const hasQualified = hasSemanticRole(contract, "qualifiedCall");
  const hasConverted = hasSemanticRole(contract, "convertedCall");
  const hasRevenue = hasSemanticRole(contract, "revenue");
  const hasSpend = hasSemanticRole(contract, "spend");
  const hasDuration =
    hasSemanticRole(contract, "callDuration") ||
    hasSemanticRole(contract, "talkTime") ||
    hasSemanticRole(contract, "handleTime") ||
    hasSemanticRole(contract, "waitTime") ||
    hasSemanticRole(contract, "ringTime");
  const hasMissed = hasSemanticRole(contract, "missedCall") || hasSemanticRole(contract, "callStatus");

  const hasDimension = (dimension: string) => contract.availableDimensions.includes(dimension);

  if (hasDimension("channel") && hasCalls) {
    questions.push({
      question: "Which channel drives the most calls?",
      intent: "comparison",
      dimension: "channel",
      metric: "calls",
      reason: "Channel and call volume are both available.",
      score: 100
    });
  }

  if (hasDimension("source") && hasCalls) {
    questions.push({
      question: "Which source drives the most calls?",
      intent: "comparison",
      dimension: "source",
      metric: "calls",
      reason: "Source and call volume are both available.",
      score: 98
    });
  }

  if (hasDimension("medium") && hasCalls) {
    questions.push({
      question: "Which medium drives the most calls?",
      intent: "comparison",
      dimension: "medium",
      metric: "calls",
      reason: "Medium and call volume are both available.",
      score: 97
    });
  }

  if (hasDimension("account") && hasCalls) {
    questions.push({
      question: "Which accounts generate the most calls?",
      intent: "comparison",
      dimension: "account",
      metric: "calls",
      reason: "Account and call volume are both available.",
      score: 96
    });
  }

  if (hasDimension("channel") && hasQualified) {
    questions.push({
      question: "Which channel drives the most qualified calls?",
      intent: "comparison",
      dimension: "channel",
      metric: "qualified calls",
      reason: "Channel and qualified call fields are both available.",
      score: 99
    });
  }

  if (hasDimension("campaign") && hasRevenue) {
    questions.push({
      question: "Which campaigns generate the most revenue?",
      intent: "comparison",
      dimension: "campaign",
      metric: "revenue",
      reason: "Campaign and revenue are both available.",
      score: 98
    });
  }

  if (hasDimension("campaign") && hasRevenue && hasSpend) {
    questions.push({
      question: "Which campaigns have the highest ROAS?",
      intent: "efficiency",
      dimension: "campaign",
      metric: "ROAS",
      reason: "Campaign, revenue, and spend are all available.",
      score: 97
    });
  }

  if (hasRevenue && hasSpend) {
    questions.push({
      question: "Where are we spending but not generating enough revenue?",
      intent: "efficiency",
      dimension: hasDimension("campaign") ? "campaign" : hasDimension("channel") ? "channel" : undefined,
      metric: "ROAS",
      reason: "Revenue and spend are both available.",
      score: 96
    });
  }

  if (hasDimension("source") && hasSpend && hasQualified) {
    questions.push({
      question: "Which source has the lowest cost per qualified call?",
      intent: "efficiency",
      dimension: "source",
      metric: "cost per qualified call",
      reason: "Source, spend, and qualified call data are all available.",
      score: 95
    });
  }

  if (hasDimension("channel") && hasMissed) {
    questions.push({
      question: "Which channels have the highest missed call rate?",
      intent: "comparison",
      dimension: "channel",
      metric: "missed call rate",
      reason: "Channel and missed-call style outcomes are available.",
      score: 94
    });
  }

  if (hasDimension("campaign") && hasDuration) {
    questions.push({
      question: "Which campaigns generate the longest calls?",
      intent: "comparison",
      dimension: "campaign",
      metric: "call duration",
      reason: "Campaign and call duration are both available.",
      score: 93
    });
  }

  if (hasDimension("source") && hasDuration) {
    questions.push({
      question: "Which sources have the longest calls?",
      intent: "comparison",
      dimension: "source",
      metric: "call duration",
      reason: "Source and call duration are both available.",
      score: 91
    });
  }

  if (hasDimension("account") && hasDuration) {
    questions.push({
      question: "Which accounts have the longest calls?",
      intent: "comparison",
      dimension: "account",
      metric: "call duration",
      reason: "Account and call duration are both available.",
      score: 90
    });
  }

  if (hasDimension("callStatus") || hasDimension("status")) {
    questions.push({
      question: "Which status appears most often?",
      intent: "distribution",
      dimension: hasDimension("callStatus") ? "callStatus" : "status",
      metric: "calls",
      reason: "Status data is available for a simple frequency view.",
      score: 89
    });
  }

  if (hasDimension("source") && hasMissed) {
    questions.push({
      question: "Which sources have the most missed or failed calls?",
      intent: "comparison",
      dimension: "source",
      metric: "missed call rate",
      reason: "Source and missed-call outcomes are both available.",
      score: 88
    });
  }

  if (hasDimension("keyword") && hasConverted) {
    questions.push({
      question: "Which keywords drive the most conversions?",
      intent: "comparison",
      dimension: "keyword",
      metric: "conversions",
      reason: "Keyword and conversion fields are both available.",
      score: 92
    });
  }

  if (domain === "call_operations") {
    if (hasDimension("location") && hasDuration) {
      questions.push({
        question: "Which locations have the longest calls?",
        intent: "comparison",
        dimension: "location",
        metric: "call duration",
        reason: "Location and call duration are both available.",
        score: 91
      });
    }

    if (hasDimension("location") && hasSemanticRole(contract, "repeatCaller")) {
      questions.push({
        question: "Which locations have the highest repeat caller rate?",
        intent: "comparison",
        dimension: "location",
        metric: "repeat caller rate",
        reason: "Location and repeat-caller data are both available.",
        score: 90
      });
    }

    if (hasDimension("location") && hasSemanticRole(contract, "callOutcome")) {
      questions.push({
        question: "Which locations have the most missed or failed calls?",
        intent: "comparison",
        dimension: "location",
        metric: "call outcome",
        reason: "Location and call outcome data are both available.",
        score: 89
      });
    }
  }

  return dedupeCandidates(questions)
    .filter((candidate) => !excludeQuestions?.some((question) => normalize(question) === normalize(candidate.question)))
    .slice(0, limit)
    .map((candidate) => candidate.question);
}

export function buildSuggestedQuestionsFromCharts(params: {
  charts: Pick<ChartConfig, "analysisRole" | "chartType" | "dimension" | "metric" | "title" | "semanticSignature">[];
  capabilities: DatasetCapabilities;
  semanticProfile?: SemanticBusinessIntentAnalysis;
  semanticContract?: SemanticDatasetContract | null;
  excludeQuestions?: string[];
  limit?: number;
}) {
  const candidates: SuggestedQuestionCandidate[] = [];
  const contract = params.semanticContract ?? params.capabilities.semanticContract ?? null;
  if (contract && isCallTrackingContract(contract)) {
    return buildCallTrackingQuestions(contract, params.limit ?? 4, params.excludeQuestions);
  }
  const hasRevenue = params.capabilities.numericMetrics.includes("revenue") || params.capabilities.derivedMetrics.includes("revenue");
  const hasSpend = params.capabilities.numericMetrics.includes("spend") || params.capabilities.numericMetrics.includes("cost");
  const hasClicks = params.capabilities.numericMetrics.includes("clicks");
  const hasImpressions = params.capabilities.numericMetrics.includes("impressions");
  const hasConversions = params.capabilities.numericMetrics.includes("conversions");
  const hasDate = params.capabilities.datetimeFields.length > 0;
  const hasFunnel = hasImpressions && hasClicks && hasConversions;

  const sortedCharts = [...params.charts].sort((left, right) => {
    const roleDiff = chartRolePriority(right.analysisRole) - chartRolePriority(left.analysisRole);
    if (roleDiff !== 0) {
      return roleDiff;
    }
    return (right.semanticSignature ?? right.title).localeCompare(left.semanticSignature ?? left.title);
  });

  for (const chart of sortedCharts) {
    const dimension = canonicalDimensionLabel(chart.dimension, contract);
    const metric = canonicalMetricLabel(chart.metric);
    const role = chart.analysisRole ?? "comparison";

    if (role === "comparison" && dimension && metric) {
      candidates.push({
        question: buildComparisonQuestion(dimension, metric),
        intent: "comparison",
        dimension,
        metric,
        reason: `The ${chart.title} view is a comparison chart, so a direct business question about the leading ${dimension} is a natural next step.`,
        score: 100 + chartRolePriority(role)
      });
    }

    if (role === "composition" && dimension && metric) {
      const question = buildCompositionQuestion(dimension, metric);
      if (question) {
        candidates.push({
          question,
          intent: "composition",
          dimension,
          metric,
          reason: `The ${chart.title} view is about share and concentration, so the follow-up should test whether ${metric} is too concentrated in one ${dimension}.`,
          score: 98 + chartRolePriority(role)
        });
      }
    }

    if (role === "efficiency" && dimension) {
      candidates.push({
        question: buildEfficiencyQuestion(dimension),
        intent: "efficiency",
        dimension,
        metric,
        reason: `The ${chart.title} view is about efficiency, so the next question should decide where budget should go next.`,
        score: 95 + chartRolePriority(role)
      });
    }

    if (role === "relationship") {
      const question = hasRevenue && hasSpend
        ? "Which campaigns have high spend but weak revenue?"
        : metric
          ? `Which ${dimension ?? "segments"} show the strongest relationship with ${metric}?`
          : "Which segments show the clearest trade-off between scale and efficiency?";
      candidates.push({
        question,
        intent: "relationship",
        dimension,
        metric,
        reason: `The ${chart.title} view compares two business signals, so the follow-up should ask where spend is not translating into value.`,
        score: 90 + chartRolePriority(role)
      });
    }

    if (role === "trend" && metric) {
      candidates.push({
        question: buildTrendQuestion(metric),
        intent: "trend",
        dimension: hasDate ? "date" : dimension,
        metric,
        reason: `The ${chart.title} view is a trend chart, so the next step should ask where the movement changed most.`,
        score: 90 + chartRolePriority(role)
      });
    }

    if (role === "funnel") {
      candidates.push({
        question: buildFunnelQuestion(),
        intent: "funnel",
        dimension: "date",
        metric: hasFunnel ? "funnel" : metric,
        reason: `The ${chart.title} view is a funnel, so the next step should be about stage drop-off.`,
        score: 92 + chartRolePriority(role)
      });
    }
  }

  if (params.semanticProfile?.businessIntent === "wasting_budget" || params.semanticProfile?.businessIntent === "underperforming") {
    candidates.push({
      question: "Which channels should be reviewed for low return?",
      intent: "efficiency",
      dimension: "channel",
      metric: hasRevenue && hasSpend ? "ROAS" : "spend",
      reason: `The detected business intent is about budget pressure or underperformance, so the follow-up should focus on where return is weakest.`,
      score: 99
    });
  }

  if (params.semanticProfile?.businessIntent === "scalable" || params.semanticProfile?.businessIntent === "growth_opportunity") {
    candidates.push({
      question: "Which campaigns should receive more budget?",
      intent: "efficiency",
      dimension: "campaign",
      metric: hasRevenue && hasSpend ? "ROAS" : "revenue",
      reason: `The detected business intent is about scale or growth, so the follow-up should identify where budget can be increased safely.`,
      score: 99
    });
  }

  if (hasRevenue && hasSpend && !hasMetric(candidates, "ROAS")) {
    candidates.push({
      question: "Which campaigns should receive more budget?",
      intent: "efficiency",
      dimension: "campaign",
      metric: "ROAS",
      reason: "Revenue and spend are both available, so budget allocation is a high-value next step.",
      score: 88
    });
  }

  if (hasRevenue && !hasDimension(candidates, "channel")) {
    candidates.push({
      question: "Which channel generated the most revenue?",
      intent: "comparison",
      dimension: "channel",
      metric: "revenue",
      reason: "Channel is a canonical marketing dimension and is usually a strong first comparison when revenue is available.",
      score: 80
    });
  }

  const ranked = dedupeCandidates(candidates)
    .filter((candidate) => candidate.question.trim().length > 0)
    .filter((candidate, index, all) =>
      all.findIndex((entry) => normalize(entry.question) === normalize(candidate.question)) === index
    )
    .filter((candidate) => {
      const excluded = params.excludeQuestions ?? [];
      return !excluded.some((question) => normalize(question) === normalize(candidate.question));
    });

  return ranked.slice(0, params.limit ?? 4).map((candidate) => candidate.question);
}

export function buildSuggestedQuestionsFromFacts(facts: AnalyticsFacts, limit = 5) {
  const candidates: SuggestedQuestionCandidate[] = [];
  const contract = facts.semanticContract ?? null;
  if (contract && isCallTrackingContract(contract)) {
    return buildCallTrackingQuestions(contract, limit);
  }
  const availableDimensions = contract?.availableDimensions ?? [];
  const sortedCharts = [...facts.charts].sort((left, right) => {
    const leftScore = chartRolePriority(left.analysisRole);
    const rightScore = chartRolePriority(right.analysisRole);
    return rightScore - leftScore;
  });
  const topRevenueDimension = canonicalDimensionLabel(facts.topFindings.topRevenueSegment?.dimension ?? null, contract);
  const bestRoasDimension = canonicalDimensionLabel(facts.topFindings.bestRoasSegment?.dimension ?? null, contract);
  const strongestDimension = canonicalDimensionLabel(facts.segments.strongestSegment?.dimension ?? null, contract);
  const weakestDimension = canonicalDimensionLabel(facts.segments.weakestSegment?.dimension ?? null, contract);
  const topRevenueMetric = canonicalMetricLabel(facts.topFindings.topRevenueSegment ? "revenue" : null);
  const top3Share = facts.concentration.top3RevenueShare;
  const hasRevenue = Boolean(facts.kpis.totalRevenue !== undefined || facts.topFindings.topRevenueSegment);
  const hasSpend = Boolean(facts.kpis.totalCost !== undefined);
  const hasClicks = Boolean(facts.kpis.totalClicks !== undefined);
  const hasImpressions = Boolean(facts.kpis.totalImpressions !== undefined);
  const hasConversions = Boolean(facts.rankings.topConversionEntities.length > 0 || facts.topFindings.bestConversionSegment);
  const hasChannel = availableDimensions.includes("channel");
  const hasRegion = availableDimensions.includes("region");

  for (const chart of sortedCharts) {
    const dimension = canonicalDimensionLabel(chart.dimension, contract);
    const metric = canonicalMetricLabel(chart.metric);
    const role = chart.analysisRole ?? "comparison";

    if (role === "comparison" && dimension && metric) {
      candidates.push({
        question: buildComparisonQuestion(dimension, metric),
        intent: "comparison",
        dimension,
        metric,
        reason: `The selected ${chart.title} chart is a comparison view, so the follow-up should focus on the leading ${dimension}.`,
        score: 110 + chartRolePriority(role)
      });
    }

    if (role === "composition" && dimension && metric) {
      const question = buildCompositionQuestion(dimension, metric);
      if (question) {
        candidates.push({
          question,
          intent: "composition",
          dimension,
          metric,
          reason: `The selected ${chart.title} chart is about share and concentration, so the next question should test mix risk.`,
          score: 108 + chartRolePriority(role)
        });
      }
    }

    if (role === "efficiency" && dimension) {
      candidates.push({
        question: buildEfficiencyQuestion(dimension),
        intent: "efficiency",
        dimension,
        metric,
        reason: `The selected ${chart.title} chart is about efficiency, so the next question should ask where to invest next.`,
        score: 107 + chartRolePriority(role)
      });
    }

    if (role === "trend" && metric) {
      candidates.push({
        question: buildTrendQuestion(metric),
        intent: "trend",
        dimension: "date",
        metric,
        reason: `The selected ${chart.title} chart is a trend view, so the next question should locate the biggest movement.`,
        score: 106 + chartRolePriority(role)
      });
    }

    if (role === "relationship") {
      candidates.push({
        question: hasRevenue && hasSpend
          ? "Which campaigns have high spend but weak revenue?"
          : "Which segments show the clearest trade-off between scale and efficiency?",
        intent: "relationship",
        dimension,
        metric,
        reason: `The selected ${chart.title} chart compares two business signals, so the next question should probe budget efficiency.`,
        score: 105 + chartRolePriority(role)
      });
    }

    if (role === "funnel") {
      candidates.push({
        question: buildFunnelQuestion(),
        intent: "funnel",
        dimension: "funnel",
        metric: "conversions",
        reason: `The selected ${chart.title} chart is a funnel, so the next question should isolate where drop-off happens.`,
        score: 104 + chartRolePriority(role)
      });
    }
  }

  if (topRevenueDimension && topRevenueMetric) {
    candidates.push({
      question: `Which ${topRevenueDimension} generated the most revenue?`,
      intent: "comparison",
      dimension: topRevenueDimension,
      metric: topRevenueMetric,
      reason: `The dataset already surfaces a top revenue ${topRevenueDimension}, so the most useful business question is to confirm the leading segment.`,
      score: 100
    });
  }

  if (bestRoasDimension) {
    candidates.push({
      question: `Which ${bestRoasDimension} has the best ROAS?`,
      intent: "comparison",
      dimension: bestRoasDimension,
      metric: "ROAS",
      reason: "Efficiency is a first-class business signal, so the best-returning segment is a strong follow-up.",
      score: 98
    });
  }

  if (top3Share !== undefined && top3Share > 0.35 && topRevenueDimension) {
    candidates.push({
      question: `Is revenue too concentrated in one ${topRevenueDimension}?`,
      intent: "composition",
      dimension: topRevenueDimension,
      metric: "revenue",
      reason: "High concentration suggests a useful next question about mix and dependency risk.",
      score: 96
    });
  }

  if (facts.comparisons.revenueVsEfficiencyMismatches.length > 0) {
    const mismatch = facts.comparisons.revenueVsEfficiencyMismatches[0];
    candidates.push({
      question: "Which campaigns should receive more budget?",
      intent: "efficiency",
      dimension: "campaign",
      metric: "ROAS",
      reason: mismatch.note,
      score: 97
    });
    candidates.push({
      question: "Which channels should be reviewed for low return?",
      intent: "efficiency",
      dimension: "channel",
      metric: "ROAS",
      reason: "Revenue and efficiency are pulling in different directions, so low-return channels should be reviewed.",
      score: 93
    });
  }

  if (facts.trends.hasDateField && facts.trends.recentChange) {
    const trendMetric = canonicalMetricLabel(facts.trends.recentChange.metric) ?? "revenue";
    const alreadyHasTrendForMetric = candidates.some(
      (candidate) => candidate.intent === "trend" && canonicalMetricLabel(candidate.metric) === trendMetric
    );
    if (!alreadyHasTrendForMetric) {
      candidates.push({
        question: `Where did ${trendMetric} drop the most?`,
        intent: "trend",
        dimension: "date",
        metric: trendMetric,
        reason: "Time is available, so the next business question should locate the biggest movement over time.",
        score: 94
      });
    }
  }

  if (hasRevenue && hasSpend) {
    candidates.push({
      question: "Which campaigns have high spend but weak revenue?",
      intent: "efficiency",
      dimension: "campaign",
      metric: "revenue",
      reason: "Revenue and spend are both present, so budget pressure should be reviewed at campaign level.",
      score: 95
    });

    if (hasChannel) {
      candidates.push({
        question: "Which channel has the best ROAS?",
        intent: "efficiency",
        dimension: "channel",
        metric: "ROAS",
        reason: "Channel is a core semantic dimension and revenue plus spend are available, so channel efficiency is a strong next-step question.",
        score: 94
      });
    } else if (hasRegion) {
      candidates.push({
        question: "Which region has the best ROAS?",
        intent: "efficiency",
        dimension: "region",
        metric: "ROAS",
        reason: "Region is the next strongest available semantic dimension, so regional efficiency is a useful business follow-up.",
        score: 94
      });
    }
  }

  if (hasImpressions && hasClicks && hasConversions) {
    candidates.push({
      question: "Where are users dropping off between impressions, clicks, and conversions?",
      intent: "funnel",
      dimension: "funnel",
      metric: "conversions",
      reason: "The dataset supports a full funnel read, so stage drop-off is a valuable next question.",
      score: 92
    });
    candidates.push({
      question: "Which channel has the strongest funnel efficiency?",
      intent: "funnel",
      dimension: "channel",
      metric: "CVR",
      reason: "The funnel metrics are available, so channel efficiency is worth checking next.",
      score: 91
    });
  }

  if (strongestDimension && !hasRevenue) {
    candidates.push({
      question: `Which ${strongestDimension} is performing best overall?`,
      intent: "comparison",
      dimension: strongestDimension,
      metric: canonicalMetricLabel(facts.segments.strongestSegment?.metric) ?? "performance",
      reason: "When revenue is not the only clear signal, leadership should still ask which segment is strongest overall.",
      score: 80
    });
  }

  if (weakestDimension) {
    candidates.push({
      question: `Which ${weakestDimension} needs corrective action?`,
      intent: "action",
      dimension: weakestDimension,
      metric: canonicalMetricLabel(facts.segments.weakestSegment?.metric) ?? "performance",
      reason: "A weak segment is visible, so the next question should focus on correction rather than more exploration.",
      score: 78
    });
  }

  if (hasRevenue && hasSpend && topRevenueDimension) {
    candidates.push({
      question: `Which ${topRevenueDimension} should receive more budget?`,
      intent: "efficiency",
      dimension: topRevenueDimension,
      metric: "ROAS",
      reason: "Revenue and spend exist together, so allocation questions are actionable and commercially useful.",
      score: 90
    });
  }

  if (!candidates.length) {
    candidates.push({
      question: "Which segment is driving the strongest performance?",
      intent: "comparison",
      dimension: "segment",
      metric: "performance",
      reason: "No strong semantic signal was available, so the safest fallback is a broad segment comparison.",
      score: 10
    });
  }

  return dedupeCandidates(candidates)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate) => candidate.question);
}
