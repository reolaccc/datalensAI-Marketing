import type {
  DatasetProfile,
  DatasetRow,
  QuestionContextInput,
  SemanticDatasetContract,
  TrustedQuestionFacts
} from "./types.js";
import { buildTrustedQuestionFacts } from "./trustedQuestionFacts.js";

export type SuggestedQuestionIntentType =
  | "domain_investigation"
  | "general_investigation"
  | "trust_caveat"
  | "relationship_imbalance"
  | "operational_risk"
  | "efficiency"
  | "concentration"
  | "segment_variance"
  | "trend_change";

export type SuggestedQuestionDomain =
  | "call_tracking"
  | "marketing"
  | "operations"
  | "retail"
  | "energy"
  | "generic";

export type SuggestedQuestionBucket =
  | "quality"
  | "cost_efficiency"
  | "missed_opportunity"
  | "revenue_reliability"
  | "volume_value_relationship"
  | "trend_change"
  | "concentration_risk"
  | "operational_bottleneck"
  | "inventory_risk"
  | "energy_balance"
  | "data_reliability"
  | "general_investigation";

export interface NativeSuggestedQuestion {
  question: string;
  intentType: SuggestedQuestionIntentType;
  requiredMetrics: string[];
  requiredDimensions: string[];
  groundingRequirement: "strong" | "partial";
  riskType?: "coverage" | "semantic_ambiguity" | "ratio_validity" | "relationship";
  domain: SuggestedQuestionDomain;
  priority: number;
  bucket?: SuggestedQuestionBucket;
}

export interface NativeSuggestedQuestionDecision {
  candidate: NativeSuggestedQuestion;
  kept: boolean;
  reason: string;
  facts?: TrustedQuestionFacts;
}

export interface NativeSuggestedQuestionsResult {
  questions: string[];
  candidates: NativeSuggestedQuestion[];
  decisions: NativeSuggestedQuestionDecision[];
}

export interface SuggestedQuestionTextValidationDecision {
  question: string;
  kept: boolean;
  reason: string;
  facts?: TrustedQuestionFacts;
}

interface NativeSuggestedQuestionContext {
  rows: DatasetRow[];
  profile: DatasetProfile;
  input?: QuestionContextInput;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\bpct\b/gi, "pct")
    .replace(/\broas\b/gi, "ROAS")
    .replace(/\bcpqc\b/gi, "CPQC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\broas\b/g, "ROAS")
    .replace(/\bcpqc\b/g, "CPQC");
}

function uniq<T>(values: T[]) {
  return [...new Set(values)];
}

function getMetricNames(profile: DatasetProfile) {
  const contract = profile.semanticContract;
  return uniq([
    ...Object.keys(contract?.metricResolutions ?? {}),
    ...(contract?.availableMetrics ?? []),
    ...(contract?.derivedMetrics ?? []),
    ...profile.numericColumns
  ]);
}

function getDimensionNames(profile: DatasetProfile) {
  const contract = profile.semanticContract;
  return uniq([
    ...(contract?.availableDimensions ?? []),
    ...profile.categoricalColumns,
    ...profile.datetimeColumns
  ]);
}

function hasNamedSignal(values: string[], patterns: RegExp[]) {
  return values.some((value) => patterns.some((pattern) => pattern.test(normalize(value))));
}

function pickByPattern(values: string[], patterns: RegExp[]) {
  return values.find((value) => patterns.some((pattern) => pattern.test(normalize(value)))) ?? null;
}

function hasSemanticRole(contract: SemanticDatasetContract | undefined, role: string) {
  return Boolean(contract?.roleMappings?.some((mapping) => mapping.semanticRole === role && mapping.confidence >= 0.5));
}

function hasStrongMarketingAttributionSignal(profile: DatasetProfile) {
  const contract = profile.semanticContract;
  const semanticDomain = contract?.detectedDomain?.domain;
  const semanticConfidence = contract?.detectedDomain?.confidence ?? 0;
  const metrics = getMetricNames(profile);
  const dimensions = getDimensionNames(profile);
  const allNames = [...metrics, ...dimensions, ...profile.columns.map((column) => column.name)];

  const evidenceCount = [
    hasNamedSignal(allNames, [/campaign|ad group|adgroup|ad set|utm|gclid|fbclid|source|medium|paid search|paid social|google ads|meta ads|facebook ads|creative|keyword/]),
    hasNamedSignal(allNames, [/tracking number|call|lead|qualified|conversion|mql|sql|opportunit|customer/]),
    hasNamedSignal(allNames, [/\broas\b|\bcpa\b|\bcpqc\b|cost per qualified|attribution/])
  ].filter(Boolean).length;

  return evidenceCount >= 2 || (semanticDomain === "marketing_attribution" && semanticConfidence >= 0.75 && evidenceCount >= 1);
}

function resolveSuggestedQuestionDomain(profile: DatasetProfile): SuggestedQuestionDomain {
  const contract = profile.semanticContract;
  const semanticDomain = contract?.detectedDomain?.domain;
  const metrics = getMetricNames(profile);
  const dimensions = getDimensionNames(profile);
  const allNames = [...metrics, ...dimensions, ...profile.columns.map((column) => column.name)];
  const strongMarketingAttribution = hasStrongMarketingAttributionSignal(profile);

  if (semanticDomain === "call_tracking" || semanticDomain === "mixed_call_tracking_attribution") {
    return "call_tracking";
  }
  if (semanticDomain === "call_operations") {
    return "operations";
  }
  if (hasNamedSignal(allNames, [/warehouse|sku|inventory|stock|backorder|fulfilled|fulfillment|markdown|margin|return/])) {
    return "retail";
  }
  if (hasNamedSignal(allNames, [/solar|grid|load|generation|production|import|export|kwh|energy/]) && !strongMarketingAttribution) {
    return "energy";
  }
  if (hasNamedSignal(allNames, [/queue|team|agent|ticket|resolution|response|escalat|reopen|service line|priority/]) && !strongMarketingAttribution) {
    return "operations";
  }
  if (semanticDomain === "marketing_attribution" && strongMarketingAttribution) {
    return "marketing";
  }

  return "generic";
}

