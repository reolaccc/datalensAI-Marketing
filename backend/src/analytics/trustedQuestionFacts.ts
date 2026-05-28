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
import { parseDateValue } from "../utils/inference.js";

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

  const label = metric
    .replace(/_/g, " ")
    .replace(/\bpct\b/gi, "percent")
    .trim();

  return label
    .replace(/\broas\b/gi, "ROAS")
    .replace(/\bcpqc\b/gi, "CPQC");
}

function normalizeMetricText(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .replace(/\bpct\b/g, "percent")
    .replace(/\s+/g, " ")
    .trim();
}

function profileSignalText(profile: DatasetProfile) {
  const contract = profile.semanticContract;
  return normalizeMetricText(
    [
      ...profile.numericColumns,
      ...profile.categoricalColumns,
      ...profile.datetimeColumns,
      ...(contract?.availableMetrics ?? []),
      ...(contract?.availableDimensions ?? []),
      ...(contract?.derivedMetrics ?? []),
      ...(contract?.roleMappings?.map((mapping) => mapping.semanticRole ?? "") ?? []),
      ...(contract?.detectedDomain?.detectedCapabilities ?? [])
    ].join(" ")
  );
}

function hasSignal(profile: DatasetProfile, pattern: RegExp) {
  return pattern.test(profileSignalText(profile));
}

