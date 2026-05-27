import { executePlannedQuery } from "./queryEngine.js";
import { planQuery } from "./queryPlanner.js";
import type {
  IntentDetectionResult,
  PlannedQuery,
  PrimitiveValue,
  QuestionAnswer,
  QuestionContextInput,
  TrustedQuestionFacts,
  GroundingStatus,
  DatasetProfile,
  DatasetRow
} from "./types.js";
import { buildSemanticDatasetContract } from "./semanticContract.js";

interface TrustedQuestionFactsContext {
  rows: DatasetRow[];
  profile: DatasetProfile;
  input?: QuestionContextInput;
}

export interface TrustedQuestionFactsBuildResult {
  facts: TrustedQuestionFacts;
  plan: PlannedQuery;
  queryAnswer: QuestionAnswer;
  detectedIntent: IntentDetectionResult;
}

function humanizeMetric(metric: string | null | undefined) {
  if (!metric) {
    return "the requested metric";
  }

  return metric
    .replace(/_/g, " ")
    .replace(/\bpct\b/gi, "percent")
    .trim();
}

function normalizeMetricText(value: string) {
  return value
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .replace(/\bpct\b/g, "percent")
    .replace(/\s+/g, " ")
    .trim();
}

function detectTrustRouting(question: string) {
  const normalizedQuestion = normalizeMetricText(question);
  const reasons: string[] = [];

  if (
    /\breliab/i.test(normalizedQuestion) ||
    /\btrust(ed|worthy|worthiness)?\b/i.test(normalizedQuestion) ||
    normalizedQuestion.includes("trust limitation")
  ) {
    reasons.push("reliability");
  }
  if (normalizedQuestion.includes("caveat") || normalizedQuestion.includes("limitation")) {
    reasons.push("caveat");
  }
  if (normalizedQuestion.includes("confidence") || normalizedQuestion.includes("cleanly") || normalizedQuestion.includes("enough data")) {
    reasons.push("confidence");
  }
  if (normalizedQuestion.includes("coverage") || normalizedQuestion.includes("covered") || normalizedQuestion.includes("partial")) {
    reasons.push("coverage");
  }
  if (normalizedQuestion.includes("can we answer anything trustworthy") || normalizedQuestion.includes("can we reliably compare")) {
    reasons.push("trustworthiness");
  }

  return {
    mode: reasons.length > 0 ? "trust" as const : "standard" as const,
    reasons: [...new Set(reasons)]
  };
}

function determineAnsweredMetric(plan: PlannedQuery, answer: QuestionAnswer) {
  if (answer.chartSuggestion?.yKey && answer.chartSuggestion.yKey !== "semantic_score") {
    return answer.chartSuggestion.yKey;
  }

  return plan.metric;
}

function questionRequiresMultipleMetrics(question: string, requestedMetrics: string[]) {
  const normalizedQuestion = normalizeMetricText(question);
  return requestedMetrics.length > 1 && (
    normalizedQuestion.includes(" and ") ||
    normalizedQuestion.includes(" versus ") ||
    normalizedQuestion.includes(" vs ") ||
    normalizedQuestion.includes(" while ") ||
    normalizedQuestion.includes(" rather than ") ||
    normalizedQuestion.includes(" without ") ||
    normalizedQuestion.includes(" relative to ") ||
    normalizedQuestion.includes(" compared to ")
  );
}

function isMetricAvailable(metric: string, profile: DatasetProfile) {
  const contract = profile.semanticContract ?? buildSemanticDatasetContract(profile);
  if (metric === "qualified_call_rate") {
    return contract.availableMetrics.includes("qualifiedCall") && contract.availableMetrics.includes("calls");
  }
  if (metric === "missed_call_rate") {
    return contract.availableMetrics.includes("missedCall") && contract.availableMetrics.includes("calls");
  }
  if (metric === "answered_call_rate") {
    return contract.availableMetrics.includes("answeredCall") && contract.availableMetrics.includes("calls");
  }

  return Boolean(
    contract.availableMetrics.includes(metric) ||
    contract.derivedMetrics.includes(metric) ||
    contract.metricResolutions[metric] ||
    profile.numericColumns.includes(metric)
  );
}

function metricConfidence(metric: string, profile: DatasetProfile) {
  const contract = profile.semanticContract ?? buildSemanticDatasetContract(profile);
  if (
    (metric === "qualified_call_rate" && contract.availableMetrics.includes("qualifiedCall") && contract.availableMetrics.includes("calls")) ||
    (metric === "missed_call_rate" && contract.availableMetrics.includes("missedCall") && contract.availableMetrics.includes("calls")) ||
    (metric === "answered_call_rate" && contract.availableMetrics.includes("answeredCall") && contract.availableMetrics.includes("calls"))
  ) {
    return 0.78;
  }

  const resolution = contract.metricResolutions[metric];
  if (resolution?.confidence !== undefined) {
    return resolution.confidence;
  }

  return profile.numericColumns.includes(metric) ? 0.68 : 0;
}

