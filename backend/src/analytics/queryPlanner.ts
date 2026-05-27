import type {
  ConversationTurnContext,
  DatasetProfile,
  PlannedQuery,
  QuestionContextInput
} from "./types.js";
import { KPI_ALIASES } from "../utils/inference.js";
import {
  buildSemanticDatasetContract,
  resolveCanonicalMetricKey,
  resolveSemanticDimensionSourceColumn
} from "./semanticContract.js";
import { findExplicitDimensionMention, resolveExplicitDimensionSourceColumn } from "./dimensionResolution.js";
import {
  buildSemanticMetricList,
  detectSemanticBusinessIntent
} from "../services/analytics/intent/semanticBusinessIntent.js";

function normalize(text: string) {
  return text.toLowerCase().replace(/-/g, " ");
}

const METRIC_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "than",
  "that",
  "this",
  "rate",
  "ratio",
  "value",
  "total",
  "count",
  "amount",
  "metric",
  "score",
  "number",
  "data"
]);

const HIGH_SIGNAL_METRIC_TOKENS = new Set([
  "margin",
  "markdown",
  "fulfillment",
  "stockout",
  "backorder",
  "inventory",
  "turnover",
  "resolution",
  "response",
  "escalation",
  "reopen",
  "qualified",
  "missed"
]);

function normalizeMetricText(value: string) {
  return normalize(value)
    .replace(/_/g, " ")
    .replace(/\bpct\b/g, "percent")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMetricText(value: string) {
  return normalizeMetricText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter((token) => token.length >= 3 && !METRIC_TOKEN_STOPWORDS.has(token));
}

function questionAsksMetricRelationship(normalizedQuestion: string) {
  return /\b(without|while|versus|vs|relative to|compared to|imbalance|matching|support|disagree|rather than|keep up|out of balance)\b/.test(
    normalizedQuestion
  );
}

function genericMetricGroundingMatches(question: string, profile: DatasetProfile) {
  const normalizedQuestion = normalizeMetricText(question);
  const contract = getSemanticContract(profile);
  const questionTokens = new Set(tokenizeMetricText(question));
  const candidates = [...new Set([...contract.availableMetrics, ...profile.numericColumns])];

  return candidates
    .map((candidate) => {
      const canonical = resolveCanonicalMetricKey(contract, candidate);
      const normalizedCandidate = normalizeMetricText(candidate);
      const candidateTokens = tokenizeMetricText(candidate);
      const resolution = contract.metricResolutions[canonical];
      const shouldPreserveExplicitSourceColumn =
        profile.numericColumns.includes(candidate) &&
        normalizedCandidate &&
        normalizedQuestion.includes(normalizedCandidate) &&
        (!resolution || resolution.confidence < 0.8);

      let score = 0;
      if (normalizedCandidate && normalizedQuestion.includes(normalizedCandidate)) {
        score += 10;
      }

      const percentVariant = normalizedCandidate.replace(/\bpercent\b/g, "percentage");
      if (percentVariant !== normalizedCandidate && normalizedQuestion.includes(percentVariant)) {
        score += 8;
      }

      if (candidateTokens.length > 0 && candidateTokens.every((token) => questionTokens.has(token))) {
        score += 7;
      }

      const sharedTokens = candidateTokens.filter((token) => questionTokens.has(token));
      score += Math.min(4, sharedTokens.length * 1.2);
      if (sharedTokens.some((token) => HIGH_SIGNAL_METRIC_TOKENS.has(token))) {
        score += 6;
      }

      return {
        candidate,
        canonical: shouldPreserveExplicitSourceColumn ? candidate : canonical,
        score
      };
    })
    .filter((entry) => entry.score >= 7)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.canonical)
    .filter((metric, index, list) => list.indexOf(metric) === index);
}

function getSemanticContract(profile: DatasetProfile) {
  return profile.semanticContract ?? buildSemanticDatasetContract(profile);
}

function getSemanticAvailability(profile: DatasetProfile) {
  const contract = getSemanticContract(profile);
  return {
    availableMetrics: [...new Set([...profile.numericColumns, ...contract.availableMetrics])],
    availableDimensions: [...new Set([...profile.categoricalColumns, ...contract.availableDimensions])]
  };
}

function hasSemanticRole(profile: DatasetProfile, role: string) {
  return Boolean(
    getSemanticContract(profile).roleMappings?.some(
      (mapping) => mapping.semanticRole === role && mapping.confidence >= 0.5
    )
  );
}

function hasSemanticMetric(profile: DatasetProfile, metric: string) {
  return getSemanticContract(profile).availableMetrics.includes(metric);
}

function isCallRelatedDomain(profile: DatasetProfile) {
  const domain = getSemanticContract(profile).detectedDomain?.domain;
  return domain === "call_tracking" || domain === "call_operations" || domain === "mixed_call_tracking_attribution";
}

