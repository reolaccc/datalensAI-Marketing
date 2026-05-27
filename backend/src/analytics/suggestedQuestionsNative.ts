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
  | "concentration";

export type SuggestedQuestionDomain =
  | "call_tracking"
  | "marketing"
  | "operations"
  | "retail"
  | "energy"
  | "generic";

export interface NativeSuggestedQuestion {
  question: string;
  intentType: SuggestedQuestionIntentType;
  requiredMetrics: string[];
  requiredDimensions: string[];
  groundingRequirement: "strong" | "partial";
  riskType?: "coverage" | "semantic_ambiguity" | "ratio_validity" | "relationship";
  domain: SuggestedQuestionDomain;
  priority: number;
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

function resolveSuggestedQuestionDomain(profile: DatasetProfile): SuggestedQuestionDomain {
  const contract = profile.semanticContract;
  const semanticDomain = contract?.detectedDomain?.domain;
  const metrics = getMetricNames(profile);
  const dimensions = getDimensionNames(profile);
  const allNames = [...metrics, ...dimensions, ...profile.columns.map((column) => column.name)];

  if (semanticDomain === "call_tracking" || semanticDomain === "mixed_call_tracking_attribution") {
    return "call_tracking";
  }
  if (semanticDomain === "marketing_attribution") {
    return "marketing";
  }
  if (semanticDomain === "call_operations") {
    return "operations";
  }
  if (hasNamedSignal(allNames, [/warehouse|sku|inventory|stock|backorder|fulfilled|fulfillment|markdown|margin|return/])) {
    return "retail";
  }
  if (hasNamedSignal(allNames, [/solar|grid|load|generation|production|import|export|kwh|energy/])) {
    return "energy";
  }
  if (hasNamedSignal(allNames, [/queue|team|agent|ticket|resolution|response|escalat|reopen|service line|priority/])) {
    return "operations";
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

function makeCandidate(params: NativeSuggestedQuestion): NativeSuggestedQuestion {
  return params;
}

function buildDomainCandidates(profile: DatasetProfile, domain: SuggestedQuestionDomain): NativeSuggestedQuestion[] {
  const candidates: NativeSuggestedQuestion[] = [];
  const primaryDimension = preferredSegmentDimension(profile, domain);
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
        priority: 92
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
        priority: 88
      }));
    }

    addTrustQuestion();
  } else if (domain === "operations") {
    const segment = pickDimension(profile, [/queue|team|service|agent|location|region/]) ?? primaryDimension;
    const hasMissed = hasMetric(profile, [/missed|failed|abandon/]);
    const durationMetric = pickMetric(profile, [/duration|talk|wait|handle|resolution|response/]);
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
    }

    addTrustQuestion();
  }

  return candidates;
}

function buildGeneralCandidates(profile: DatasetProfile, domain: SuggestedQuestionDomain): NativeSuggestedQuestion[] {
  const segment = preferredSegmentDimension(profile, domain);
  const metric = pickMetric(profile, [/rate|margin|cost|revenue|sales|count|volume|duration|delay|score|total|amount/]) ?? getMetricNames(profile)[0] ?? null;
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
      question: `Which ${humanize(segment)} segments show concentrated risk?`,
      intentType: "concentration",
      requiredMetrics: [],
      requiredDimensions: [segment],
      groundingRequirement: "partial",
      riskType: "semantic_ambiguity",
      domain,
      priority: 56
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

export function buildNativeSuggestedQuestions(
  context: NativeSuggestedQuestionContext,
  limit = 5
): NativeSuggestedQuestionsResult {
  const domain = resolveSuggestedQuestionDomain(context.profile);
  const candidates = dedupeCandidates([
    ...buildDomainCandidates(context.profile, domain),
    ...buildGeneralCandidates(context.profile, domain)
  ]);
  const decisions: NativeSuggestedQuestionDecision[] = [];
  const kept: string[] = [];

  for (const candidate of candidates) {
    const decision = validateCandidate(candidate, context);
    decisions.push(decision);

    if (decision.kept && !kept.some((question) => normalize(question) === normalize(candidate.question))) {
      kept.push(candidate.question);
    }

    if (kept.length >= limit) {
      break;
    }
  }

  return {
    questions: kept,
    candidates,
    decisions
  };
}