function isBinaryLikeDimension(dimension: string | null | undefined, profile: DatasetProfile) {
  if (!dimension) {
    return false;
  }

  const column = profile.columns.find((entry) => entry.name === dimension);
  return Boolean(column && column.kind === "categorical" && column.uniqueCount <= 2);
}

function isIdentifierLikeDimension(dimension: string | null | undefined, profile: DatasetProfile) {
  if (!dimension) {
    return false;
  }

  const column = profile.columns.find((entry) => entry.name === dimension);
  if (!column || column.kind !== "categorical") {
    return false;
  }

  const normalizedName = normalizeMetricText(column.name);
  return (
    /\b(id|key|uuid|guid|session)\b/.test(normalizedName) ||
    (profile.rowCount > 20 && column.uniqueCount >= Math.min(profile.rowCount * 0.7, profile.rowCount - 1))
  );
}

function extractRequestedDimensionLabels(question: string) {
  const normalizedQuestion = normalizeMetricText(question);
  const dimensions: string[] = [];
  const specs: Array<{ label: string; pattern: RegExp }> = [
    { label: "queue", pattern: /\bqueues?\b/ },
    { label: "team", pattern: /\bteams?\b/ },
    { label: "service line", pattern: /\bservice lines?\b|\bservices?\b/ },
    { label: "warehouse", pattern: /\bwarehouses?\b/ },
    { label: "product", pattern: /\bproducts?\b|\bskus?\b/ },
    { label: "category", pattern: /\bcategories?\b/ },
    { label: "region", pattern: /\bregions?\b/ },
    { label: "location", pattern: /\blocations?\b|\bbranches?\b|\boffices?\b|\bcities\b/ },
    { label: "supplier", pattern: /\bsuppliers?\b|\bvendors?\b/ },
    { label: "channel", pattern: /\bchannels?\b|\bsources?\b|\bmedium\b/ },
    { label: "campaign", pattern: /\bcampaigns?\b/ },
    { label: "account", pattern: /\baccounts?\b/ },
    { label: "customer", pattern: /\bcustomers?\b/ },
    { label: "client", pattern: /\bclients?\b/ }
  ];

  for (const spec of specs) {
    if (spec.pattern.test(normalizedQuestion)) {
      dimensions.push(spec.label);
    }
  }

  return [...new Set(dimensions)];
}

function dimensionMatchesRequest(dimension: string | null | undefined, requestedDimension: string) {
  if (!dimension) {
    return false;
  }

  const normalizedDimension = normalizeMetricText(dimension);
  const normalizedRequested = normalizeMetricText(requestedDimension);
  if (
    normalizedRequested === "channel" &&
    /\b(channel|source|medium|traffic|acquisition)\b/.test(normalizedDimension)
  ) {
    return true;
  }

  return normalizedDimension.includes(normalizedRequested) || normalizedRequested.includes(normalizedDimension);
}

function detectRelationshipType(question: string): NonNullable<TrustedQuestionFacts["groundingConfidence"]["relationshipGrounding"]["relationshipType"]> {
  const normalizedQuestion = normalizeMetricText(question);
  if (/\bwithout matching\b|\bwithout improvement\b|\bwithout better\b|\bwithout .* support\b|\bfail(?:s|ed)? to keep up\b|\bkeep up with\b|\bbut weak\b|\bbut not\b/.test(normalizedQuestion)) {
    return "without_matching";
  }
  if (/\bwhile\b/.test(normalizedQuestion)) {
    return "while";
  }
  if (/\brelative to\b|\bper\b/.test(normalizedQuestion)) {
    return "relative_to";
  }
  if (/\bversus\b|\bvs\b|\bcompare\b|\bdisagree\b|\bimbalance\b|\brelationship\b|\brather than\b/.test(normalizedQuestion)) {
    return "metric_vs_metric";
  }
  if (/\brising\b|\bincreasing\b|\bdrop\b|\bdropping\b|\btrend shift\b|\bmovement\b/.test(normalizedQuestion)) {
    return "trend_shift";
  }
  if (/\bconcentrated\b|\bconcentration\b|\btoo concentrated\b/.test(normalizedQuestion)) {
    return "concentration";
  }
  return "single_metric";
}

function combineGroundingStatuses(statuses: GroundingStatus[]) {
  if (statuses.includes("unsupported")) {
    return "unsupported" as const;
  }
  if (statuses.includes("weak")) {
    return "weak" as const;
  }
  if (statuses.includes("partial")) {
    return "partial" as const;
  }
  return "strong" as const;
}