function buildUnavailableMetricReasons(question: string, profile: DatasetProfile) {
  const normalizedQuestion = normalize(question);
  const genericGroundedMetrics = genericMetricGroundingMatches(question, profile);
  const hasGroundedRevenueLikeMetric = genericGroundedMetrics.some((metric) =>
    /\brevenue\b|\bsale\b|\bbooked\b/.test(normalizeMetricText(metric))
  );
  const reasons: string[] = [];

  if (normalizedQuestion.includes("roas") && !hasSemanticMetric(profile, "roas")) {
    reasons.push("ROAS cannot be calculated because revenue and spend are both required.");
  }

  if ((normalizedQuestion.includes("qualified") || normalizedQuestion.includes("qualified call")) && !hasSemanticMetric(profile, "qualifiedCall")) {
    reasons.push("Qualified call metrics are not available because no qualified-call field was detected.");
  }

  if ((normalizedQuestion.includes("conversion") || normalizedQuestion.includes("converted") || normalizedQuestion.includes("booked")) &&
    !hasGroundedRevenueLikeMetric &&
    !hasSemanticRole(profile, "convertedCall")) {
    reasons.push("Conversion metrics are not available because no converted-call field was detected.");
  }

  if (normalizedQuestion.includes("revenue") && !hasGroundedRevenueLikeMetric && !hasSemanticRole(profile, "revenue")) {
    reasons.push("Revenue cannot be calculated because no revenue field was detected.");
  }

  if ((normalizedQuestion.includes("missed call") || normalizedQuestion.includes("missed call rate") || normalizedQuestion.includes("missed call pressure")) && !hasSemanticRole(profile, "missedCall")) {
    reasons.push("Missed call rate cannot be calculated because no missed-call field was detected.");
  }

  if ((normalizedQuestion.includes("answered call") || normalizedQuestion.includes("answered call rate") || normalizedQuestion.includes("answered call performance")) && !hasSemanticRole(profile, "answeredCall")) {
    reasons.push("Answered call rate cannot be calculated because no answered-call field was detected.");
  }

  if (
    (normalizedQuestion.includes("call duration") ||
      normalizedQuestion.includes("talk time") ||
      normalizedQuestion.includes("longest calls") ||
      normalizedQuestion.includes("shortest calls")) &&
    !hasSemanticRole(profile, "callDuration") &&
    !hasSemanticRole(profile, "talkTime") &&
    !hasSemanticRole(profile, "handleTime") &&
    !hasSemanticRole(profile, "waitTime") &&
    !hasSemanticRole(profile, "ringTime")
  ) {
    reasons.push("Call duration analysis is not available because no duration field was detected.");
  }

  if (
    (normalizedQuestion.includes("location") ||
      normalizedQuestion.includes("locations") ||
      normalizedQuestion.includes("branch") ||
      normalizedQuestion.includes("branches") ||
      normalizedQuestion.includes("office") ||
      normalizedQuestion.includes("offices") ||
      normalizedQuestion.includes("city") ||
      normalizedQuestion.includes("cities")) &&
    !hasSemanticRole(profile, "location")
  ) {
    reasons.push("Location analysis cannot be calculated because no location field was detected.");
  }

  if (
    (normalizedQuestion.includes("call volume") ||
      /\b(most|fewest|highest|lowest)\s+calls?\b/.test(normalizedQuestion)) &&
    !hasSemanticMetric(profile, "calls") &&
    !hasSemanticRole(profile, "callId") &&
    !isCallRelatedDomain(profile)
  ) {
    reasons.push("Call volume cannot be calculated because no call identifier field was detected.");
  }

  if ((normalizedQuestion.includes("cost per qualified call") || normalizedQuestion.includes("cpqc")) &&
    !hasSemanticMetric(profile, "cost_per_qualified_call")) {
    reasons.push("Cost per qualified call requires both spend and qualified-call fields.");
  }

  if ((normalizedQuestion.includes("cost per conversion") || normalizedQuestion.includes("cpa")) &&
    (!hasSemanticRole(profile, "spend") || !hasSemanticRole(profile, "convertedCall"))) {
    reasons.push("Cost per conversion requires both spend and converted-call fields.");
  }

  if (
    (normalizedQuestion.includes("spending") || normalizedQuestion.includes("spend") || normalizedQuestion.includes("budget")) &&
    !hasSemanticRole(profile, "spend")
  ) {
    reasons.push("Spending analysis cannot be calculated because no spend field was detected.");
  }

  if (
    (normalizedQuestion.includes("converting") || normalizedQuestion.includes("convert") || normalizedQuestion.includes("conversion")) &&
    !hasSemanticRole(profile, "convertedCall")
  ) {
    reasons.push("Conversion analysis cannot be calculated because no converted-call field was detected.");
  }

  if (
    normalizedQuestion.includes("low call volume") &&
    !hasSemanticRole(profile, "callId")
  ) {
    reasons.push("Call volume cannot be calculated because no call identifier field was detected.");
  }

  return [...new Set(reasons)];
}