function hasMetric(profile: DatasetProfile, patterns: RegExp[]) {
  const contract = profile.semanticContract;
  if (
    patterns.some((pattern) =>
      ["revenue", "spend", "qualifiedCall", "missedCall", "convertedCall", "callDuration", "talkTime", "handleTime", "waitTime"].some(
        (role) => pattern.test(normalize(role)) && hasSemanticRole(contract, role)
      )
    )
  ) {
    return true;
  }

  return hasNamedSignal(getMetricNames(profile), patterns);
}

function pickMetric(profile: DatasetProfile, patterns: RegExp[]) {
  return pickByPattern(getMetricNames(profile), patterns);
}

function pickDimension(profile: DatasetProfile, patterns: RegExp[]) {
  return pickByPattern(getDimensionNames(profile), patterns);
}

function preferredSegmentDimension(profile: DatasetProfile, domain: SuggestedQuestionDomain) {
  const dimensions = getDimensionNames(profile);
  const domainPatterns: Record<SuggestedQuestionDomain, RegExp[]> = {
    call_tracking: [/channel|source|campaign|account|region|location/],
    marketing: [/channel|source|campaign|region|device/],
    operations: [/queue|team|service|agent|location|region/],
    retail: [/warehouse|category|product|sku|store|supplier|region/],
    energy: [/site|location|region|meter|date|day|month/],
    generic: [/segment|category|type|region|location|account|customer|date/]
  };
  return pickByPattern(dimensions, domainPatterns[domain]) ?? dimensions.find((dimension) => !/id\b|uuid|key/i.test(dimension)) ?? null;
}

function preferredDateDimension(profile: DatasetProfile) {
  return (
    pickByPattern(profile.datetimeColumns, [/date|time|day|week|month|period|created|updated/]) ??
    profile.datetimeColumns[0] ??
    null
  );
}

function pickMetricExcluding(profile: DatasetProfile, patterns: RegExp[], excluded: Array<string | null | undefined>) {
  const excludedSet = new Set(excluded.filter(Boolean).map((value) => normalize(String(value))));
  return getMetricNames(profile).find((metric) => !excludedSet.has(normalize(metric)) && patterns.some((pattern) => pattern.test(normalize(metric)))) ?? null;
}

function inferQuestionBucket(candidate: NativeSuggestedQuestion): SuggestedQuestionBucket {
  const text = normalize(candidate.question);
  if (candidate.intentType === "trust_caveat" || /reliab|trust|caveat|confidence|coverage/.test(text)) {
    if (/roas|revenue|booked|value/.test(text)) {
      return "revenue_reliability";
    }
    return "data_reliability";
  }
  if (/qualified|conversion|quality|outcome/.test(text)) {
    return "quality";
  }
  if (/cost|cpqc|spend|efficien|budget/.test(text)) {
    return "cost_efficiency";
  }
  if (/missed|leakage|opportunity/.test(text)) {
    return "missed_opportunity";
  }
  if (/revenue|value|volume.*value|booked/.test(text) || candidate.intentType === "relationship_imbalance") {
    return "volume_value_relationship";
  }
  if (candidate.intentType === "trend_change" || /trend|change over time|getting worse/.test(text)) {
    return "trend_change";
  }
  if (candidate.intentType === "concentration" || /concentrat|risk/.test(text)) {
    return "concentration_risk";
  }
  if (candidate.intentType === "operational_risk" || /response|resolution|delay|bottleneck|service/.test(text)) {
    return "operational_bottleneck";
  }
  if (/stockout|backorder|inventory|warehouse|fulfillment|margin|return/.test(text)) {
    return "inventory_risk";
  }
  if (/solar|grid|load|energy|import|export|generation/.test(text)) {
    return "energy_balance";
  }
  return "general_investigation";
}

function makeCandidate(params: NativeSuggestedQuestion): NativeSuggestedQuestion {
  return {
    ...params,
    bucket: params.bucket ?? inferQuestionBucket(params)
  };
}