function buildGroundingConfidence(
  question: string,
  plan: PlannedQuery,
  profile: DatasetProfile,
  answer: QuestionAnswer,
  semanticAlignment: TrustedQuestionFacts["semanticAlignment"]
): TrustedQuestionFacts["groundingConfidence"] {
  const requestedMetrics = [...semanticAlignment.requestedMetrics];
  const groundedMetrics = requestedMetrics.filter((metric) => isMetricAvailable(metric, profile));
  const missingMetrics = requestedMetrics.filter((metric) => !isMetricAvailable(metric, profile));
  const weakMetrics = groundedMetrics.filter((metric) => metricConfidence(metric, profile) < 0.55);
  const metricReasons: string[] = [];

  if (plan.unavailableMetricReasons?.length) {
    metricReasons.push(...plan.unavailableMetricReasons);
  }
  if (requestedMetrics.length === 0 && plan.metric) {
    metricReasons.push(`The answer uses ${humanizeMetric(plan.metric)} as an inferred metric because the question did not name a specific metric.`);
  }
  if (groundedMetrics.length > 0) {
    metricReasons.push(`Grounded metric(s): ${groundedMetrics.map(humanizeMetric).join(", ")}.`);
  }
  if (missingMetrics.length > 0) {
    metricReasons.push(`Missing metric(s): ${missingMetrics.map(humanizeMetric).join(", ")}.`);
  }
  if (weakMetrics.length > 0) {
    metricReasons.push(`Weakly grounded metric(s): ${weakMetrics.map(humanizeMetric).join(", ")}.`);
  }

  const metricStatus: GroundingStatus =
    plan.unavailableMetricReasons?.length || (requestedMetrics.length > 0 && groundedMetrics.length === 0)
      ? "unsupported"
      : requestedMetrics.length === 0
        ? (plan.metric ? "partial" : "weak")
        : missingMetrics.length > 0
          ? (groundedMetrics.length > 0 ? "partial" : "unsupported")
          : weakMetrics.length > 0
            ? "weak"
            : semanticAlignment.status === "strong"
              ? "strong"
              : semanticAlignment.status === "partial"
                ? "partial"
                : semanticAlignment.status === "weak"
                  ? "weak"
                  : "unsupported";

  const requestedDimensionLabels = extractRequestedDimensionLabels(question);
  const groundedDimensions = plan.dimension ? [plan.dimension] : [];
  const weakDimensions: string[] = [];
  const missingDimensions: string[] = [];
  const dimensionReasons: string[] = [];

  if (requestedDimensionLabels.length > 0) {
    const unmatched = requestedDimensionLabels.filter((dimension) => !dimensionMatchesRequest(plan.dimension, dimension));
    missingDimensions.push(...unmatched);
    if (plan.dimension && unmatched.length === 0) {
      dimensionReasons.push(`The requested segment is grounded as ${plan.dimension}.`);
    }
    if (unmatched.length > 0) {
      dimensionReasons.push(`The requested segment ${unmatched.join(", ")} was not cleanly grounded.`);
    }
  } else if (plan.dimension) {
    dimensionReasons.push(`The answer uses ${plan.dimension} as the inferred segment dimension.`);
  }

  if (isBinaryLikeDimension(plan.dimension, profile) && !normalizeMetricText(question).includes(normalizeMetricText(plan.dimension ?? ""))) {
    weakDimensions.push(plan.dimension as string);
    dimensionReasons.push(`${plan.dimension} is a binary/proxy field, so it is weak for segment ranking unless explicitly requested.`);
  }

  if (isIdentifierLikeDimension(plan.dimension, profile) && !normalizeMetricText(question).includes(normalizeMetricText(plan.dimension ?? ""))) {
    weakDimensions.push(plan.dimension as string);
    dimensionReasons.push(`${plan.dimension} looks identifier-like, so it is weak for business segmentation.`);
  }

  const dimensionRequired =
    plan.intent === "top_segment" ||
    plan.intent === "aggregate_segments" ||
    plan.intent === "compare_segments" ||
    requestedDimensionLabels.length > 0;
  const dimensionStatus: GroundingStatus =
    dimensionRequired && !plan.dimension
      ? "unsupported"
      : !dimensionRequired && !plan.dimension
        ? "strong"
      : missingDimensions.length > 0
        ? "weak"
        : weakDimensions.length > 0
          ? "weak"
          : plan.dimension
            ? "strong"
            : "partial";

  const relationshipType = detectRelationshipType(question);
  const relationshipRequiresMultipleMetrics =
    relationshipType === "metric_vs_metric" ||
    relationshipType === "while" ||
    relationshipType === "without_matching" ||
    relationshipType === "relative_to";
  const requiredMetrics = relationshipRequiresMultipleMetrics ? requestedMetrics : requestedMetrics.slice(0, 1);
  const supportedMetrics = requiredMetrics.filter((metric) => !missingMetrics.includes(metric));
  const unsupportedMetrics = requiredMetrics.filter((metric) => missingMetrics.includes(metric));
  const relationshipReasons: string[] = [];

  if (relationshipRequiresMultipleMetrics && requiredMetrics.length < 2) {
    relationshipReasons.push("The question asks for a relationship, but only one side of the relationship was grounded.");
  }
  if (relationshipRequiresMultipleMetrics && unsupportedMetrics.length > 0) {
    relationshipReasons.push(`The relationship is missing ${unsupportedMetrics.map(humanizeMetric).join(", ")}.`);
  }
  if (relationshipRequiresMultipleMetrics && requiredMetrics.length >= 2 && unsupportedMetrics.length === 0) {
    relationshipReasons.push("Both sides of the relationship are grounded, but the current Ask path should treat the result as directional unless it computes the relationship directly.");
  }

  const relationshipStatus: GroundingStatus =
    relationshipRequiresMultipleMetrics
      ? requiredMetrics.length < 2
        ? "weak"
        : unsupportedMetrics.length === requiredMetrics.length
          ? "unsupported"
          : unsupportedMetrics.length > 0
            ? "partial"
            : "partial"
      : relationshipType === "concentration" && metricStatus !== "unsupported" && dimensionStatus !== "unsupported"
        ? "strong"
        : "strong";

  const contract = profile.semanticContract ?? buildSemanticDatasetContract(profile);
  const coverageWarnings = [...(answer.missingFieldWarnings ?? []), ...(plan.unavailableMetricReasons ?? [])];
  const reliabilityMetricScope = requestedMetrics.length > 0
    ? requestedMetrics
    : plan.metric
      ? [plan.metric]
      : [];
  const ratioWarnings = reliabilityMetricScope
    .filter((metric) => /rate|ratio|roas|cost_per|per_/.test(metric))
    .map((metric) => `${humanizeMetric(metric)} is a ratio or efficiency metric and should be read with denominator coverage in mind.`);
  const semanticWarnings = groundedMetrics
    .map((metric) => contract.metricResolutions[metric])
    .filter((resolution) => resolution && resolution.confidence < 0.8)
    .map((resolution) => `${humanizeMetric(resolution?.key)} has semantic confidence ${resolution?.confidence}.`);
  const reliabilityReasons = [...coverageWarnings, ...ratioWarnings, ...semanticWarnings];
  const reliabilityStatus: GroundingStatus =
    coverageWarnings.length > 0
      ? "weak"
      : semanticWarnings.length > 0 || ratioWarnings.length > 0
        ? "partial"
        : "strong";

  const overall = combineGroundingStatuses([
    metricStatus,
    dimensionStatus,
    relationshipStatus,
    reliabilityStatus
  ]);

  return {
    overall,
    metricGrounding: {
      status: metricStatus,
      requestedMetrics,
      groundedMetrics,
      missingMetrics,
      weakMetrics,
      reasons: metricReasons
    },
    dimensionGrounding: {
      status: dimensionStatus,
      requestedDimensions: requestedDimensionLabels,
      groundedDimensions,
      missingDimensions,
      weakDimensions: [...new Set(weakDimensions)],
      reasons: dimensionReasons
    },
    relationshipGrounding: {
      status: relationshipStatus,
      relationshipType,
      requiredMetrics,
      supportedMetrics,
      unsupportedMetrics,
      reasons: relationshipReasons
    },
    reliabilityGrounding: {
      status: reliabilityStatus,
      coverageWarnings,
      ratioWarnings,
      semanticWarnings,
      reasons: reliabilityReasons
    }
  };
}