function replaceToken(question: string, pattern: RegExp, replacement?: string | number) {
  if (replacement === undefined || replacement === null || replacement === "") {
    return question;
  }
  return question.replace(pattern, String(replacement));
}

function tokenizeForOverlap(text: string) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !["this", "that", "with", "from", "have", "about", "there", "their", "what", "when", "where", "which", "would", "could", "should", "chart", "question", "show", "explain", "please"].includes(token));
}

function isFollowUpQuestion(question: string) {
  const normalizedQuestion = normalize(question);
  return /(^|\b)(this|that|it|them|these|those|same|above|previous|prior|earlier|last|result|chart|question|why|how about|what about|explain|and then|what now)(\b|$)/i.test(
    normalizedQuestion
  );
}

function scoreConversationTurn(question: string, turn: ConversationTurnContext, profile: DatasetProfile) {
  const normalizedQuestion = normalize(question);
  const normalizedTurnQuestion = normalize(turn.question);
  const questionTokens = new Set(tokenizeForOverlap(question));
  const turnTokens = new Set(tokenizeForOverlap(turn.question));
  const sharedTokens = [...questionTokens].filter((token) => turnTokens.has(token));
  const semanticAvailability = getSemanticAvailability(profile);
  const questionSemantic = detectSemanticBusinessIntent(question, {
    ...semanticAvailability
  });
  const turnSemantic = detectSemanticBusinessIntent(turn.question, {
    ...semanticAvailability
  });

  let score = 0;
  if (isFollowUpQuestion(question)) {
    score += 4;
  }

  if (normalizedQuestion.length <= 25) {
    score += 1.5;
  }

  if (sharedTokens.length > 0) {
    score += Math.min(3, sharedTokens.length * 0.9);
  }

  if (questionSemantic.businessIntent !== "neutral" && questionSemantic.businessIntent === turnSemantic.businessIntent) {
    score += 1.8;
  }

  if (turn.detectedIntent) {
    const questionWantsRanking =
      normalizedQuestion.includes("best") ||
      normalizedQuestion.includes("top") ||
      normalizedQuestion.includes("winning") ||
      normalizedQuestion.includes("potential") ||
      normalizedQuestion.includes("efficient") ||
      normalizedQuestion.includes("scalable");
    if (questionWantsRanking && turn.detectedIntent.primaryIntent === "ranking") {
      score += 1.8;
    }

    if (
      (normalizedQuestion.includes("trend") || normalizedQuestion.includes("over time") || normalizedQuestion.includes("again")) &&
      turn.detectedIntent.primaryIntent === "trend_analysis"
    ) {
      score += 1.8;
    }

    if (
      (normalizedQuestion.includes("compare") || normalizedQuestion.includes("versus") || normalizedQuestion.includes("vs")) &&
      turn.detectedIntent.primaryIntent === "comparison"
    ) {
      score += 1.8;
    }
  }

  if (turn.chartSuggestion && (normalizedQuestion.includes("chart") || normalizedQuestion.includes("explain") || normalizedQuestion.includes("this") || normalizedQuestion.includes("that"))) {
    score += 1.6;
  }

  if (turn.answer.length > 0 && normalizedTurnQuestion.length > 0) {
    score += 0.2;
  }

  return score;
}

function selectConversationAnchor(
  question: string,
  history: ConversationTurnContext[] | undefined,
  profile: DatasetProfile
) {
  if (!history || history.length === 0) {
    return null;
  }

  const scored = history
    .map((turn, index) => ({
      turn,
      index,
      score: scoreConversationTurn(question, turn, profile)
    }))
    .sort((left, right) => right.score - left.score);

  const winner = scored[0];
  if (!winner || winner.score < 4.5) {
    return null;
  }

  return winner.turn;
}

function resolveDynamicContextReferences(question: string, input?: QuestionContextInput) {
  let resolvedQuestion = question;
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined date|selected date|chosen date)\b/gi,
    input?.selectedDate
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined threshold|selected threshold|chosen threshold)\b/gi,
    input?.selectedThreshold
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined metric|selected metric|chosen metric)\b/gi,
    input?.selectedMetric
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined dimension|selected dimension|chosen dimension)\b/gi,
    input?.selectedDimension
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined category|selected category|chosen category)\b/gi,
    input?.selectedCategory
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined segment a|selected segment a|chosen segment a)\b/gi,
    input?.selectedSegmentA
  );
  resolvedQuestion = replaceToken(
    resolvedQuestion,
    /\b(customer defined segment b|selected segment b|chosen segment b)\b/gi,
    input?.selectedSegmentB
  );
  return resolvedQuestion;
}

function isBinaryLikeCategoricalColumn(profile: DatasetProfile, columnName: string) {
  const column = profile.columns.find((entry) => entry.name === columnName);
  if (!column || column.kind !== "categorical") {
    return false;
  }

  return column.uniqueCount <= 2;
}