function buildDomainCandidates(profile: DatasetProfile, domain: SuggestedQuestionDomain): NativeSuggestedQuestion[] {
  const candidates: NativeSuggestedQuestion[] = [];
  const primaryDimension = preferredSegmentDimension(profile, domain);
  const dateDimension = preferredDateDimension(profile);
  const secondaryDimension = (() => {
    const dimensions = getDimensionNames(profile).filter((dimension) => dimension !== primaryDimension);
    return dimensions.find((dimension) => /category|team|queue|service|warehouse|channel|source|region|location/i.test(dimension)) ?? null;
  })();

  const addTrustQuestion = () => {
    candidates.push(makeCandidate({
      question: "What reliability limitations affect decision confidence?",
      intentType: "trust_caveat",
      requiredMetrics: [],
      requiredDimensions: [],
      groundingRequirement: "partial",
      riskType: "coverage",
      domain,
      priority: 65
    }));
  };

  if (domain === "call_tracking" || domain === "marketing") {
    const channelDimension = pickDimension(profile, [/channel|source|campaign/]) ?? primaryDimension;
    const hasRevenue = hasMetric(profile, [/revenue|sales|booked|closed/]);
    const hasSpend = hasMetric(profile, [/spend|cost|budget/]);
    const hasQualified = hasMetric(profile, [/qualified|qualified call/]);
    const hasMissed = hasMetric(profile, [/missed|failed|abandon/]);

    if (channelDimension && hasQualified) {
      candidates.push(makeCandidate({
        question: `Where does qualified call rate look inconsistent across ${humanize(channelDimension)}?`,
        intentType: "domain_investigation",
        requiredMetrics: ["qualified call rate"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "strong",
        domain,
        priority: 100
      }));
      candidates.push(makeCandidate({
        question: `Where does qualified call rate vary most across ${humanize(channelDimension)}?`,
        intentType: "segment_variance",
        requiredMetrics: ["qualified call rate"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "strong",
        domain,
        priority: 91
      }));
    }

    if (channelDimension && hasMissed) {
      candidates.push(makeCandidate({
        question: `Can missed call rate be compared reliably by ${humanize(channelDimension)}?`,
        intentType: "trust_caveat",
        requiredMetrics: ["missed call rate"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 96
      }));
      candidates.push(makeCandidate({
        question: `Where might missed call pressure affect opportunity capture across ${humanize(channelDimension)}?`,
        intentType: "domain_investigation",
        requiredMetrics: ["missed call rate"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 89,
        bucket: "missed_opportunity"
      }));
    }

    if (dateDimension && hasQualified) {
      candidates.push(makeCandidate({
        question: "Are there signs of a trend shift in qualified call rate?",
        intentType: "trend_change",
        requiredMetrics: ["qualified call rate"],
        requiredDimensions: [dateDimension],
        groundingRequirement: "partial",
        domain,
        priority: 90
      }));
    }

    if (channelDimension && hasSpend && hasQualified) {
      candidates.push(makeCandidate({
        question: `Where does cost per qualified call look inefficient across ${humanize(channelDimension)}?`,
        intentType: "efficiency",
        requiredMetrics: ["cost per qualified call"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "strong",
        riskType: "ratio_validity",
        domain,
        priority: 94
      }));
      candidates.push(makeCandidate({
        question: `Can cost per qualified call be compared reliably by ${humanize(channelDimension)}?`,
        intentType: "trust_caveat",
        requiredMetrics: ["cost per qualified call"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "partial",
        riskType: "ratio_validity",
        domain,
        priority: 93,
        bucket: "cost_efficiency"
      }));
    }

    if (channelDimension && hasRevenue && hasSpend) {
      candidates.push(makeCandidate({
        question: `Can ROAS be compared reliably by ${humanize(channelDimension)}?`,
        intentType: "trust_caveat",
        requiredMetrics: ["ROAS"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "partial",
        riskType: "ratio_validity",
        domain,
        priority: 92,
        bucket: "revenue_reliability"
      }));
    }

    if (channelDimension && hasRevenue) {
      candidates.push(makeCandidate({
        question: `Where does call volume look concentrated without matching revenue quality across ${humanize(channelDimension)}?`,
        intentType: "relationship_imbalance",
        requiredMetrics: ["calls", "revenue"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "partial",
        riskType: "relationship",
        domain,
        priority: 88,
        bucket: "volume_value_relationship"
      }));
      candidates.push(makeCandidate({
        question: `Can call volume and revenue quality be compared reliably by ${humanize(channelDimension)}?`,
        intentType: "trust_caveat",
        requiredMetrics: ["calls", "revenue"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "partial",
        riskType: "relationship",
        domain,
        priority: 86,
        bucket: "volume_value_relationship"
      }));
    }

    if (channelDimension && hasMissed && hasQualified) {
      candidates.push(makeCandidate({
        question: `Where does missed call pressure look high without matching qualified call rate across ${humanize(channelDimension)}?`,
        intentType: "relationship_imbalance",
        requiredMetrics: ["missed call rate", "qualified call rate"],
        requiredDimensions: [channelDimension],
        groundingRequirement: "partial",
        riskType: "relationship",
        domain,
        priority: 87
      }));
    }

    addTrustQuestion();
  } else if (domain === "operations") {
    const segment = pickDimension(profile, [/queue|team|service|agent|location|region/]) ?? primaryDimension;
    const hasMissed = hasMetric(profile, [/missed|failed|abandon/]);
    const durationMetric = pickMetric(profile, [/duration|talk|wait|handle|resolution|response/]);
    const responseMetric = pickMetric(profile, [/response|wait|queue time|speed/]) ?? durationMetric;
    const riskMetric = pickMetric(profile, [/reopen|escalat|failed|missed|abandon|error/]);
    const hasAnswered = hasMetric(profile, [/answered|resolved|completed/]);

    if (segment && hasMissed) {
      candidates.push(makeCandidate({
        question: `Can missed call rate be compared reliably by ${humanize(segment)}?`,
        intentType: "trust_caveat",
        requiredMetrics: ["missed call rate"],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 100
      }));
    }

    if (segment && durationMetric) {
      candidates.push(makeCandidate({
        question: `Where does ${humanize(durationMetric)} look inconsistent across ${humanize(segment)}?`,
        intentType: "operational_risk",
        requiredMetrics: [durationMetric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 96
      }));
      candidates.push(makeCandidate({
        question: `Where does ${humanize(durationMetric)} suggest response-time pressure across ${humanize(segment)}?`,
        intentType: "operational_risk",
        requiredMetrics: [durationMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "semantic_ambiguity",
        domain,
        priority: 91
      }));
      candidates.push(makeCandidate({
        question: `Where does ${humanize(durationMetric)} vary most across ${humanize(segment)}?`,
        intentType: "segment_variance",
        requiredMetrics: [durationMetric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 89
      }));
    }

    if (segment && hasAnswered) {
      candidates.push(makeCandidate({
        question: `Where does service quality risk look concentrated across ${humanize(segment)}?`,
        intentType: "concentration",
        requiredMetrics: ["service quality"],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "semantic_ambiguity",
        domain,
        priority: 88
      }));
    }

    if (segment && riskMetric) {
      candidates.push(makeCandidate({
        question: `Where do ${humanize(riskMetric)} patterns suggest operational risk across ${humanize(segment)}?`,
        intentType: "operational_risk",
        requiredMetrics: [riskMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 86
      }));
    }

    if (dateDimension && responseMetric) {
      candidates.push(makeCandidate({
        question: `Are there signs of a trend shift in ${humanize(responseMetric)}?`,
        intentType: "trend_change",
        requiredMetrics: [responseMetric],
        requiredDimensions: [dateDimension],
        groundingRequirement: "partial",
        domain,
        priority: 82
      }));
    }

    if (secondaryDimension) {
      candidates.push(makeCandidate({
        question: `Where does performance look inconsistent across ${humanize(secondaryDimension)}?`,
        intentType: "general_investigation",
        requiredMetrics: [],
        requiredDimensions: [secondaryDimension],
        groundingRequirement: "partial",
        domain,
        priority: 70
      }));
    }

    addTrustQuestion();
  } else if (domain === "retail") {
    const segment = pickDimension(profile, [/warehouse|category|product|sku|store|supplier/]) ?? primaryDimension;
    const marginMetric = pickMetric(profile, [/margin|profit/]);
    const backorderMetric = pickMetric(profile, [/backorder|stockout/]);
    const fulfillmentMetric = pickMetric(profile, [/fulfilled|fulfillment|late|delay/]);
    const costMetric = pickMetric(profile, [/fulfillment cost|cost/]);
    const returnMetric = pickMetric(profile, [/return|refund/]);

    if (segment && marginMetric) {
      candidates.push(makeCandidate({
        question: `Where does ${humanize(marginMetric)} look inconsistent across ${humanize(segment)}?`,
        intentType: "domain_investigation",
        requiredMetrics: [marginMetric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 100
      }));
      candidates.push(makeCandidate({
        question: `Where does ${humanize(marginMetric)} vary most across ${humanize(segment)}?`,
        intentType: "segment_variance",
        requiredMetrics: [marginMetric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 91
      }));
    }

    if (segment && backorderMetric) {
      candidates.push(makeCandidate({
        question: `Can stockout pressure be compared reliably by ${humanize(segment)}?`,
        intentType: "trust_caveat",
        requiredMetrics: [backorderMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 96
      }));
    }

    if (segment && backorderMetric && fulfillmentMetric) {
      candidates.push(makeCandidate({
        question: `Where do ${humanize(backorderMetric)} and ${humanize(fulfillmentMetric)} look imbalanced across ${humanize(segment)}?`,
        intentType: "relationship_imbalance",
        requiredMetrics: [backorderMetric, fulfillmentMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "relationship",
        domain,
        priority: 94
      }));
    }

    if (segment && backorderMetric) {
      candidates.push(makeCandidate({
        question: `Where does stockout or backorder pressure appear concentrated across ${humanize(segment)}?`,
        intentType: "concentration",
        requiredMetrics: [backorderMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 90
      }));
    }

    if (segment && returnMetric) {
      candidates.push(makeCandidate({
        question: `Where do returns suggest risk across ${humanize(segment)}?`,
        intentType: "domain_investigation",
        requiredMetrics: [returnMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        domain,
        priority: 88
      }));
    }

    if (dateDimension && fulfillmentMetric) {
      candidates.push(makeCandidate({
        question: `Are there signs of a trend shift in ${humanize(fulfillmentMetric)}?`,
        intentType: "trend_change",
        requiredMetrics: [fulfillmentMetric],
        requiredDimensions: [dateDimension],
        groundingRequirement: "partial",
        domain,
        priority: 86
      }));
    }

    if (segment && costMetric && marginMetric) {
      candidates.push(makeCandidate({
        question: `Where does ${humanize(costMetric)} rise without ${humanize(marginMetric)} support across ${humanize(segment)}?`,
        intentType: "relationship_imbalance",
        requiredMetrics: [costMetric, marginMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "relationship",
        domain,
        priority: 92
      }));
    }

    addTrustQuestion();
  } else if (domain === "energy") {
    const segment = primaryDimension;
    const generationMetric = pickMetric(profile, [/solar|generation|production/]);
    const loadMetric = pickMetric(profile, [/load|demand|consumption/]);
    const importMetric = pickMetric(profile, [/import/]);
    const exportMetric = pickMetric(profile, [/export/]);

    if (segment && generationMetric) {
      candidates.push(makeCandidate({
        question: `Where does ${humanize(generationMetric)} look inconsistent across ${humanize(segment)}?`,
        intentType: "general_investigation",
        requiredMetrics: [generationMetric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 94
      }));
      candidates.push(makeCandidate({
        question: `Where does ${humanize(generationMetric)} vary most across ${humanize(segment)}?`,
        intentType: "segment_variance",
        requiredMetrics: [generationMetric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 88
      }));
    }

    if (importMetric && exportMetric) {
      candidates.push(makeCandidate({
        question: `Where do ${humanize(importMetric)} and ${humanize(exportMetric)} look imbalanced?`,
        intentType: "relationship_imbalance",
        requiredMetrics: [importMetric, exportMetric],
        requiredDimensions: segment ? [segment] : [],
        groundingRequirement: "partial",
        riskType: "relationship",
        domain,
        priority: 90
      }));
    }

    if (dateDimension && generationMetric) {
      candidates.push(makeCandidate({
        question: `How does ${humanize(generationMetric)} change over time?`,
        intentType: "trend_change",
        requiredMetrics: [generationMetric],
        requiredDimensions: [dateDimension],
        groundingRequirement: "partial",
        domain,
        priority: 86
      }));
    }

    if (loadMetric) {
      candidates.push(makeCandidate({
        question: `Can ${humanize(loadMetric)} be compared reliably across the dataset?`,
        intentType: "trust_caveat",
        requiredMetrics: [loadMetric],
        requiredDimensions: [],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 84
      }));
    }

    addTrustQuestion();
  } else {
    const segment = primaryDimension;
    const metric = pickMetric(profile, [/rate|margin|cost|revenue|sales|count|volume|score|duration|delay|total|amount/]) ?? getMetricNames(profile)[0] ?? null;
    const alternateMetric = pickMetricExcluding(profile, [/rate|margin|cost|revenue|sales|count|volume|score|duration|delay|total|amount/], [metric]);

    if (segment && metric) {
      candidates.push(makeCandidate({
        question: `Can ${humanize(metric)} be compared reliably by ${humanize(segment)}?`,
        intentType: "trust_caveat",
        requiredMetrics: [metric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "coverage",
        domain,
        priority: 90
      }));
      candidates.push(makeCandidate({
        question: `Where does ${humanize(metric)} look inconsistent across ${humanize(segment)}?`,
        intentType: "general_investigation",
        requiredMetrics: [metric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 86
      }));
      candidates.push(makeCandidate({
        question: `Is ${humanize(metric)} too concentrated in one ${humanize(segment)}?`,
        intentType: "concentration",
        requiredMetrics: [metric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        domain,
        priority: 80
      }));
      candidates.push(makeCandidate({
        question: `Where does ${humanize(metric)} vary most across ${humanize(segment)}?`,
        intentType: "segment_variance",
        requiredMetrics: [metric],
        requiredDimensions: [segment],
        groundingRequirement: "strong",
        domain,
        priority: 78
      }));
      if (alternateMetric) {
        candidates.push(makeCandidate({
          question: `Where does ${humanize(metric)} look high without matching ${humanize(alternateMetric)} across ${humanize(segment)}?`,
          intentType: "relationship_imbalance",
          requiredMetrics: [metric, alternateMetric],
          requiredDimensions: [segment],
          groundingRequirement: "partial",
          riskType: "relationship",
          domain,
          priority: 74
        }));
      }
    }

    if (dateDimension && metric) {
      candidates.push(makeCandidate({
        question: `How does ${humanize(metric)} change over time?`,
        intentType: "trend_change",
        requiredMetrics: [metric],
        requiredDimensions: [dateDimension],
        groundingRequirement: "partial",
        domain,
        priority: 76
      }));
    }

    addTrustQuestion();
  }

  return candidates;
}

function buildGeneralCandidates(profile: DatasetProfile, domain: SuggestedQuestionDomain): NativeSuggestedQuestion[] {
  const segment = preferredSegmentDimension(profile, domain);
  const metric = pickMetric(profile, [/rate|margin|cost|revenue|sales|count|volume|duration|delay|score|total|amount/]) ?? getMetricNames(profile)[0] ?? null;
  const alternateMetric = pickMetricExcluding(profile, [/rate|margin|cost|revenue|sales|count|volume|duration|delay|score|total|amount/], [metric]);
  const dateDimension = preferredDateDimension(profile);
  const candidates: NativeSuggestedQuestion[] = [];

  if (segment && metric) {
    candidates.push(makeCandidate({
      question: `Where does ${humanize(metric)} look inconsistent across ${humanize(segment)}?`,
      intentType: "general_investigation",
      requiredMetrics: [metric],
      requiredDimensions: [segment],
      groundingRequirement: "strong",
      domain,
      priority: 60
    }));
    candidates.push(makeCandidate({
      question: `Where does ${humanize(metric)} vary most across ${humanize(segment)}?`,
      intentType: "segment_variance",
      requiredMetrics: [metric],
      requiredDimensions: [segment],
      groundingRequirement: "strong",
      domain,
      priority: 58
    }));
    candidates.push(makeCandidate({
      question: `Which ${humanize(segment)} segments show concentrated risk?`,
      intentType: "concentration",
      requiredMetrics: [],
      requiredDimensions: [segment],
      groundingRequirement: "partial",
      riskType: "semantic_ambiguity",
      domain,
      priority: 56
    }));
    if (alternateMetric) {
      candidates.push(makeCandidate({
        question: `Where does ${humanize(metric)} look high without matching ${humanize(alternateMetric)} across ${humanize(segment)}?`,
        intentType: "relationship_imbalance",
        requiredMetrics: [metric, alternateMetric],
        requiredDimensions: [segment],
        groundingRequirement: "partial",
        riskType: "relationship",
        domain,
        priority: 52
      }));
    }
  }

  if (dateDimension && metric) {
    candidates.push(makeCandidate({
      question: `How does ${humanize(metric)} change over time?`,
      intentType: "trend_change",
      requiredMetrics: [metric],
      requiredDimensions: [dateDimension],
      groundingRequirement: "partial",
      domain,
      priority: 54
    }));
  }

  candidates.push(makeCandidate({
    question: "What areas deserve further investigation?",
    intentType: "general_investigation",
    requiredMetrics: [],
    requiredDimensions: [],
    groundingRequirement: "partial",
    domain,
    priority: 45
  }));

  return candidates;
}

function isVisualLookupQuestion(question: string) {
  const text = normalize(question);
  return (
    /^which\b/.test(text) &&
    /\b(highest|lowest|most|least|biggest|smallest|largest|fewest|best)\b/.test(text) &&
    !/\b(risk|reliab|caveat|limitation|inconsistent|imbalance|bottleneck|pressure|investigat)\b/.test(text)
  );
}

function hasUnsafeDomainLanguage(candidate: NativeSuggestedQuestion, domain: SuggestedQuestionDomain) {
  if (domain === "call_tracking" || domain === "marketing") {
    return false;
  }

  return /\b(roas|campaign efficiency|marketing attribution|qualified calls?|qualified call rate|qualified efficiency|cost per qualified|traffic source|campaigns?)\b/i.test(candidate.question);
}

function hasUnsafeDomainLanguageText(question: string, domain: SuggestedQuestionDomain) {
  if (domain === "call_tracking" || domain === "marketing") {
    return false;
  }

  return /\b(roas|campaign efficiency|marketing attribution|qualified calls?|qualified call rate|qualified efficiency|cost per qualified|traffic source|campaigns?)\b/i.test(question);
}

function isTrustOrCaveatQuestion(question: string) {
  return /\b(reliab|trust|caveat|coverage|confidence|limitation|can .* compared safely|can .* compared reliably|enough data)\b/i.test(question);
}

function isRelationshipQuestion(question: string) {
  return /\b(versus| vs |relative to|while|without|imbalance|imbalanced|matching|support|trade-off|tradeoff|keep up)\b/i.test(question);
}

function compactSemanticKey(value: string) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function valuesSemanticallyOverlap(left: string, right: string) {
  const leftKey = compactSemanticKey(left);
  const rightKey = compactSemanticKey(right);
  return leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey);
}

function requiredValuesAreUsed(requiredValues: string[], usedValues: Array<string | null | undefined>) {
  const concreteUsedValues = usedValues.filter(Boolean).map((value) => String(value));
  return requiredValues.some((required) =>
    concreteUsedValues.some((used) => valuesSemanticallyOverlap(required, used))
  );
}

function isUnrequestedCommercialMetric(metric: string | null | undefined) {
  return Boolean(metric && /\b(roas|revenue|spend|budget|commercial)\b/i.test(metric));
}

function allRequiredValuesAreUsed(requiredValues: string[], usedValues: Array<string | null | undefined>) {
  const concreteUsedValues = usedValues.filter(Boolean).map((value) => String(value));
  return requiredValues.every((required) =>
    concreteUsedValues.some((used) => valuesSemanticallyOverlap(required, used))
  );
}

function expandSemanticAliases(
  profile: DatasetProfile,
  values: Array<string | null | undefined>,
  kind: "metric" | "dimension"
) {
  const aliases = new Set(values.filter(Boolean).map((value) => String(value)));
  const contract = profile.semanticContract;
  const resolutions = kind === "metric" ? contract?.metricResolutions : contract?.dimensionResolutions;

  for (const value of [...aliases]) {
    for (const [key, resolution] of Object.entries(resolutions ?? {})) {
      if (
        valuesSemanticallyOverlap(value, key) ||
        resolution.sourceColumns.some((sourceColumn) => valuesSemanticallyOverlap(value, sourceColumn))
      ) {
        aliases.add(key);
        resolution.sourceColumns.forEach((sourceColumn) => aliases.add(sourceColumn));
      }
    }

    for (const [sourceColumn, canonical] of Object.entries(contract?.sourceToCanonical ?? {})) {
      if (valuesSemanticallyOverlap(value, sourceColumn) || valuesSemanticallyOverlap(value, canonical)) {
        aliases.add(sourceColumn);
        aliases.add(canonical);
      }
    }
  }

  return [...aliases];
}

function validateCandidate(
  candidate: NativeSuggestedQuestion,
  context: NativeSuggestedQuestionContext
): NativeSuggestedQuestionDecision {
  if (isVisualLookupQuestion(candidate.question)) {
    return {
      candidate,
      kept: false,
      reason: "Removed because the question is an obvious chart-reading lookup."
    };
  }

  if (hasUnsafeDomainLanguage(candidate, candidate.domain)) {
    return {
      candidate,
      kept: false,
      reason: "Removed because the wording uses marketing or attribution language outside a marketing domain."
    };
  }

  const { facts } = buildTrustedQuestionFacts(candidate.question, {
    rows: context.rows,
    profile: context.profile,
    input: { ...context.input, useAi: false }
  });

  const isTrustQuestion = candidate.intentType === "trust_caveat" || facts.routing.mode === "trust";
  const usedMetrics = [
    facts.evidence.primaryMetric,
    ...facts.evidence.metricsUsed,
    ...facts.groundingConfidence.metricGrounding.groundedMetrics
  ];
  const usedDimensions = [
    facts.evidence.primaryDimension,
    ...facts.evidence.dimensionsUsed,
    ...facts.groundingConfidence.dimensionGrounding.groundedDimensions
  ];

  const expandedRequiredMetrics = expandSemanticAliases(context.profile, candidate.requiredMetrics, "metric");
  const expandedUsedMetrics = expandSemanticAliases(context.profile, usedMetrics, "metric");
  const expandedRequiredDimensions = expandSemanticAliases(context.profile, candidate.requiredDimensions, "dimension");
  const expandedUsedDimensions = expandSemanticAliases(context.profile, usedDimensions, "dimension");

  const metricRequirementsMet =
    candidate.intentType === "relationship_imbalance"
      ? allRequiredValuesAreUsed(expandedRequiredMetrics, expandedUsedMetrics)
      : requiredValuesAreUsed(expandedRequiredMetrics, expandedUsedMetrics);

  if (candidate.requiredMetrics.length > 0 && !metricRequirementsMet) {
    return {
      candidate,
      kept: false,
      facts,
      reason: "Removed because Ask answered with a different metric than the candidate requires."
    };
  }

  if (
    candidate.requiredMetrics.length === 0 &&
    !isTrustQuestion &&
    candidate.domain !== "call_tracking" &&
    candidate.domain !== "marketing" &&
    isUnrequestedCommercialMetric(facts.evidence.primaryMetric)
  ) {
    return {
      candidate,
      kept: false,
      facts,
      reason: "Removed because Ask would answer with an unrequested commercial metric outside a marketing domain."
    };
  }

  if (
    candidate.intentType !== "trend_change" &&
    candidate.requiredDimensions.length > 0 &&
    !requiredValuesAreUsed(expandedRequiredDimensions, expandedUsedDimensions)
  ) {
    return {
      candidate,
      kept: false,
      facts,
      reason: "Removed because Ask answered with a different dimension than the candidate requires."
    };
  }

  if (facts.answerability.status === "unsupported") {
    return {
      candidate,
      kept: false,
      facts,
      reason: facts.answerability.reasons[0] ?? "Ask marks this question as unsupported."
    };
  }

  if (facts.answerability.status === "weak" && !isTrustQuestion) {
    return {
      candidate,
      kept: false,
      facts,
      reason: facts.answerability.reasons[0] ?? "Ask marks this question as weakly grounded."
    };
  }

  if (!isTrustQuestion && candidate.groundingRequirement === "strong" && facts.semanticAlignment.status !== "strong") {
    return {
      candidate,
      kept: false,
      facts,
      reason: `Removed because Ask semantic alignment is ${facts.semanticAlignment.status}, not strong.`
    };
  }

  if (!isTrustQuestion && candidate.groundingRequirement === "partial" && !["strong", "partial"].includes(facts.semanticAlignment.status)) {
    return {
      candidate,
      kept: false,
      facts,
      reason: `Removed because Ask semantic alignment is ${facts.semanticAlignment.status}.`
    };
  }

  if (
    candidate.intentType === "relationship_imbalance" &&
    !["strong", "partial"].includes(facts.groundingConfidence.relationshipGrounding.status)
  ) {
    return {
      candidate,
      kept: false,
      facts,
      reason: `Removed because relationship grounding is ${facts.groundingConfidence.relationshipGrounding.status}.`
    };
  }

  return {
    candidate,
    kept: true,
    facts,
    reason: "Ask can answer this candidate with acceptable grounding."
  };
}

export function validateSuggestedQuestionText(
  question: string,
  context: NativeSuggestedQuestionContext
): SuggestedQuestionTextValidationDecision {
  const domain = resolveSuggestedQuestionDomain(context.profile);
  if (isVisualLookupQuestion(question)) {
    return {
      question,
      kept: false,
      reason: "Removed because the follow-up is an obvious chart-reading lookup."
    };
  }

  if (hasUnsafeDomainLanguageText(question, domain)) {
    return {
      question,
      kept: false,
      reason: "Removed because the follow-up uses marketing or attribution language outside a marketing domain."
    };
  }

  if (domain !== "call_tracking" && domain !== "marketing" && /\b(spend|budget)\b/i.test(question)) {
    return {
      question,
      kept: false,
      reason: "Removed because the follow-up uses spend/budget language outside a strongly grounded marketing domain."
    };
  }

  const { facts } = buildTrustedQuestionFacts(question, {
    rows: context.rows,
    profile: context.profile,
    input: { ...context.input, useAi: false }
  });
  const trustQuestion = isTrustOrCaveatQuestion(question) || facts.routing.mode === "trust";

  if (facts.answerability.status === "unsupported") {
    return {
      question,
      kept: false,
      facts,
      reason: facts.answerability.reasons[0] ?? "Ask marks this follow-up as unsupported."
    };
  }

  if (facts.answerability.status === "weak" && !trustQuestion) {
    return {
      question,
      kept: false,
      facts,
      reason: facts.answerability.reasons[0] ?? "Ask marks this follow-up as weakly grounded."
    };
  }

  if (!trustQuestion && facts.semanticAlignment.status !== "strong") {
    return {
      question,
      kept: false,
      facts,
      reason: `Removed because Ask semantic alignment is ${facts.semanticAlignment.status}.`
    };
  }

  if (isRelationshipQuestion(question) && !["strong", "partial"].includes(facts.groundingConfidence.relationshipGrounding.status)) {
    return {
      question,
      kept: false,
      facts,
      reason: `Removed because relationship grounding is ${facts.groundingConfidence.relationshipGrounding.status}.`
    };
  }

  return {
    question,
    kept: true,
    facts,
    reason: "Ask can answer this follow-up with acceptable grounding."
  };
}

export function filterValidatedSuggestedQuestionTexts(
  questions: string[],
  context: NativeSuggestedQuestionContext,
  limit = 4
) {
  const decisions: SuggestedQuestionTextValidationDecision[] = [];
  const kept: string[] = [];

  for (const question of questions) {
    const trimmed = question.trim();
    if (!trimmed || kept.some((entry) => normalize(entry) === normalize(trimmed))) {
      continue;
    }

    const decision = validateSuggestedQuestionText(trimmed, context);
    decisions.push(decision);
    if (decision.kept) {
      kept.push(trimmed);
    }

    if (kept.length >= limit) {
      break;
    }
  }

  return {
    questions: kept,
    decisions
  };
}

function dedupeCandidates(candidates: NativeSuggestedQuestion[]) {
  const byQuestion = new Map<string, NativeSuggestedQuestion>();
  for (const candidate of candidates) {
    const key = normalize(candidate.question);
    const current = byQuestion.get(key);
    if (!current || candidate.priority > current.priority) {
      byQuestion.set(key, candidate);
    }
  }

  return [...byQuestion.values()].sort((left, right) => right.priority - left.priority);
}

function templateFamily(question: string) {
  const text = normalize(question);
  if (/reliability limitations|caveats? should we consider|decision confidence/.test(text)) {
    return "dataset_reliability";
  }
  if (/can .+ compared reliably|can .+ compared safely|enough data/.test(text)) {
    return "metric_reliability";
  }
  if (/change over time|trend shift/.test(text)) {
    return "trend_change";
  }
  if (/without matching|look imbalanced|look high without|rise without/.test(text)) {
    return "relationship_imbalance";
  }
  if (/vary most|behave differently/.test(text)) {
    return "segment_variance";
  }
  if (/look inconsistent/.test(text)) {
    return "metric_inconsistency";
  }
  if (/concentrated risk|too concentrated|pressure appear concentrated/.test(text)) {
    return "concentration";
  }
  if (/bottleneck|pressure|operational risk|service quality/.test(text)) {
    return "operational_risk";
  }
  return "general_investigation";
}

function missingCellShare(profile: DatasetProfile) {
  const totalCells = profile.rowCount * profile.columnCount;
  return totalCells > 0 ? profile.missingCells / totalCells : 0;
}

function allowsMoreTrustSuggestions(
  profile: DatasetProfile,
  domain: SuggestedQuestionDomain,
  validDecisions: NativeSuggestedQuestionDecision[]
) {
  const nonTrustCount = validDecisions.filter((decision) => decision.candidate.intentType !== "trust_caveat").length;
  const semanticConfidence = profile.semanticContract?.detectedDomain?.confidence ?? 0;
  return domain === "generic" || missingCellShare(profile) >= 0.15 || semanticConfidence < 0.55 || nonTrustCount < 3;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function datasetSelectionSeed(profile: DatasetProfile) {
  return [
    profile.rowCount,
    profile.columnCount,
    profile.missingCells,
    profile.numericColumns.join(","),
    profile.categoricalColumns.join(","),
    profile.datetimeColumns.join(","),
    profile.semanticContract?.detectedDomain?.domain ?? "unknown",
    profile.semanticContract?.detectedDomain?.detectedCapabilities.join(",") ?? ""
  ].join("|");
}

function rotateBuckets<T>(values: T[], seed: number) {
  if (values.length === 0) {
    return values;
  }
  const offset = seed % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function bucketOrderForDomain(domain: SuggestedQuestionDomain, seed: number): SuggestedQuestionBucket[] {
  const baseOrders: Record<SuggestedQuestionDomain, SuggestedQuestionBucket[]> = {
    call_tracking: [
      "quality",
      "missed_opportunity",
      "cost_efficiency",
      "revenue_reliability",
      "volume_value_relationship",
      "trend_change",
      "concentration_risk",
      "data_reliability",
      "general_investigation"
    ],
    marketing: [
      "quality",
      "revenue_reliability",
      "cost_efficiency",
      "volume_value_relationship",
      "trend_change",
      "concentration_risk",
      "data_reliability",
      "general_investigation"
    ],
    operations: [
      "operational_bottleneck",
      "missed_opportunity",
      "concentration_risk",
      "trend_change",
      "data_reliability",
      "general_investigation"
    ],
    retail: [
      "inventory_risk",
      "quality",
      "concentration_risk",
      "trend_change",
      "data_reliability",
      "general_investigation"
    ],
    energy: [
      "energy_balance",
      "trend_change",
      "concentration_risk",
      "data_reliability",
      "general_investigation"
    ],
    generic: [
      "general_investigation",
      "trend_change",
      "concentration_risk",
      "data_reliability"
    ]
  };

  return rotateBuckets(baseOrders[domain], seed);
}

function selectBalancedDecisions(
  validationDecisions: NativeSuggestedQuestionDecision[],
  profile: DatasetProfile,
  domain: SuggestedQuestionDomain,
  limit: number
) {
  const validDecisions = validationDecisions
    .filter((decision) => decision.kept)
    .sort((left, right) => right.candidate.priority - left.candidate.priority);
  const selected: NativeSuggestedQuestionDecision[] = [];
  const selectedQuestions = new Set<string>();
  const familyCounts = new Map<string, number>();
  const intentCounts = new Map<SuggestedQuestionIntentType, number>();
  const bucketCounts = new Map<SuggestedQuestionBucket, number>();
  const trustCap = allowsMoreTrustSuggestions(profile, domain, validDecisions) ? 2 : 1;
  const seed = stableHash(datasetSelectionSeed(profile));
  const bucketOrder = bucketOrderForDomain(domain, seed);

  const canSelect = (decision: NativeSuggestedQuestionDecision, relaxed: boolean) => {
    const questionKey = normalize(decision.candidate.question);
    if (selectedQuestions.has(questionKey)) {
      return false;
    }

    const intent = decision.candidate.intentType;
    const bucket = decision.candidate.bucket ?? inferQuestionBucket(decision.candidate);
    const family = templateFamily(decision.candidate.question);
    const familyLimit = relaxed ? 2 : 1;
    if ((familyCounts.get(family) ?? 0) >= familyLimit) {
      return false;
    }

    if ((bucketCounts.get(bucket) ?? 0) >= (relaxed ? 2 : 1)) {
      return false;
    }

    if (intent === "trust_caveat" && (intentCounts.get(intent) ?? 0) >= (relaxed ? Math.max(trustCap, 1) : trustCap)) {
      return false;
    }

    if (!relaxed && intent === "relationship_imbalance" && (intentCounts.get(intent) ?? 0) >= 1) {
      return false;
    }

    if (!relaxed && intent === "trend_change" && (intentCounts.get(intent) ?? 0) >= 1) {
      return false;
    }

    return true;
  };

  const addDecision = (decision: NativeSuggestedQuestionDecision) => {
    const questionKey = normalize(decision.candidate.question);
    const family = templateFamily(decision.candidate.question);
    const bucket = decision.candidate.bucket ?? inferQuestionBucket(decision.candidate);
    selectedQuestions.add(questionKey);
    selected.push(decision);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    intentCounts.set(decision.candidate.intentType, (intentCounts.get(decision.candidate.intentType) ?? 0) + 1);
  };

  const selectByBucket = (relaxed: boolean) => {
    let selectedInPass = 0;
    for (const bucket of bucketOrder) {
      if (selected.length >= limit) {
        break;
      }
      const decision = validDecisions.find((candidateDecision) => {
        const candidateBucket = candidateDecision.candidate.bucket ?? inferQuestionBucket(candidateDecision.candidate);
        return candidateBucket === bucket && canSelect(candidateDecision, relaxed);
      });
      if (decision) {
        addDecision(decision);
        selectedInPass += 1;
      }
    }
    return selectedInPass;
  };

  while (selected.length < limit) {
    if (selectByBucket(false) === 0) {
      break;
    }
  }

  while (selected.length < Math.min(limit, 3)) {
    if (selectByBucket(true) === 0) {
      break;
    }
  }

  for (const decision of validDecisions) {
    if (selected.length >= limit) {
      break;
    }
    if (canSelect(decision, true)) {
      addDecision(decision);
    }
  }

  return selected;
}

export function buildNativeSuggestedQuestions(
  context: NativeSuggestedQuestionContext,
  limit = 5
): NativeSuggestedQuestionsResult {
  const domain = resolveSuggestedQuestionDomain(context.profile);
  const candidates = dedupeCandidates([
    ...buildDomainCandidates(context.profile, domain),
    ...buildGeneralCandidates(context.profile, domain)
  ]);
  const validationDecisions = candidates.map((candidate) => validateCandidate(candidate, context));
  const selectedDecisions = selectBalancedDecisions(validationDecisions, context.profile, domain, limit);
  const selectedQuestions = new Set(selectedDecisions.map((decision) => normalize(decision.candidate.question)));
  const decisions = validationDecisions.map((decision) => {
    if (!decision.kept || selectedQuestions.has(normalize(decision.candidate.question))) {
      return decision;
    }

    return {
      ...decision,
      kept: false,
      reason: "Removed by final diversity balancing to avoid repetitive or trust-heavy suggestions."
    };
  });
  const kept = selectedDecisions.map((decision) => decision.candidate.question);

  return {
    questions: kept,
    candidates,
    decisions
  };
}