function buildSemanticAlignment(question: string, plan: PlannedQuery, answeredMetric: string | null | undefined): TrustedQuestionFacts["semanticAlignment"] {
  const requestedMetrics = plan.explicitMetrics?.length
    ? [...plan.explicitMetrics]
    : plan.metrics.length > 0
      ? [...plan.metrics]
      : [];
  const normalizedAnsweredMetric = answeredMetric ? normalizeMetricText(answeredMetric) : null;
  const requestedMatches = requestedMetrics.filter((metric) => normalizeMetricText(metric) === normalizedAnsweredMetric);
  const multiMetricQuestion = questionRequiresMultipleMetrics(question, requestedMetrics);

  if (!answeredMetric) {
    return {
      requestedMetrics,
      answeredMetric: answeredMetric ?? null,
      status: requestedMetrics.length > 0 ? "none" : "weak",
      reason:
        requestedMetrics.length > 0
          ? `The question asks about ${requestedMetrics.map(humanizeMetric).join(", ")}, but the current Ask result did not ground a matching answer metric.`
          : "The question did not resolve to a specific grounded metric."
    };
  }

  if (requestedMetrics.length === 0) {
    return {
      requestedMetrics,
      answeredMetric,
      status: plan.semanticMetrics?.includes(answeredMetric) ? "partial" : "weak",
      reason:
        plan.semanticMetrics?.includes(answeredMetric)
          ? `The answer uses ${humanizeMetric(answeredMetric)} as the strongest available semantic signal, but the question did not ground an explicit metric.`
          : `The answer uses ${humanizeMetric(answeredMetric)}, but the question did not ground a specific matching metric.`
    };
  }

  if (requestedMatches.length > 0 && !multiMetricQuestion && requestedMetrics.length === 1) {
    return {
      requestedMetrics,
      answeredMetric,
      status: "strong",
      reason: `The answer stays grounded on the requested metric ${humanizeMetric(answeredMetric)}.`
    };
  }

  if (requestedMatches.length > 0 && (multiMetricQuestion || requestedMetrics.length > 1)) {
    return {
      requestedMetrics,
      answeredMetric,
      status: "partial",
      reason: `The answer grounded ${humanizeMetric(answeredMetric)}, but the question asks for a relationship across multiple metrics.`
    };
  }

  if (plan.semanticMetrics?.includes(answeredMetric)) {
    return {
      requestedMetrics,
      answeredMetric,
      status: "weak",
      reason: `The answer drifted to ${humanizeMetric(answeredMetric)} even though the question explicitly asked about ${requestedMetrics.map(humanizeMetric).join(", ")}.`
    };
  }

  return {
    requestedMetrics,
    answeredMetric,
    status: "none",
    reason: `The answer metric ${humanizeMetric(answeredMetric)} does not match the requested metric ${requestedMetrics.map(humanizeMetric).join(", ")}.`
  };
}