function isIdentifierLikeDimension(profile: DatasetProfile, columnName: string) {
  const column = profile.columns.find((entry) => entry.name === columnName);
  if (!column || column.kind !== "categorical") {
    return false;
  }

  const normalizedName = normalize(column.name);
  return (
    /\b(id|key|uuid|guid|session)\b/.test(normalizedName) ||
    (profile.rowCount > 20 && column.uniqueCount >= Math.min(profile.rowCount * 0.7, profile.rowCount - 1))
  );
}

function businessSegmentationDimensionScore(columnName: string) {
  const normalizedName = normalize(columnName).replace(/_/g, " ");
  if (/\b(queue|team|service|warehouse|product|sku|category|region|location|branch|supplier|vendor|channel|source|campaign|account|customer|client)\b/.test(normalizedName)) {
    return 4;
  }

  if (/\b(status|reason|flag|boolean|yes|no|true|false|answered|required|missed)\b/.test(normalizedName)) {
    return -3;
  }

  return 0;
}

function resolveMetrics(
  question: string,
  profile: DatasetProfile,
  conversationAnchor?: ConversationTurnContext | null
): string[] {
  const normalizedQuestion = normalize(question);
  const contract = getSemanticContract(profile);
  const matches: string[] = [];
  const asksQualifiedEfficiency =
    /\b(qualified calls?|qualified leads?|qualified efficiency|lead efficiency|sales qualified calls?)\b/.test(normalizedQuestion) &&
    /\b(efficient|efficiency|efficiently|best|lowest|highest|top)\b/.test(normalizedQuestion);
  const relationshipSeedMetrics: string[] = [];

  if (questionAsksMetricRelationship(normalizedQuestion)) {
    if (normalizedQuestion.includes("call volume") && contract.availableMetrics.includes("calls")) {
      relationshipSeedMetrics.push("calls");
    }
  }

  if (asksQualifiedEfficiency) {
    const qualifiedEfficiencyMetrics: string[] = [];
    if (contract.availableMetrics.includes("cost_per_qualified_call")) {
      qualifiedEfficiencyMetrics.push("cost_per_qualified_call");
    }
    if (contract.availableMetrics.includes("qualifiedCall") && contract.availableMetrics.includes("calls")) {
      qualifiedEfficiencyMetrics.push("qualified_call_rate");
    }
    if (contract.availableMetrics.includes("qualifiedCall")) {
      qualifiedEfficiencyMetrics.push("qualifiedCall");
    }
    if (qualifiedEfficiencyMetrics.length > 0) {
      return qualifiedEfficiencyMetrics;
    }
  }

  if (
    (normalizedQuestion.includes("longest calls") ||
      normalizedQuestion.includes("shortest calls") ||
      normalizedQuestion.includes("call duration") ||
      normalizedQuestion.includes("talk time")) &&
    (contract.availableMetrics.includes("callDuration") ||
      contract.availableMetrics.includes("talkTime") ||
      contract.availableMetrics.includes("handleTime") ||
      contract.availableMetrics.includes("waitTime") ||
      contract.availableMetrics.includes("ringTime"))
  ) {
    if (contract.availableMetrics.includes("callDuration")) {
      return ["callDuration"];
    }
    if (contract.availableMetrics.includes("talkTime")) {
      return ["talkTime"];
    }
    if (contract.availableMetrics.includes("handleTime")) {
      return ["handleTime"];
    }
    if (contract.availableMetrics.includes("waitTime")) {
      return ["waitTime"];
    }
    return ["ringTime"];
  }

  if (
    (normalizedQuestion.includes("repeat caller rate") ||
      normalizedQuestion.includes("highest repeat caller") ||
      normalizedQuestion.includes("repeat callers")) &&
    contract.availableMetrics.includes("repeat_caller_rate")
  ) {
    return ["repeat_caller_rate"];
  }

  if (
    (normalizedQuestion.includes("cost per qualified call") || normalizedQuestion.includes("cpqc")) &&
    contract.availableMetrics.includes("cost_per_qualified_call")
  ) {
    return ["cost_per_qualified_call"];
  }

  if (
    (normalizedQuestion.includes("cost per conversion") || normalizedQuestion.includes("cpa")) &&
    contract.availableMetrics.includes("cost_per_conversion")
  ) {
    return ["cost_per_conversion"];
  }

  if (
    (normalizedQuestion.includes("qualified rate") ||
      normalizedQuestion.includes("qualified call rate") ||
      normalizedQuestion.includes("qualified-call rate")) &&
    contract.availableMetrics.includes("qualifiedCall") &&
    contract.availableMetrics.includes("calls")
  ) {
    return ["qualified_call_rate"];
  }

  if (
    (normalizedQuestion.includes("missed call rate") ||
      normalizedQuestion.includes("missed-call rate") ||
      normalizedQuestion.includes("missed call pressure")) &&
    contract.availableMetrics.includes("missedCall") &&
    contract.availableMetrics.includes("calls")
  ) {
    return ["missed_call_rate"];
  }

  if (
    (normalizedQuestion.includes("answered call rate") ||
      normalizedQuestion.includes("answered-call rate") ||
      normalizedQuestion.includes("answer rate")) &&
    contract.availableMetrics.includes("answeredCall") &&
    contract.availableMetrics.includes("calls")
  ) {
    return ["answered_call_rate"];
  }

  const genericGroundedMetrics = genericMetricGroundingMatches(question, profile);
  if (genericGroundedMetrics.length > 0) {
    return [...new Set([...relationshipSeedMetrics, ...genericGroundedMetrics])];
  }

  if (relationshipSeedMetrics.length > 0) {
    return [...new Set(relationshipSeedMetrics)];
  }

  for (const [metric, aliases] of Object.entries(KPI_ALIASES)) {
    const normalizedMetric = metric.replace(/_/g, " ");
    if (
      normalizedQuestion.includes(normalizedMetric) ||
      aliases.some((alias) => normalizedQuestion.includes(alias.replace(/_/g, " ")))
    ) {
      const canonical = contract.availableMetrics.includes(metric) ? metric : null;
      if (canonical) {
        matches.push(canonical);
        continue;
      }

      const matched = profile.numericColumns.find(
        (column) => column.includes(metric) || aliases.some((alias) => column.includes(alias))
      );
      if (matched) {
        matches.push(resolveCanonicalMetricKey(contract, matched));
      }
    }
  }

  if (matches.length === 0 && conversationAnchor?.detectedIntent?.targetMetrics?.length) {
    matches.push(
      ...conversationAnchor.detectedIntent.targetMetrics
        .map((metric) => resolveCanonicalMetricKey(contract, metric))
        .filter((metric) => contract.availableMetrics.includes(metric) || profile.numericColumns.includes(metric))
    );
  }

  return [...new Set(matches)];
}