function extractMentionedYear(question: string) {
  const match = question.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function datasetHasYear(rows: DatasetRow[], profile: DatasetProfile, year: number) {
  if (profile.datetimeColumns.length === 0) {
    return false;
  }

  return rows.some((row) =>
    profile.datetimeColumns.some((column) => parseDateValue(row[column])?.getUTCFullYear() === year)
  );
}

function domainMetricExamples(profile: DatasetProfile) {
  const domain = profile.semanticContract?.detectedDomain?.domain;
  if (hasSignal(profile, /\b(solar|grid|load|kwh|generation|export|import)\b/)) {
    return "solar generation, load, grid import, grid export, or usage trend";
  }
  if (hasSignal(profile, /\b(stock|inventory|backorder|fulfillment|warehouse|supplier|sku|margin|return|markdown)\b/)) {
    return "units sold, margin, stockout rate, return rate, or fulfillment delay";
  }
  if (domain === "call_tracking" || domain === "mixed_call_tracking_attribution" || domain === "marketing_attribution") {
    return "calls, qualified rate, revenue, missed-call rate, or ROAS reliability";
  }
  if (hasSignal(profile, /\b(queue|service line|resolution|response|reopen|escalation|csat|satisfaction|ticket|case|agent|workload)\b/)) {
    return "response time, resolution time, reopen rate, workload, or service quality";
  }
  if (domain === "call_operations") {
    return "response time, resolution time, reopen rate, or workload";
  }
  const availableMetricText = new Set(
    [...profile.numericColumns, ...(profile.semanticContract?.availableMetrics ?? [])]
      .map((metric) => normalizeMetricText(metric))
      .join(" ")
      .split(/\s+/)
  );
  if (availableMetricText.has("solar") || availableMetricText.has("load") || availableMetricText.has("grid")) {
    return "solar generation, load, grid import, grid export, or usage trend";
  }
  if (availableMetricText.has("stock") || availableMetricText.has("inventory") || availableMetricText.has("margin")) {
    return "units sold, margin, stockout rate, return rate, or fulfillment delay";
  }

  return "volume, value, rate, or trend";
}

function detectGuidanceDomain(profile: DatasetProfile) {
  const domain = profile.semanticContract?.detectedDomain?.domain;
  if (hasSignal(profile, /\b(solar|grid|load|kwh|generation|export|import)\b/)) {
    return "energy" as const;
  }
  if (hasSignal(profile, /\b(stock|inventory|backorder|fulfillment|warehouse|supplier|sku|margin|return|markdown)\b/)) {
    return "retail" as const;
  }
  if (domain === "call_tracking" || domain === "mixed_call_tracking_attribution" || domain === "marketing_attribution") {
    return "call_tracking" as const;
  }
  if (hasSignal(profile, /\b(queue|service line|resolution|response|reopen|escalation|csat|satisfaction|ticket|case|agent|workload)\b/)) {
    return "operations" as const;
  }
  if (hasSignal(profile, /\b(call|campaign|channel|source|qualified|missed|spend|revenue|roas|cpqc)\b/)) {
    return "call_tracking" as const;
  }
  return "generic" as const;
}

function buildGuidanceDirections(profile: DatasetProfile) {
  const directions: string[] = [];
  const domain = detectGuidanceDomain(profile);
  const add = (condition: boolean, direction: string) => {
    if (condition && !directions.includes(direction)) {
      directions.push(direction);
    }
  };

  if (domain === "call_tracking") {
    add(hasSignal(profile, /\b(missed|missed call|no answer|abandoned|voicemail)\b/), "missed-call pressure by channel or campaign");
    add(hasSignal(profile, /\b(qualified|qualified call|qualified lead|qualified rate)\b/), "qualified-call rate variation by channel or campaign");
    add(hasSignal(profile, /\b(call|calls|volume|call id|enquiry)\b/), "call volume concentration across available segments");
    add(hasSignal(profile, /\b(roas|revenue|spend|cost)\b/), "revenue, spend, or ROAS reliability before budget decisions");
    add(hasSignal(profile, /\b(cpqc|cost per qualified|spend qualified)\b/), "CPQC reliability before cost-efficiency decisions");
    add(hasSignal(profile, /\b(duration|talk time|wait time|handle time|ring time)\b/), "call duration patterns that may point to operational leakage");
  } else if (domain === "operations") {
    add(hasSignal(profile, /\b(response|wait|talk time|duration|handle time)\b/), "response-time or wait-time pressure");
    add(hasSignal(profile, /\b(resolution|resolve|duration)\b/), "resolution-time bottlenecks");
    add(hasSignal(profile, /\b(reopen|escalation|callback|failed|abandoned|missed|error)\b/), "reopen, escalation, missed, or failed-interaction risk");
    add(hasSignal(profile, /\b(queue|team|service line|agent|department|shift|region)\b/), "workload concentration by queue, team, service line, or shift");
    add(hasSignal(profile, /\b(csat|satisfaction|quality|score)\b/), "service-quality or CSAT reliability");
  } else if (domain === "retail") {
    add(hasSignal(profile, /\b(stockout|backorder|inventory|stock)\b/), "stockout, backorder, or inventory pressure");
    add(hasSignal(profile, /\b(fulfillment|delay|ship|delivery)\b/), "fulfillment-delay risk");
    add(hasSignal(profile, /\b(return|refund)\b/), "return-rate or refund risk");
    add(hasSignal(profile, /\b(margin|markdown|profit)\b/), "margin or markdown reliability");
    add(hasSignal(profile, /\b(warehouse|supplier|category|sku|product)\b/), "warehouse, supplier, category, or product inconsistency");
  } else if (domain === "energy") {
    add(hasSignal(profile, /\b(solar|generation|production)\b/), "solar generation trend");
    add(hasSignal(profile, /\b(load|demand|consumption)\b/), "load or demand variation");
    add(hasSignal(profile, /\b(grid|import|export)\b/), "grid import/export reliance");
    add(hasSignal(profile, /\b(site|region|location)\b/), "site-level usage imbalance");
    add(profile.missingCells > 0 || profile.datetimeColumns.length > 0, "data coverage and time-period reliability");
  } else {
    add(profile.missingCells > 0, "metric completeness and missing data");
    add(profile.numericColumns.length > 0, "available volume, value, or rate metrics");
    add(profile.datetimeColumns.length > 0, "trendable metrics over time");
    add(profile.categoricalColumns.length > 0, "segment concentration across populated category fields");
    add(hasSignal(profile, /\b(rate|ratio|percent|roas|cost|efficiency)\b/), "rate or ratio reliability");
  }

  if (directions.length === 0 && profile.numericColumns.length > 0) {
    directions.push("available numeric metrics with good coverage");
  }
  if (directions.length === 0 && profile.categoricalColumns.length > 0) {
    directions.push("populated segment fields before drawing performance conclusions");
  }

  return directions.slice(0, 4);
}

function isBroadInvestigationGuidanceQuestion(question: string) {
  const normalized = normalizeMetricText(question);
  if (extractMentionedYear(question)) {
    return false;
  }
  return /\b(biggest problem|where should we optimize|what should i look at first|what should we look at first|areas deserve further investigation|deserve further investigation|where should we focus|what should we focus|campaign should i focus|performance look weak|performance looks weak|performance look inconsistent|performance looks inconsistent|where does performance|how did we perform|performance overall|how is performance)\b/.test(normalized);
}

function buildBroadInvestigationGuidance(
  question: string,
  profile: DatasetProfile
): { status: TrustedQuestionFacts["answerability"]["status"]; directAnswer: string; reason: string } | null {
  if (!isBroadInvestigationGuidanceQuestion(question)) {
    return null;
  }

  const directions = buildGuidanceDirections(profile);
  const reason = "The question is broad, so the safe answer is investigation guidance rather than a winner.";
  if (directions.length === 0) {
    return {
      status: "weak",
      directAnswer: "This dataset does not contain enough grounded metrics to identify a business problem reliably. Start by adding a clear outcome metric, such as calls, revenue, response time, margin, or another measurable result.",
      reason
    };
  }

  const normalized = normalizeMetricText(question);
  const directionText = directions.join(", ");
  if (/\boptimize|focus\b/.test(normalized)) {
    return {
      status: "weak",
      directAnswer: `Optimization should start with grounded risk signals, not a broad inferred ranking. In this dataset, check ${directionText}; then use metric-specific questions before choosing where to focus.`,
      reason
    };
  }
  if (/\bbiggest problem|problem|weak|risky\b/.test(normalized)) {
    return {
      status: "weak",
      directAnswer: `This is broad, so I would not choose a single "biggest problem" without a metric. The safest areas to investigate in this dataset are ${directionText}.`,
      reason
    };
  }

  return {
    status: "weak",
    directAnswer: `The strongest next investigations are: ${directionText}. These are grounded in the available fields, but they should be checked with metric-specific questions before making decisions.`,
    reason
  };
}

function isProbablyMalformedFragment(question: string, plan: PlannedQuery) {
  const normalized = normalizeMetricText(question).replace(/[?.!]+$/g, "").trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (/^would name\b/.test(normalized) || /\bmetric and (?:the )?segment\b/.test(normalized)) {
    return true;
  }
  if (/^by\s+[a-z0-9 _-]+$/.test(normalized)) {
    return true;
  }
  if (/^(compare|ranking|segment|metric|dimension)$/.test(normalized)) {
    return true;
  }
  if (tokens.length <= 2 && !plan.metric && !plan.dimension && !extractMentionedYear(question)) {
    return true;
  }

  return false;
}

function isBroadPerformanceQuestion(question: string, plan: PlannedQuery) {
  const normalized = normalizeMetricText(question);
  return (
    /\bperform(?:ance|ed|ing|ace)?\b|\bhow did we do\b|\bhow are we doing\b|\bwhat should i look at\b|\bwhat should we look at\b/.test(normalized) &&
    !plan.metric &&
    plan.metrics.length === 0
  );
}

function buildClarificationOverride(
  question: string,
  plan: PlannedQuery,
  profile: DatasetProfile,
  rows: DatasetRow[]
): { status: TrustedQuestionFacts["answerability"]["status"]; directAnswer: string; reason: string } | null {
  const year = extractMentionedYear(question);
  const metricExamples = domainMetricExamples(profile);

  if (year) {
    if (profile.datetimeColumns.length === 0) {
      const reason = `This dataset does not contain enough date/time information to assess ${year} performance reliably.`;
      return {
        status: "unsupported",
        directAnswer: reason,
        reason
      };
    }

    if (!datasetHasYear(rows, profile, year)) {
      const reason = `This dataset does not appear to contain records for ${year}, so I cannot assess ${year} performance from the current data.`;
      return {
        status: "unsupported",
        directAnswer: reason,
        reason
      };
    }

    if (!plan.metric || isBroadPerformanceQuestion(question, plan)) {
      const reason = `${year} is present, but "performance" is broad without a metric.`;
      return {
        status: "weak",
        directAnswer: `The dataset contains ${year} records, but "performance" is broad. Choose a metric such as ${metricExamples}.`,
        reason
      };
    }
  }

  if (isProbablyMalformedFragment(question, plan)) {
    const reason = "The submitted text looks like an incomplete question.";
    return {
      status: "weak",
      directAnswer: `This looks like an incomplete question. Try asking about a specific metric and segment, such as "How did calls vary by channel?" or "Which channel had the highest qualified rate?"`,
      reason
    };
  }

  const broadGuidance = buildBroadInvestigationGuidance(question, profile);
  if (broadGuidance) {
    return broadGuidance;
  }

  if (isBroadPerformanceQuestion(question, plan)) {
    const reason = "Performance is too broad without a metric.";
    return {
      status: "weak",
      directAnswer: `Performance is too broad to rank reliably without a metric. Ask about a specific outcome such as ${metricExamples}.`,
      reason
    };
  }

  return null;
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

function isKnownDerivedReliabilityMetric(metric: string | null | undefined) {
  return Boolean(metric && ["qualified_call_rate", "missed_call_rate", "answered_call_rate"].includes(metric));
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
    directAnswer.includes("too broad for a reliable ranking") ||
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

  if (!requestedMetric) {
    return buildDatasetReliabilityExplanation(profile, contract, groundingConfidence);
  }

  if (semanticAlignment.status === "none" || semanticAlignment.status === "weak") {
    return {
      status: "weak" as const,
      directAnswer: `This cannot be answered reliably without changing the metric being answered. The dataset does not clearly support ${semanticAlignment.requestedMetrics.map(humanizeMetric).join(", ") || "the requested metric"} for this question, so a ranking would be misleading.`,
      reasons: [semanticAlignment.reason],
      caution: semanticAlignment.reason
    };
  }

  const caveats: string[] = [];
  if (resolution?.resolution === "derived" || resolution?.aggregation === "ratio" || isKnownDerivedReliabilityMetric(requestedMetric)) {
    caveats.push(`${humanizeMetric(requestedMetric)} is derived rather than directly observed.`);
  }
  const normalizedRequestedMetric = normalizeMetricText(requestedMetric);
  if (normalizedRequestedMetric === "roas") {
    caveats.push("ROAS is calculated as revenue divided by spend, so each segment needs populated revenue and spend before comparisons are decision-grade.");
  }
  if (normalizedRequestedMetric === "roas" && resolution?.sourceColumns && resolutionHasMissingSource(profile, resolution.sourceColumns)) {
    caveats.push("Partial revenue or spend coverage makes ROAS comparisons directional rather than final.");
  }
  if (normalizedRequestedMetric === "cost per qualified call" && resolution?.sourceColumns && resolutionHasMissingSource(profile, resolution.sourceColumns)) {
    caveats.push("CPQC requires populated spend and qualified-call fields; partial coverage makes comparisons directional.");
  }
  if (typeof resolution?.confidence === "number" && resolution.confidence < 0.8) {
    caveats.push(`${humanizeMetric(requestedMetric)} is only partially supported by the available fields.`);
  }
  if (!resolution && !isKnownDerivedReliabilityMetric(requestedMetric)) {
    caveats.push(`${humanizeMetric(requestedMetric)} is available only as a generic numeric field, so interpretation should be cautious.`);
  }
  if (dimension && !profile.categoricalColumns.includes(dimension)) {
    caveats.push("The requested comparison segment is not cleanly supported by the available fields.");
  }

  const metricSentence = dimension
    ? `${humanizeMetric(requestedMetric)} can be compared across ${humanizeMetric(dimension)} at a basic level`
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

function uniqueNonEmpty(values: string[], limit = 4) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function hasMetricResolution(contract: ReturnType<typeof buildSemanticDatasetContract>, metric: string) {
  return Boolean(
    contract.metricResolutions[metric] ||
    contract.availableMetrics.includes(metric) ||
    contract.derivedMetrics.includes(metric)
  );
}

function resolutionHasMissingSource(profile: DatasetProfile, sourceColumns: string[]) {
  return sourceColumns.some((sourceColumn) => (profile.columns.find((column) => column.name === sourceColumn)?.missingCount ?? 0) > 0);
}

function buildDatasetReliabilityExplanation(
  profile: DatasetProfile,
  contract: ReturnType<typeof buildSemanticDatasetContract>,
  groundingConfidence?: TrustedQuestionFacts["groundingConfidence"]
) {
  const coverageReasons = groundingConfidence?.reliabilityGrounding.coverageWarnings ?? [];
  const ratioReasons = groundingConfidence?.reliabilityGrounding.ratioWarnings ?? [];
  const semanticReasons = groundingConfidence?.reliabilityGrounding.semanticWarnings ?? [];
  const limitations: string[] = [];
  const saferMetrics: string[] = [];
  const cautiousMetrics: string[] = [];

  if (profile.missingCells > 0) {
    const missingShare = profile.rowCount * profile.columnCount > 0
      ? Math.round((profile.missingCells / (profile.rowCount * profile.columnCount)) * 100)
      : 0;
    limitations.push(`Missing values affect ${profile.missingCells} cells${missingShare > 0 ? `, about ${missingShare}% of the dataset` : ""}.`);
  }

  const lowConfidenceRoles = contract.roleMappings?.filter((mapping) => mapping.confidence < 0.7 && mapping.semanticRole) ?? [];
  if (lowConfidenceRoles.length > 0 || semanticReasons.length > 0) {
    limitations.push("Some business meanings are only partially grounded, so fields with ambiguous semantic mapping should be treated cautiously.");
  }

  const ratioMetrics = Object.values(contract.metricResolutions).filter((resolution) => resolution.aggregation === "ratio" || resolution.resolution === "derived");
  if (ratioMetrics.length > 0 || ratioReasons.length > 0) {
    limitations.push("Ratio and efficiency comparisons depend on complete numerator and denominator fields.");
  }

  const revenueResolution = contract.metricResolutions.revenue ?? contract.metricResolutions.total_revenue;
  const spendResolution = contract.metricResolutions.spend ?? contract.metricResolutions.total_spend ?? contract.metricResolutions.cost;
  const qualifiedResolution = contract.metricResolutions.qualifiedCall ?? contract.metricResolutions.qualified_calls;

  if (revenueResolution && resolutionHasMissingSource(profile, revenueResolution.sourceColumns)) {
    limitations.push("Revenue coverage is incomplete, so revenue-based comparisons should be directional.");
    cautiousMetrics.push("revenue-based metrics");
  }
  if (spendResolution && resolutionHasMissingSource(profile, spendResolution.sourceColumns)) {
    limitations.push("Spend or cost coverage is incomplete, so cost-efficiency comparisons should be directional.");
    cautiousMetrics.push("cost-efficiency metrics");
  }
  if (qualifiedResolution && (qualifiedResolution.confidence < 0.8 || resolutionHasMissingSource(profile, qualifiedResolution.sourceColumns))) {
    limitations.push("Qualified-rate conclusions depend on whether the qualified field is complete and clearly mapped.");
    cautiousMetrics.push("qualified-rate metrics");
  }

  if (coverageReasons.length > 0) {
    limitations.push(...coverageReasons);
  }

  if (hasMetricResolution(contract, "calls") || hasMetricResolution(contract, "total_calls")) {
    saferMetrics.push("direct call or volume counts");
  }
  if (hasMetricResolution(contract, "missedCall") || hasMetricResolution(contract, "missed_call_rate")) {
    saferMetrics.push("missed-call measures when their source field is populated");
  }
  if (profile.numericColumns.length > 0 && saferMetrics.length === 0) {
    saferMetrics.push("direct numeric fields with good coverage");
  }
  if (profile.categoricalColumns.length > 0) {
    saferMetrics.push("segment comparisons using populated category fields");
  }

  if (hasMetricResolution(contract, "roas")) {
    cautiousMetrics.push("ROAS");
  }
  if (ratioMetrics.length > 0) {
    cautiousMetrics.push("derived ratios");
  }

  const finalLimitations = uniqueNonEmpty(
    limitations.length > 0
      ? limitations
      : [
          "Decision confidence depends on field coverage, semantic grounding, denominator validity, segment completeness, and date coverage.",
          "Comparisons are safer when the metric is directly observed rather than inferred or derived."
        ],
    3
  );
  const finalSaferMetrics = uniqueNonEmpty(saferMetrics, 2);
  const finalCautiousMetrics = uniqueNonEmpty(cautiousMetrics.length > 0 ? cautiousMetrics : ["derived ratios and efficiency metrics"], 3);

  const saferSubject = finalSaferMetrics.join(" and ");
  const saferSentence = finalSaferMetrics.length > 0
    ? `${saferSubject.charAt(0).toUpperCase()}${saferSubject.slice(1)} are safer than inferred business metrics.`
    : "Directly observed metrics are safer than inferred business metrics.";
  const cautiousSentence = `${finalCautiousMetrics.join(", ")} should be treated cautiously unless their supporting fields are complete.`;

  return {
    status: "weak" as const,
    directAnswer: `Main reliability limitations: ${finalLimitations.join(" ")} ${saferSentence} ${cautiousSentence} Treat cross-segment comparisons as directional rather than decision-grade when coverage or grounding is partial.`,
    reasons: finalLimitations,
    caution: finalLimitations[0]
  };
}

function hasExplicitMetricGrounding(plan: PlannedQuery) {
  return Boolean(plan.explicitMetrics?.length);
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
  const hasExplicitMetric = hasExplicitMetricGrounding(plan);

  if (groundingConfidence.overall === "unsupported") {
    const missingMetric = metric.missingMetrics[0] ?? metric.requestedMetrics[0];
    const missingMetricSentence = plan.unavailableMetricReasons?.[0]
      ? plan.unavailableMetricReasons[0]
      : missingMetric
      ? `${humanizeMetric(missingMetric)} cannot be calculated reliably from the current dataset.`
      : "The current dataset does not support a reliable answer to this question.";
    return `${missingMetricSentence} The available fields do not clearly support the metric or segment needed for this comparison. A more reliable next question would name the metric and the segment you want to compare.`;
  }

  if (/too broad for a reliable ranking|high-level business read only/i.test(fallbackAnswer.answer)) {
    parts.push("This question is too broad for a reliable ranking from the current dataset.");
  } else if (!hasExplicitMetric) {
    parts.push("This question does not name a metric to rank, so I should not choose a winner from inferred signals alone.");
  }

  if (hasExplicitMetric && metric.groundedMetrics.length > 0) {
    parts.push(`The dataset can partially support ${metric.groundedMetrics.map(humanizeMetric).join(", ")}.`);
  } else if (!hasExplicitMetric && metric.groundedMetrics.length > 0) {
    parts.push("The available fields point to multiple possible signals, but no single requested metric is strong enough for a reliable ranking.");
  }

  if (dimension.groundedDimensions.length > 0 && dimension.status !== "weak") {
    parts.push("A segment comparison is partly available from the current fields.");
  }

  if (metric.missingMetrics.length > 0 || metric.weakMetrics.length > 0) {
    parts.push("One or more requested metrics are not reliable enough for a strong answer.");
  }

  if (dimension.missingDimensions.length > 0 || dimension.weakDimensions.length > 0) {
    parts.push("The available fields do not support a reliable segment comparison for this question.");
  }

  if (relationship.status !== "strong" && relationship.relationshipType && relationship.relationshipType !== "single_metric") {
    parts.push("The requested relationship is only partially supported, so a winner or ranking would overstate the data.");
  }

  if (hasExplicitMetric && reliability.reasons.length > 0) {
    parts.push(`Reliability caveat: ${reliability.reasons[0]}`);
  } else if (!hasExplicitMetric && reliability.reasons.length > 0) {
    parts.push("Some inferred signals have coverage or reliability caveats, so this should be treated as directional.");
  }

  if (parts.length === 0) {
    parts.push(fallbackAnswer.answer);
  }

  const safeNextCheck =
    hasExplicitMetric && metric.groundedMetrics[0] && dimension.groundedDimensions[0]
      ? `A safer next check is to ask about ${humanizeMetric(metric.groundedMetrics[0])} by ${dimension.groundedDimensions[0]}.`
      : "A more reliable next question would name the metric and the segment you want to compare.";

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
  const clarificationOverride = buildClarificationOverride(question, plan, context.profile, context.rows);
  const baseAnswerability = buildAnswerability(question, plan, context.profile, queryAnswer, routing, semanticAlignment, groundingConfidence);
  const answerability = clarificationOverride
    ? {
        status: clarificationOverride.status,
        reasons: [clarificationOverride.reason],
        caution: clarificationOverride.reason
      }
    : baseAnswerability;
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
        clarificationOverride
          ? clarificationOverride.directAnswer
          : routing.mode === "trust"
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