function mapPlanIntentToAnswerMode(intent: PlannedQuery["intent"]): TrustedQuestionFacts["answer"]["mode"] {
  switch (intent) {
    case "top_segment":
    case "aggregate_segments":
      return "ranking";
    case "trend":
    case "dimension_trend":
    case "compare_trend":
      return "trend";
    case "compare_segments":
      return "comparison";
    case "anomaly":
      return "anomaly";
    default:
      return "summary";
  }
}

function buildDetectedIntent(
  plan: PlannedQuery,
  status: TrustedQuestionFacts["answerability"]["status"]
): IntentDetectionResult {
  const primaryIntent: IntentDetectionResult["primaryIntent"] =
    plan.intent === "trend" || plan.intent === "dimension_trend" || plan.intent === "compare_trend"
      ? "trend_analysis"
      : plan.intent === "compare_segments"
        ? "comparison"
        : plan.intent === "anomaly"
          ? "anomaly_detection"
          : plan.intent === "top_segment" || plan.intent === "aggregate_segments"
            ? "ranking"
            : "general_overview";

  return {
    primaryIntent,
    secondaryIntents: [],
    targetMetrics: [...plan.metrics],
    targetDimensions: plan.dimension ? [plan.dimension] : [],
    explicitDimensionMention: null,
    timeRequired: primaryIntent === "trend_analysis",
    comparisonRequired: primaryIntent === "comparison",
    anomalyRequired: primaryIntent === "anomaly_detection",
    confidence: status === "answerable" ? 0.9 : status === "weak" ? 0.62 : 0.4,
    matchedKeywords: []
  };
}

function detectWeakAnswer(answer: QuestionAnswer) {
  const interpretation = String(answer.interpretation ?? "").toLowerCase();
  const directAnswer = answer.answer.toLowerCase();

  if (interpretation.includes("fallback")) {
    return true;
  }

  return (
    directAnswer.includes("high-level business read only") ||
    directAnswer.includes("not enough time-series data") ||
    directAnswer.includes("no grouped aggregate could be computed") ||
    directAnswer.includes("no segment-level result could be computed") ||
    directAnswer.includes("requires both a metric and a categorical dimension") ||
    directAnswer.includes("requires both a datetime column and a numeric metric")
  );
}