function resolveDimension(
  question: string,
  profile: DatasetProfile,
  input?: QuestionContextInput,
  comparisonValues: string[] = [],
  semanticHints: string[] = [],
  conversationAnchor?: ConversationTurnContext | null
): string | null {
  const normalizedQuestion = normalize(question).replace(/_/g, " ");
  const normalizedSemanticHints = semanticHints.map((hint) => normalize(hint));
  const contract = getSemanticContract(profile);
  const explicitDimensionMention = findExplicitDimensionMention(question);

  const explicitQuestionDimension = resolveExplicitDimensionSourceColumn(question, {
    categoricalColumns: profile.categoricalColumns,
    datetimeColumns: profile.datetimeColumns,
    semanticContract: contract
  });
  if (explicitQuestionDimension) {
    return explicitQuestionDimension.sourceColumn;
  }
  if (explicitDimensionMention) {
    return null;
  }

  if (input?.selectedDimension) {
    const resolvedSelected = resolveSemanticDimensionSourceColumn(contract, input.selectedDimension) ?? input.selectedDimension;
    if (profile.categoricalColumns.includes(resolvedSelected)) {
      return resolvedSelected;
    }
  }

  const scoredDimensions = profile.columns
    .filter((column) => column.kind === "categorical")
    .map((column) => {
      let score = 0;
      const readableName = column.name.replace(/_/g, " ");

      if (normalizedQuestion.includes(readableName)) {
        score += 10;
      }

      if (normalizedSemanticHints.some((hint) => readableName.includes(hint) || hint.includes(readableName))) {
        score += 8;
      }

      const values = column.topCategories?.map((entry) => entry.value.toLowerCase()) ?? [];
      for (const comparisonValue of comparisonValues) {
        if (values.includes(comparisonValue.toLowerCase())) {
          score += 3;
        }
      }

      for (const category of column.topCategories ?? []) {
        if (normalizedQuestion.includes(category.value.toLowerCase())) {
          score += 1;
        }
      }

      score += businessSegmentationDimensionScore(column.name);

      if (isBinaryLikeCategoricalColumn(profile, column.name) && !normalizedQuestion.includes(readableName)) {
        score -= 4;
      }

      if (isIdentifierLikeDimension(profile, column.name) && !normalizedQuestion.includes(readableName)) {
        score -= 5;
      }

      return { name: column.name, score };
    })
    .sort((left, right) => right.score - left.score);

  if (scoredDimensions[0] && scoredDimensions[0].score > 0) {
    return scoredDimensions[0].name;
  }

  if (
    isFollowUpQuestion(question) &&
    conversationAnchor?.detectedIntent?.targetDimensions?.length &&
    conversationAnchor.detectedIntent.targetDimensions.some((dimension) => {
      const resolved = resolveSemanticDimensionSourceColumn(contract, dimension) ?? dimension;
      return profile.categoricalColumns.includes(resolved);
    })
  ) {
    return (
      conversationAnchor.detectedIntent.targetDimensions
        .map((dimension) => resolveSemanticDimensionSourceColumn(contract, dimension) ?? dimension)
        .find((dimension) => profile.categoricalColumns.includes(dimension)) ?? null
    );
  }

  const semanticDimensionMatch = semanticHints
    .map((hint) => resolveSemanticDimensionSourceColumn(contract, hint) ?? hint)
    .find((dimension) => profile.categoricalColumns.includes(dimension));
  if (semanticDimensionMatch) {
    return semanticDimensionMatch;
  }

  const preferred = ["channel", "source", "medium", "campaign", "device"];
  const preferredMatch = preferred
    .map((hint) => resolveSemanticDimensionSourceColumn(contract, hint) ?? hint)
    .find((column) => profile.categoricalColumns.includes(column));
  if (preferredMatch) {
    return preferredMatch;
  }

  const channelFamilyHint = ["channel", "source", "medium", "traffic source", "traffic_source", "source medium", "source_medium", "acquisition"]
    .find((hint) => profile.categoricalColumns.some((column) => normalize(column).includes(hint)));
  if (channelFamilyHint) {
    return profile.categoricalColumns.find((column) => normalize(column).includes(channelFamilyHint)) ?? null;
  }

  return scoredDimensions.find((entry) => entry.score >= 0)?.name ?? profile.categoricalColumns[0] ?? null;
}

function detectIntent(
  question: string,
  semanticProfile?: ReturnType<typeof detectSemanticBusinessIntent>,
  conversationAnchor?: ConversationTurnContext | null,
  hasExplicitMetrics = false,
  hasExplicitDimension = false
): PlannedQuery["intent"] {
  const normalizedQuestion = normalize(question);
  const hasByClause = normalizedQuestion.includes(" by ");
  const hasMultipleMetrics =
    normalizedQuestion.includes(" and ") &&
    (
      normalizedQuestion.includes("revenue") ||
      normalizedQuestion.includes("cost") ||
      normalizedQuestion.includes("conversion rate") ||
      normalizedQuestion.includes("roas") ||
      normalizedQuestion.includes("clicks") ||
      normalizedQuestion.includes("impressions")
    );
  if (
    normalizedQuestion.includes("compare") ||
    normalizedQuestion.includes("versus") ||
    normalizedQuestion.includes(" vs ")
  ) {
    if (normalizedQuestion.includes("trend") || normalizedQuestion.includes("over time")) {
      return "compare_trend";
    }
    return "compare_segments";
  }
  if ((normalizedQuestion.includes("trend") || normalizedQuestion.includes("over time")) && hasByClause) {
    return "dimension_trend";
  }
  if (
    hasByClause &&
    (
      normalizedQuestion.includes("average") ||
      normalizedQuestion.includes("avg") ||
      normalizedQuestion.includes("mean") ||
      normalizedQuestion.includes("sum") ||
      normalizedQuestion.includes("total") ||
      normalizedQuestion.includes("minimum") ||
      normalizedQuestion.includes("maximum") ||
      normalizedQuestion.includes("lowest") ||
      hasMultipleMetrics
    )
  ) {
    return "aggregate_segments";
  }
  if (normalizedQuestion.includes("trend") || normalizedQuestion.includes("over time")) {
    return "trend";
  }
  if (
    normalizedQuestion.includes("anomaly") ||
    normalizedQuestion.includes("anomalies") ||
    normalizedQuestion.includes("outlier") ||
    normalizedQuestion.includes("investigate") ||
    normalizedQuestion.includes("issue")
  ) {
    return "anomaly";
  }
  if (
    hasExplicitDimension &&
    (
      normalizedQuestion.includes("which") ||
      normalizedQuestion.includes("most") ||
      normalizedQuestion.includes("highest") ||
      normalizedQuestion.includes("top") ||
      normalizedQuestion.includes("best") ||
      normalizedQuestion.includes("largest") ||
      normalizedQuestion.includes("leading")
    )
  ) {
    return "top_segment";
  }
  if (
    normalizedQuestion.includes("best") ||
    normalizedQuestion.includes("top") ||
    normalizedQuestion.includes("highest") ||
    normalizedQuestion.includes("strongest") ||
    normalizedQuestion.includes("winner") ||
    normalizedQuestion.includes("winning") ||
    normalizedQuestion.includes("potential") ||
    normalizedQuestion.includes("scalable") ||
    normalizedQuestion.includes("efficient") ||
    normalizedQuestion.includes("underperforming") ||
    normalizedQuestion.includes("wasting budget") ||
    semanticProfile?.businessIntent !== "neutral"
  ) {
    return "top_segment";
  }

  if (
    isFollowUpQuestion(question) &&
    conversationAnchor?.detectedIntent &&
    (hasExplicitMetrics || hasExplicitDimension || conversationAnchor.detectedIntent.primaryIntent !== "general_overview")
  ) {
    const anchorIntent = conversationAnchor.detectedIntent.primaryIntent;
    if (anchorIntent === "general_overview") {
      return "summary";
    }
    if (anchorIntent === "trend_analysis") {
      return "trend";
    }
    if (anchorIntent === "comparison") {
      return "compare_segments";
    }
    if (anchorIntent === "ranking" || anchorIntent === "efficiency_analysis" || anchorIntent === "segmentation") {
      return "top_segment";
    }
    if (anchorIntent === "anomaly_detection") {
      return "anomaly";
    }
    if (anchorIntent === "funnel_analysis") {
      return "aggregate_segments";
    }
    return "summary";
  }

  return "summary";
}