function buildTrustExplanation(
  question: string,
  plan: PlannedQuery,
  profile: DatasetProfile,
  answeredMetric: string | null | undefined,
  semanticAlignment: TrustedQuestionFacts["semanticAlignment"],
  groundingConfidence?: TrustedQuestionFacts["groundingConfidence"]
) {
  const contract = profile.semanticContract ?? buildSemanticDatasetContract(profile);
  const requestedMetric = semanticAlignment.requestedMetrics[0] ?? answeredMetric ?? plan.metric;
  const resolution = requestedMetric ? contract.metricResolutions[requestedMetric] : undefined;
  const dimension = plan.dimension;

  if (plan.unavailableMetricReasons?.length) {
    return {
      status: "unsupported" as const,
      directAnswer: plan.unavailableMetricReasons[0],
      reasons: [...plan.unavailableMetricReasons],
      caution: plan.unavailableMetricReasons[0]
    };
  }

  if (semanticAlignment.status === "none" || semanticAlignment.status === "weak") {
    return {
      status: "weak" as const,
      directAnswer: `I cannot answer that reliably because the question is grounded on ${semanticAlignment.requestedMetrics.map(humanizeMetric).join(", ") || "a metric the dataset did not ground"}, but the current Ask path would switch to ${humanizeMetric(answeredMetric ?? plan.metric)}.`,
      reasons: [semanticAlignment.reason],
      caution: semanticAlignment.reason
    };
  }

  if (!requestedMetric) {
    const reliabilityReasons = groundingConfidence?.reliabilityGrounding.reasons ?? [];
    if (reliabilityReasons.length > 0) {
      return {
        status: "weak" as const,
        directAnswer: `I can explain the main trust limits, but not for one specific metric: ${reliabilityReasons.slice(0, 2).join(" ")}`,
        reasons: reliabilityReasons,
        caution: reliabilityReasons[0]
      };
    }

    return {
      status: "weak" as const,
      directAnswer: "I cannot give a reliable trust assessment because the question does not anchor to a specific metric.",
      reasons: ["No explicit metric was grounded for this trust question."],
      caution: "Trust questions need an explicitly grounded metric to avoid answering a different question."
    };
  }

  const caveats: string[] = [];
  if (resolution?.resolution === "derived" || resolution?.aggregation === "ratio") {
    caveats.push(`${humanizeMetric(requestedMetric)} is derived rather than directly observed.`);
  }
  if (typeof resolution?.confidence === "number" && resolution.confidence < 0.8) {
    caveats.push(`${humanizeMetric(requestedMetric)} is only weakly grounded from the current schema.`);
  }
  if (!resolution) {
    caveats.push(`${humanizeMetric(requestedMetric)} is coming from a generic numeric field rather than a stabilized semantic metric.`);
  }
  if (dimension && !profile.categoricalColumns.includes(dimension)) {
    caveats.push(`The requested comparison dimension ${dimension} was not cleanly grounded.`);
  }

  const metricSentence = dimension
    ? `${humanizeMetric(requestedMetric)} can be compared across ${dimension} at a basic level`
    : `${humanizeMetric(requestedMetric)} can be assessed at a basic level`;
  const answer =
    caveats.length > 0
      ? `${metricSentence}, but ${caveats.join(" ")}`
      : `${metricSentence} because the dataset contains a directly grounded metric for it.`;

  return {
    status: "answerable" as const,
    directAnswer: answer,
    reasons: caveats.length > 0 ? caveats : [`${humanizeMetric(requestedMetric)} is directly grounded in the current dataset.`],
    caution: caveats[0]
  };
}

function firstReason(...groups: string[][]) {
  return groups.flat().find((reason) => reason.trim().length > 0);
}

function buildGroundingLimitedAnswer(
  groundingConfidence: TrustedQuestionFacts["groundingConfidence"],
  plan: PlannedQuery,
  fallbackAnswer: QuestionAnswer
) {
  const parts: string[] = [];
  const metric = groundingConfidence.metricGrounding;
  const dimension = groundingConfidence.dimensionGrounding;
  const relationship = groundingConfidence.relationshipGrounding;
  const reliability = groundingConfidence.reliabilityGrounding;

  if (groundingConfidence.overall === "unsupported") {
    return firstReason(metric.reasons, relationship.reasons, dimension.reasons, reliability.reasons) ??
      "The current dataset does not ground the metric or dimension needed to answer this question reliably.";
  }

  if (/high-level business read only/i.test(fallbackAnswer.answer)) {
    parts.push(fallbackAnswer.answer);
  }

  if (metric.groundedMetrics.length > 0) {
    parts.push(`I can ground ${metric.groundedMetrics.map(humanizeMetric).join(", ")}.`);
  }

  if (dimension.groundedDimensions.length > 0 && dimension.status !== "weak") {
    parts.push(`The segment dimension is grounded as ${dimension.groundedDimensions.join(", ")}.`);
  }

  if (metric.missingMetrics.length > 0 || metric.weakMetrics.length > 0) {
    const missingOrWeak = [...metric.missingMetrics, ...metric.weakMetrics];
    parts.push(`I cannot treat ${missingOrWeak.map(humanizeMetric).join(", ")} as fully reliable from this schema.`);
  }

  if (dimension.missingDimensions.length > 0 || dimension.weakDimensions.length > 0) {
    const weakDims = [...dimension.missingDimensions, ...dimension.weakDimensions];
    parts.push(`I should not rank by ${weakDims.join(", ")} because that dimension is missing or only weakly grounded.`);
  }

  if (relationship.status !== "strong" && relationship.relationshipType && relationship.relationshipType !== "single_metric") {
    parts.push("The full relationship across multiple metrics is only partially grounded, so a winner/ranking would overstate the data.");
  }

  if (reliability.reasons.length > 0) {
    parts.push(`Reliability caveat: ${reliability.reasons[0]}`);
  }

  if (parts.length === 0) {
    parts.push(fallbackAnswer.answer);
  }

  const safeNextCheck =
    metric.groundedMetrics[0] && dimension.groundedDimensions[0]
      ? `A safer next check is to ask about ${humanizeMetric(metric.groundedMetrics[0])} by ${dimension.groundedDimensions[0]}.`
      : "A safer next check is to ask for a single explicitly named metric and segment.";

  return `${parts.join(" ")} ${safeNextCheck}`;
}