function resolveAggregateOperation(
  question: string,
  metric: string | null,
  intent: PlannedQuery["intent"]
): PlannedQuery["aggregateOperation"] {
  const normalizedQuestion = normalize(question);
  const isRateMetric = metric?.includes("rate") ?? false;

  if (normalizedQuestion.includes("average") || normalizedQuestion.includes("avg") || normalizedQuestion.includes("mean")) {
    return "average";
  }

  if (normalizedQuestion.includes("sum") || normalizedQuestion.includes("total")) {
    return "sum";
  }

  if (normalizedQuestion.includes("minimum") || normalizedQuestion.includes("min")) {
    return "min";
  }

  if (normalizedQuestion.includes("maximum") || normalizedQuestion.includes("max")) {
    return "max";
  }

  if (normalizedQuestion.includes("lowest")) {
    return isRateMetric ? "average" : "min";
  }

  if (normalizedQuestion.includes("highest")) {
    return intent === "aggregate_segments" ? (isRateMetric ? "average" : "max") : "sum";
  }

  return "sum";
}

function resolveSortDirection(question: string): PlannedQuery["sortDirection"] {
  const normalizedQuestion = normalize(question);
  if (
    normalizedQuestion.includes("lowest") ||
    normalizedQuestion.includes("minimum") ||
    normalizedQuestion.includes("bottom")
  ) {
    return "asc";
  }

  return "desc";
}

function extractFilters(question: string, profile: DatasetProfile): PlannedQuery["filters"] {
  const normalizedQuestion = normalize(question);
  const filters: PlannedQuery["filters"] = [];

  for (const column of profile.categoricalColumns) {
    const profileEntry = profile.columns.find((entry) => entry.name === column);
    for (const category of profileEntry?.topCategories ?? []) {
      const normalizedCategory = category.value.toLowerCase().trim();
      if (normalizedCategory.length < 2) {
        continue;
      }

      const escapedCategory = normalizedCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const boundedPattern =
        /^[a-z0-9][a-z0-9 /_-]*[a-z0-9]$/i.test(normalizedCategory)
          ? new RegExp(`(^|[^a-z0-9])${escapedCategory}([^a-z0-9]|$)`, "i")
          : null;

      if ((boundedPattern && boundedPattern.test(normalizedQuestion)) || (!boundedPattern && normalizedQuestion.includes(normalizedCategory))) {
        filters.push({ column, operator: "eq", value: category.value });
      }
    }
  }

  return filters.filter(
    (filter, index, allFilters) =>
      allFilters.findIndex(
        (candidate) =>
          candidate.column === filter.column &&
          candidate.operator === filter.operator &&
          candidate.value === filter.value
      ) === index
  );
}