function buildAnswerability(
  question: string,
  plan: PlannedQuery,
  profile: DatasetProfile,
  answer: QuestionAnswer,
  routing: TrustedQuestionFacts["routing"],
  semanticAlignment: TrustedQuestionFacts["semanticAlignment"],
  groundingConfidence: TrustedQuestionFacts["groundingConfidence"]
): TrustedQuestionFacts["answerability"] {
  if (routing.mode === "trust") {
    const trustExplanation = buildTrustExplanation(question, plan, profile, semanticAlignment.answeredMetric, semanticAlignment, groundingConfidence);
    return {
      status: trustExplanation.status,
      reasons: trustExplanation.reasons,
      caution: trustExplanation.caution
    };
  }

  if (groundingConfidence.overall === "unsupported") {
    const reason = firstReason(
      groundingConfidence.metricGrounding.reasons,
      groundingConfidence.relationshipGrounding.reasons,
      groundingConfidence.dimensionGrounding.reasons,
      groundingConfidence.reliabilityGrounding.reasons
    ) ?? "The requested question is not grounded by the current dataset.";
    return {
      status: "unsupported",
      reasons: [reason],
      caution: reason
    };
  }

  if (groundingConfidence.overall === "weak") {
    const reason = firstReason(
      groundingConfidence.metricGrounding.reasons,
      groundingConfidence.relationshipGrounding.reasons,
      groundingConfidence.dimensionGrounding.reasons,
      groundingConfidence.reliabilityGrounding.reasons
    ) ?? "The requested answer is only partially grounded by the current dataset.";
    return {
      status: "weak",
      reasons: [reason],
      caution: reason
    };
  }

  if (groundingConfidence.overall === "partial") {
    const coreGrounding = combineGroundingStatuses([
      groundingConfidence.metricGrounding.status,
      groundingConfidence.dimensionGrounding.status,
      groundingConfidence.relationshipGrounding.status
    ]);
    const reason = firstReason(
      groundingConfidence.metricGrounding.reasons,
      groundingConfidence.relationshipGrounding.reasons,
      groundingConfidence.dimensionGrounding.reasons,
      groundingConfidence.reliabilityGrounding.reasons
    ) ?? "The requested answer is only partially grounded by the current dataset.";

    if (coreGrounding === "strong") {
      return {
        status: "answerable",
        reasons: groundingConfidence.reliabilityGrounding.reasons,
        caution: groundingConfidence.reliabilityGrounding.reasons[0]
      };
    }

    return {
      status: "weak",
      reasons: [reason],
      caution: reason
    };
  }

  if (plan.unavailableMetricReasons?.length) {
    return {
      status: "unsupported",
      reasons: [...plan.unavailableMetricReasons],
      caution: plan.unavailableMetricReasons[0]
    };
  }

  if (detectWeakAnswer(answer)) {
    return {
      status: "weak",
      reasons: [answer.answer],
      caution: answer.answer
    };
  }

  if (semanticAlignment.status === "none") {
    return {
      status: "unsupported",
      reasons: [semanticAlignment.reason],
      caution: semanticAlignment.reason
    };
  }

  if (semanticAlignment.status === "weak" || semanticAlignment.status === "partial") {
    return {
      status: "weak",
      reasons: [semanticAlignment.reason],
      caution: semanticAlignment.reason
    };
  }

  return {
    status: "answerable",
    reasons: []
  };
}

function buildTrustFlags(
  plan: PlannedQuery,
  answer: QuestionAnswer,
  answerability: TrustedQuestionFacts["answerability"],
  routing: TrustedQuestionFacts["routing"],
  semanticAlignment: TrustedQuestionFacts["semanticAlignment"]
) {
  const flags = new Set<string>();

  if (answerability.status === "unsupported") {
    flags.add("unsupported_metric_request");
  }

  if (answerability.status === "weak") {
    flags.add("weak_answer_fallback");
  }

  if (routing.mode === "trust") {
    flags.add("trust_routing");
  }

  flags.add(`semantic_alignment:${semanticAlignment.status}`);

  if (plan.semanticProfile) {
    flags.add(`semantic_business_intent:${plan.semanticProfile.businessIntent}`);
  }

  if (plan.metrics.some((metric) => metric.includes("rate") || metric.includes("roas") || metric.includes("cost_per"))) {
    flags.add("ratio_or_efficiency_metric");
  }

  if (answer.chartSuggestion) {
    flags.add(`chart_support:${answer.chartSuggestion.chartType}`);
  } else {
    flags.add("chart_support:none");
  }

  return [...flags];
}