function extractNumericAndDateFilters(
  question: string,
  profile: DatasetProfile
): PlannedQuery["filters"] {
  const filters: PlannedQuery["filters"] = [];

  for (const column of profile.numericColumns) {
    const readable = column.replace(/_/g, "[ _]?");
    const patterns: Array<{ regex: RegExp; operator: PlannedQuery["filters"][number]["operator"] }> = [
      { regex: new RegExp(`${readable}\\s*(?:>|over|greater than|above)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "gt" },
      { regex: new RegExp(`${readable}\\s*(?:>=|at least|min(?:imum)? of)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "gte" },
      { regex: new RegExp(`${readable}\\s*(?:<|under|less than|below)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "lt" },
      { regex: new RegExp(`${readable}\\s*(?:<=|at most|max(?:imum)? of)\\s*\\$?(\\d+(?:\\.\\d+)?)`, "i"), operator: "lte" }
    ];

    for (const pattern of patterns) {
      const match = question.match(pattern.regex);
      if (match) {
        filters.push({
          column,
          operator: pattern.operator,
          value: Number(match[1])
        });
      }
    }
  }

  for (const column of profile.datetimeColumns) {
    const readable = column.replace(/_/g, "[ _]?");
    const afterMatch = question.match(new RegExp(`(?:${readable}\\s*)?(?:after|since)\\s*(\\d{4}-\\d{2}-\\d{2})`, "i"));
    const beforeMatch = question.match(new RegExp(`(?:${readable}\\s*)?(?:before|until)\\s*(\\d{4}-\\d{2}-\\d{2})`, "i"));

    if (afterMatch) {
      filters.push({
        column,
        operator: "after",
        value: afterMatch[1]
      });
    }

    if (beforeMatch) {
      filters.push({
        column,
        operator: "before",
        value: beforeMatch[1]
      });
    }
  }

  return filters;
}

function extractFiltersForDimension(
  question: string,
  profile: DatasetProfile,
  excludedColumn: string | null,
  excludedValues: string[]
): PlannedQuery["filters"] {
  const allFilters = [...extractFilters(question, profile), ...extractNumericAndDateFilters(question, profile)];

  return allFilters.filter(
    (filter) => {
      if (filter.operator !== "eq" || filter.column !== excludedColumn || typeof filter.value !== "string") {
        return true;
      }

      const filterValue = filter.value;
      return !excludedValues.some((value) => value.toLowerCase() === filterValue.toLowerCase());
    }
  );
}

function extractComparisonValues(question: string, profile: DatasetProfile): string[] {
  const normalizedQuestion = normalize(question);
  const valuesWithPosition: Array<{ value: string; position: number }> = [];

  for (const column of profile.categoricalColumns) {
    const profileEntry = profile.columns.find((entry) => entry.name === column);
    for (const category of profileEntry?.topCategories ?? []) {
      const value = category.value.toLowerCase();
      const position = normalizedQuestion.indexOf(value);
      if (position >= 0) {
        valuesWithPosition.push({ value: category.value, position });
      }
    }
  }

  return [...new Map(valuesWithPosition.sort((left, right) => left.position - right.position).map((entry) => [entry.value.toLowerCase(), entry.value])).values()].slice(0, 4);
}

function resolveLimit(question: string) {
  const match = normalize(question).match(/top\s+(\d+)/);
  return match ? Number(match[1]) : 5;
}

function extractDimensionTopValues(question: string, profile: DatasetProfile, dimension: string | null): string[] {
  if (!dimension) {
    return [];
  }

  const normalizedQuestion = normalize(question);
  const matchingColumn = profile.columns.find((column) => column.name === dimension);
  const values: Array<{ value: string; position: number }> = [];

  for (const category of matchingColumn?.topCategories ?? []) {
    const position = normalizedQuestion.indexOf(category.value.toLowerCase());
    if (position >= 0) {
      values.push({ value: category.value, position });
    }
  }

  return values
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.value);
}

export function planQuery(
  question: string,
  profile: DatasetProfile,
  input?: QuestionContextInput
): PlannedQuery {
  const semanticAvailability = getSemanticAvailability(profile);
  const resolvedQuestion = resolveDynamicContextReferences(question, input);
  const conversationAnchor = selectConversationAnchor(resolvedQuestion, input?.conversationHistory, profile);
  const semanticProfile = detectSemanticBusinessIntent(resolvedQuestion, {
    ...semanticAvailability
  });
  const explicitMetrics = resolveMetrics(resolvedQuestion, profile, conversationAnchor);
  const semanticMetrics = buildSemanticMetricList(semanticProfile, semanticAvailability.availableMetrics);
  const metrics = [...new Set([...explicitMetrics, ...semanticMetrics])];
  const metric = metrics[0] ?? null;
  const comparisonValues = extractComparisonValues(resolvedQuestion, profile);
  const dimension = resolveDimension(
    resolvedQuestion,
    profile,
    input,
    comparisonValues,
    semanticProfile.dimensionHints,
    conversationAnchor
  );
  const intent = detectIntent(
    resolvedQuestion,
    semanticProfile,
    conversationAnchor,
    explicitMetrics.length > 0,
    Boolean(dimension)
  );
  const dimensionTrendValues = extractDimensionTopValues(resolvedQuestion, profile, dimension);
  const standardFilters = [
    ...extractFilters(resolvedQuestion, profile),
    ...extractNumericAndDateFilters(resolvedQuestion, profile)
  ];

  const resolvedComparisonValues =
    intent === "dimension_trend" && dimensionTrendValues.length > 0
      ? dimensionTrendValues
      : comparisonValues;
  const unavailableMetricReasons = buildUnavailableMetricReasons(resolvedQuestion, profile);

  return {
    intent,
    metric,
    metrics,
    dimension,
    datetimeColumn: profile.datetimeColumns[0] ?? null,
    aggregateOperation: resolveAggregateOperation(resolvedQuestion, metric, intent),
    sortDirection: resolveSortDirection(resolvedQuestion),
    limit: resolveLimit(resolvedQuestion),
    filters:
      intent === "compare_segments" || intent === "compare_trend"
      ? extractFiltersForDimension(resolvedQuestion, profile, dimension, resolvedComparisonValues)
        : standardFilters,
    comparisonValues: resolvedComparisonValues,
    semanticProfile: semanticProfile.businessIntent === "neutral" ? undefined : semanticProfile,
    unavailableMetricReasons: unavailableMetricReasons.length > 0 ? unavailableMetricReasons : undefined,
    explicitMetrics: explicitMetrics.length > 0 ? explicitMetrics : undefined,
    semanticMetrics: semanticMetrics.length > 0 ? semanticMetrics : undefined
  };
}