function toResultTable(
  resultTable?: QuestionAnswer["resultTable"]
): TrustedQuestionFacts["answer"]["resultTable"] | undefined {
  if (!resultTable) {
    return undefined;
  }

  return {
    columns: [...resultTable.columns],
    rows: resultTable.rows.map((row) => ({ ...row })) as Record<string, PrimitiveValue>[]
  };
}

function buildChartSupportRequest(
  plan: PlannedQuery,
  answer: QuestionAnswer,
  answerability: TrustedQuestionFacts["answerability"],
  routing: TrustedQuestionFacts["routing"],
  semanticAlignment: TrustedQuestionFacts["semanticAlignment"],
  groundingConfidence: TrustedQuestionFacts["groundingConfidence"]
): TrustedQuestionFacts["chartSupportRequest"] {
  if (
    answerability.status !== "answerable" ||
    routing.mode === "trust" ||
    semanticAlignment.status !== "strong" ||
    groundingConfidence.metricGrounding.status !== "strong" ||
    groundingConfidence.dimensionGrounding.status !== "strong" ||
    groundingConfidence.relationshipGrounding.status !== "strong" ||
    !answer.chartSuggestion
  ) {
    return {
      kind: "none",
      metric: null,
      dimension: null
    };
  }

  const kind = answer.chartSuggestion.chartType;
  const metric = plan.metric ?? answer.chartSuggestion.yKey ?? null;
  const dimension =
    kind === "line"
      ? plan.dimension ?? null
      : plan.dimension ?? answer.chartSuggestion.xKey ?? null;

  return {
    kind,
    metric,
    dimension,
    sort: kind === "bar" ? plan.sortDirection : null,
    limit: kind === "bar" || kind === "table" ? plan.limit : undefined
  };
}

export function buildTrustedQuestionFacts(
  question: string,
  context: TrustedQuestionFactsContext
): TrustedQuestionFactsBuildResult {
  const plan = planQuery(question, context.profile, context.input);
  const queryAnswer = executePlannedQuery(question, plan, context);
  const routing = detectTrustRouting(question);
  const answeredMetric = determineAnsweredMetric(plan, queryAnswer);
  const semanticAlignment = buildSemanticAlignment(question, plan, answeredMetric);
  const groundingConfidence = buildGroundingConfidence(question, plan, context.profile, queryAnswer, semanticAlignment);
  const answerability = buildAnswerability(question, plan, context.profile, queryAnswer, routing, semanticAlignment, groundingConfidence);
  const detectedIntent = buildDetectedIntent(plan, answerability.status);
  const trustExplanation = routing.mode === "trust"
    ? buildTrustExplanation(question, plan, context.profile, answeredMetric, semanticAlignment, groundingConfidence)
    : null;
  const facts: TrustedQuestionFacts = {
    question,
    routing,
    resolvedIntent: {
      intent: plan.intent,
      requestedMetrics: [...(plan.explicitMetrics?.length ? plan.explicitMetrics : plan.metrics)],
      requestedDimensions: plan.dimension ? [plan.dimension] : [],
      answeredMetric,
      semanticBusinessIntent: plan.semanticProfile?.businessIntent
    },
    semanticAlignment,
    groundingConfidence,
    answerability,
    answer: {
      mode: mapPlanIntentToAnswerMode(plan.intent),
      directAnswer:
        routing.mode === "trust"
          ? trustExplanation?.directAnswer ?? queryAnswer.answer
          : answerability.status === "answerable"
            ? queryAnswer.answer
            : buildGroundingLimitedAnswer(groundingConfidence, plan, queryAnswer),
      interpretation: queryAnswer.interpretation ?? "",
      supportingData: queryAnswer.supportingData.map((entry) => ({ ...entry })),
      resultTable: toResultTable(queryAnswer.resultTable)
    },
    evidence: {
      primaryMetric: answeredMetric ?? plan.metric,
      primaryDimension: plan.dimension,
      metricsUsed: [...plan.metrics],
      dimensionsUsed: plan.dimension ? [plan.dimension] : [],
      trustFlags: buildTrustFlags(plan, queryAnswer, answerability, routing, semanticAlignment)
    },
    chartSupportRequest: buildChartSupportRequest(plan, queryAnswer, answerability, routing, semanticAlignment, groundingConfidence)
  };

  return {
    facts,
    plan,
    queryAnswer,
    detectedIntent
  };
}
