import type { AnalyticsFacts } from "./types.js";
import { getExecutiveAnalystFrame } from "../analytics/semantic-governance/index.js";
import { polishExecutiveSignalForAnalyst } from "./semanticPhrasing.js";

type ExecutiveInsightKpiFact = AnalyticsFacts["kpiCards"][number];

export type ExecutiveInsightDomain = "call_tracking" | "marketing" | "operations" | "retail" | "energy" | "crm" | "generic";

export type ExecutiveInsightSignalType = "risk" | "trend" | "concentration" | "reliability" | "efficiency" | "variance" | "relationship";

export interface ExecutiveInsightSignal {
  type: ExecutiveInsightSignalType;
  metric: string;
  dimension?: string;
  strength: "strong" | "partial";
  evidence: string;
  implication: string;
  reliability?: string;
  domain: ExecutiveInsightDomain;
  source: "fact" | "chart" | "kpi";
  relationshipCategory?: ExecutiveInsightRelationshipCategory;
}

type ExecutiveInsightRelationshipCategory =
  | "quality_vs_revenue"
  | "pressure_coupling"
  | "cost_vs_outcome"
  | "generation_vs_load"
  | "pipeline_dependency"
  | "stage_imbalance"
  | "concentration_vs_trend";

export interface ExecutiveInsightFacts {
  domain: ExecutiveInsightDomain;
  analystFrame:
    | "performance marketing analyst"
    | "operations analyst"
    | "commercial operations analyst"
    | "pipeline operations analyst"
    | "operational usage analyst"
    | "cautious business analyst";
  signals: ExecutiveInsightSignal[];
  reliabilityCaveats: string[];
  rejectedSignals: Array<{ reason: string; evidence?: string }>;
}

function normalize(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function humanize(value?: string | null) {
  const acronyms = new Set(["roas", "roi", "cpqc", "cpa", "cpc", "kwh", "csat", "kpi"]);
  return normalize(value?.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .split(" ")
    .filter(Boolean)
    .map((part) => (acronyms.has(part) ? part.toUpperCase() : part))
    .join(" ");
}

function publicLabel(value?: string | null) {
  return humanize(value)
    .replace(/\bqualified leads qualified calls\b/gi, "qualified calls")
    .replace(/\bconverted call\b/gi, "converted calls")
    .replace(/\bqualified call\b/gi, "qualified calls")
    .replace(/\bmissed call\b/gi, "missed calls")
    .replace(/\btalktime\b/gi, "talk time")
    .replace(/\bcallvolume\b/gi, "call volume")
    .replace(/\bfulfilledorders\b/gi, "fulfilled orders")
    .replace(/\bsource channel account\b/gi, "source channels account for")
    .replace(/\bsource channel\b/gi, "source channel")
    .replace(/\bsales value aud\b/gi, "sales value")
    .replace(/\bestimated pipeline value aud\b/gi, "estimated pipeline value")
    .replace(/\brealized revenue aud\b/gi, "realized revenue")
    .replace(/\bcase count\b/gi, "case count")
    .replace(/\bsegment labels\b/gi, "segments")
    .replace(/\bsegment label\b/gi, "segment")
    .replace(/\bsolar kwh\b/gi, "solar output")
    .replace(/\bload kwh\b/gi, "load")
    .replace(/\bgrid import kwh\b/gi, "grid import")
    .replace(/\bgrid export kwh\b/gi, "grid export")
    .replace(/\brevenue from calls\b/gi, "revenue");
}

function includesAny(text: string, terms: string[]) {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(term));
}

function countTermHits(text: string, terms: string[]) {
  const normalized = normalize(text);
  return terms.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
}

function hasAnyTerm(text: string, terms: string[]) {
  return countTermHits(text, terms) > 0;
}

function displayDimension(value?: string | null) {
  return publicLabel(value)
    .replace(/\bTraffic Src\b/i, "traffic source")
    .replace(/\bMkt Medium\b/i, "marketing medium")
    .replace(/\bLast Touch Channel\b/i, "contact channel")
    .replace(/\bRegion Name\b/i, "region")
    .replace(/\bGroup Name\b/i, "group")
    .replace(/\bSrc\b/i, "source");
}

function humanizeKpiContextLine(value?: string | null) {
  return (value ?? "")
    .replace(/\bTraffic Src\b/g, "traffic source")
    .replace(/\bMkt Medium\b/g, "marketing medium")
    .replace(/\bSrc\b/g, "source");
}

function sentenceCase(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function usesPluralVerb(value: string) {
  const normalized = normalize(value);
  return (
    normalized.endsWith("s") ||
    includesAny(normalized, [
      "calls",
      "orders",
      "leads",
      "journeys",
      "stages",
      "results",
      "units"
    ])
  );
}

function pluralizeDimensionLabel(value: string) {
  const normalized = normalize(value);
  if (!normalized) {
    return "segments";
  }
  if (normalized.endsWith("s")) {
    return value;
  }
  if (normalized.endsWith("y") && !/[aeiou]y$/.test(normalized)) {
    return `${value.slice(0, -1)}ies`;
  }
  return `${value}s`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function sameDimensionFamily(left?: string | null, right?: string | null) {
  const leftNormalized = normalize(left);
  const rightNormalized = normalize(right);
  if (!leftNormalized || !rightNormalized) {
    return false;
  }
  if (leftNormalized === rightNormalized) {
    return true;
  }
  const channelish = ["traffic source", "source", "channel", "medium", "marketing medium", "customer journey"];
  const operational = ["service line", "queue", "agent team", "team", "site", "warehouse", "category"];
  const inSameBucket = (bucket: string[]) => bucket.some((term) => leftNormalized.includes(term)) && bucket.some((term) => rightNormalized.includes(term));
  return inSameBucket(channelish) || inSameBucket(operational);
}

function normalizeEntityName(value?: string | null) {
  return normalize(value).replace(/\btotal\b/g, "").trim();
}

function semanticText(facts: AnalyticsFacts) {
  return [
    facts.semanticContract?.detectedDomain?.domain,
    ...(facts.semanticContract?.detectedDomain?.detectedCapabilities ?? []),
    ...facts.profile.numericColumns,
    ...facts.profile.categoricalColumns,
    ...facts.profile.datetimeColumns,
    ...facts.kpiCards.map((kpi) => `${kpi.label} ${kpi.formula} ${kpi.description}`),
    ...facts.charts.flatMap((chart) => [chart.title, chart.metric ?? "", chart.dimension ?? "", chart.businessArea ?? ""])
  ].join(" ");
}

export function resolveExecutiveInsightDomain(facts: AnalyticsFacts): ExecutiveInsightDomain {
  const domain = facts.semanticContract?.detectedDomain?.domain;
  const text = semanticText(facts);
  const marketingHits = countTermHits(text, [
    "campaign",
    "ad group",
    "traffic source",
    "marketing medium",
    "paid search",
    "paid social",
    "channel mix",
    "roas",
    "cpqc",
    "ad spend"
  ]);
  const explicitCallFieldHits = countTermHits(text, [
    "call start",
    "call outcome",
    "caller number",
    "tracking number",
    "missed call",
    "wait time",
    "duration sec",
    "talk time",
    "call answered"
  ]);
  const operationsHits = countTermHits(text, [
    "queue",
    "service line",
    "agent",
    "response time",
    "resolution",
    "talk time",
    "wait time",
    "reopen",
    "escalation",
    "csat"
  ]);
  const strongOperationsHits = countTermHits(text, [
    "service line",
    "response time",
    "resolution",
    "talk time",
    "wait time",
    "reopen",
    "escalation",
    "csat"
  ]);
  const crmHits = countTermHits(text, [
    "crm",
    "customer journey",
    "lifecycle",
    "pipeline",
    "lead stage",
    "sales stage",
    "stage",
    "callback",
    "recontact",
    "follow up",
    "follow-up",
    "estimated value",
    "opportunity"
  ]);
  const crmIdHit = hasAnyTerm(text, ["crm record", "lead id", "customer id", "opportunity id"]);
  const crmStageHit = hasAnyTerm(text, ["customer journey", "journey stage", "lifecycle", "pipeline", "lead stage", "sales stage", "stage progression"]);
  const crmFollowUpHit = hasAnyTerm(text, ["callback", "callback required", "recontact", "follow up", "follow-up", "contact attempts"]);
  const crmOwnerHit = hasAnyTerm(text, ["owner team", "account owner", "sales owner", "agent queue"]);
  const crmOutcomeHit = hasAnyTerm(text, ["opportunity", "closed won", "closed outcomes", "closed won count", "opportunity created"]);
  const crmValueHit = hasAnyTerm(text, ["estimated value", "estimated pipeline value", "realized revenue", "revenue"]);
  const crmClusterCount = [crmIdHit, crmStageHit, crmFollowUpHit, crmOwnerHit, crmOutcomeHit, crmValueHit].filter(Boolean).length;
  const strongCrmHits = [crmStageHit, crmFollowUpHit, crmOwnerHit, crmOutcomeHit, crmValueHit].filter(Boolean).length;
  const strongCrmOverride =
    explicitCallFieldHits < 2 &&
    marketingHits < 3 &&
    (
      (crmStageHit && (crmFollowUpHit || crmOwnerHit || crmOutcomeHit)) ||
      (crmFollowUpHit && crmOutcomeHit && crmValueHit) ||
      (crmStageHit && crmClusterCount >= 3)
    );

  if (strongCrmOverride) {
    return "crm";
  }
  if (domain === "call_tracking" || domain === "mixed_call_tracking_attribution") {
    return "call_tracking";
  }
  if (includesAny(text, ["solar", "generation kwh", "load kwh", "grid import", "grid export", "battery", "kwh"])) {
    return "energy";
  }
  if (includesAny(text, ["inventory", "stock", "stockout", "backorder", "warehouse", "supplier", "fulfillment", "return rate", "gross margin", "margin"])) {
    return "retail";
  }
  if (
    domain === "call_operations" ||
    strongOperationsHits >= 1 ||
    operationsHits >= 3
  ) {
    return "operations";
  }
  if (strongCrmOverride) {
    return "crm";
  }
  if (
    domain === "marketing_attribution" &&
    includesAny(text, ["campaign", "ad group", "source", "medium", "attribution", "roas", "qualified", "lead", "conversion"])
  ) {
    return "marketing";
  }
  if (
    domain === "generic_business" &&
    crmStageHit &&
    strongCrmHits >= 2 &&
    explicitCallFieldHits < 2 &&
    !includesAny(text, ["campaign", "ad group", "marketing medium", "paid search", "traffic source"])
  ) {
    return "crm";
  }
  if (
    (crmStageHit && strongCrmHits >= 3) ||
    (crmHits >= 5 &&
      crmStageHit &&
      explicitCallFieldHits < 2 &&
      !includesAny(text, ["campaign", "ad group", "marketing medium"]))
  ) {
    return "crm";
  }
  return "generic";
}

// Executive Insight consumes governed domain packs. New wording or relationship
// semantics should be added as isolated domain-pack rules, not as generic core
// analytics behavior and not as dataset-specific exceptions.
function analystFrame(domain: ExecutiveInsightDomain): ExecutiveInsightFacts["analystFrame"] {
  return getExecutiveAnalystFrame(domain);
}

function constrainDomainWithDataSummary(domain: ExecutiveInsightDomain, facts: AnalyticsFacts): ExecutiveInsightDomain {
  const notes = normalize((facts.datasetSummary.dataSummaryNotes ?? []).join(" "));
  const dsSignalsGenericCaution =
    includesAny(notes, [
      "domain grounding is partial",
      "business meaning is not assumed",
      "business meaning should stay neutral",
      "avoid business-specific interpretation",
      "avoid financial interpretation"
    ]);
  const dsHasDomainGrounding = includesAny(notes, [
    "available call-tracking fields",
    "available crm fields",
    "available retail operations fields",
    "available energy fields",
    "available support operations fields",
    "call volume can be read"
  ]);

  if (dsSignalsGenericCaution && !dsHasDomainGrounding) {
    return "generic";
  }

  return domain;
}

function classifyMetric(metric: string): ExecutiveInsightSignalType {
  if (includesAny(metric, ["missed", "delay", "wait", "reopen", "escalation", "stockout", "backorder", "return", "error", "failure"])) {
    return "risk";
  }
  if (includesAny(metric, ["roas", "cpqc", "cost per", "efficiency", "spend"])) {
    return "efficiency";
  }
  if (includesAny(metric, ["rate", "ratio", "margin", "qualified", "conversion", "duration", "load", "generation"])) {
    return "variance";
  }
  return "concentration";
}

function implicationFor(domain: ExecutiveInsightDomain, metric: string, dimension?: string) {
  const metricLabel = publicLabel(metric) || "This metric";
  const dimensionLabel = displayDimension(dimension) || "segment";
  const normalized = normalize(metric);

  if (domain === "call_tracking") {
    if (includesAny(normalized, ["missed"])) {
      return `Opportunity leakage may be operational rather than purely acquisition-driven, so missed-call pressure should be reviewed by ${dimensionLabel}.`;
    }
    if (includesAny(normalized, ["qualified", "conversion"])) {
      return `${dimensionLabel} comparisons should include quality, not volume alone.`;
    }
    if (includesAny(normalized, ["duration", "wait"])) {
      return `Call handling patterns may reveal operational friction behind the acquisition result.`;
    }
    if (includesAny(normalized, ["revenue", "value"])) {
      return `${dimensionLabel} allocation should be checked against call quality and coverage before treating the current leader as the strongest long-term source.`;
    }
    return `${dimensionLabel} differences should be treated as performance variation, not as a standalone acquisition verdict.`;
  }

  if (domain === "operations") {
    if (includesAny(normalized, ["missed", "wait", "response", "escalation", "reopen"])) {
      return `Service pressure appears uneven, so the most affected ${dimensionLabel} may warrant further capacity review.`;
    }
    return `That pattern may indicate uneven service load, so the ${dimensionLabel} mix is worth reviewing before calling it a bottleneck.`;
  }

  if (domain === "retail") {
    if (includesAny(normalized, ["stock", "backorder", "fulfillment", "return", "margin"])) {
      return `Operational pressure appears uneven, so the most exposed ${dimensionLabel} may warrant further inventory or fulfillment review.`;
    }
    return `${dimensionLabel} differences appear commercially meaningful, so the weak end of the spread is worth reviewing before drawing a broader assortment conclusion.`;
  }

  if (domain === "energy") {
    if (includesAny(normalized, ["solar", "generation"])) {
      return `This may reflect generation-driven variability, so site-level review should check whether supply swings explain the operating pattern.`;
    }
    if (includesAny(normalized, ["load", "import", "export", "battery"])) {
      return `Site behavior appears uneven, so the next review should separate stable demand from grid or storage variability.`;
    }
    return `That signal is best used to isolate where operating variability is coming from across sites or time periods.`;
  }

  if (domain === "crm") {
    if (includesAny(normalized, ["lead volume", "qualified leads", "closed-won outcomes", "closed won"])) {
      return `Conversion progression appears uneven, so early-stage lead volume is worth comparing with downstream closed-won follow-through.`;
    }
    if (includesAny(normalized, ["estimated value", "revenue", "value"])) {
      return `Pipeline value appears unevenly distributed, so journey concentration should be reviewed alongside downstream progression quality.`;
    }
    if (includesAny(normalized, ["callback", "recontact", "follow up", "follow-up"])) {
      return `Follow-up behavior appears concentrated, so recontact effort may warrant review before treating the pipeline as broadly balanced.`;
    }
    if (includesAny(normalized, ["stage", "lifecycle", "pipeline"])) {
      return `Stage progression appears uneven, so early-stage volume and closed-stage follow-through should be reviewed separately.`;
    }
    return `The pattern looks pipeline-relevant, so customer journeys or stages carrying uneven load are worth reviewing.`;
  }

  if (includesAny(normalized, ["revenue", "margin", "value"])) {
    return `${dimensionLabel} differences look meaningful enough to investigate, but coverage should be checked before treating the leader as decision-grade.`;
  }
  return `The pattern is worth investigating further, but follow-up should stay anchored to the observed metric rather than a broader performance story.`;
}

function isDomainUnsafe(text: string, domain: ExecutiveInsightDomain) {
  const normalized = normalize(text);
  if (/(row count|column count|number of fields|columns with outlier|date range|commercial review|broad exploratory analysis|campaign message|budget reduction|budget pressure|total activity)/.test(normalized)) {
    return true;
  }
  if (domain === "energy" && /(campaign|roas|marketing|ad spend|budget allocation|revenue generated)/.test(normalized)) {
    return true;
  }
  if ((domain === "operations" || domain === "retail" || domain === "generic") && /(campaign message|roas improvement|performance marketing|ad group|budget pressure|budget should)/.test(normalized)) {
    return true;
  }
  if (domain === "crm" && /(budget allocation|roas improvement|campaign performance|ad group|scale aggressively|push more budget)/.test(normalized)) {
    return true;
  }
  return false;
}

function metricLabelForKpi(kpi: ExecutiveInsightKpiFact, domain: ExecutiveInsightDomain) {
  const formula = normalize(kpi.formula);
  const label = normalize(kpi.label);
  if (domain === "generic" && includesAny(`${label} ${formula}`, ["revenue", "sales", "income", "gmv", "value", "return amount"])) {
    return "Observed value";
  }
  if (domain === "crm") {
    if (includesAny(`${label} ${formula}`, ["estimated value", "estimated pipeline value"])) {
      return "Estimated value";
    }
    if (includesAny(`${label} ${formula}`, ["revenue", "realized revenue"])) {
      return "Realized revenue";
    }
    if (includesAny(`${label} ${formula}`, ["callback", "follow up", "follow-up", "contact attempts"])) {
      return "Follow-up pressure";
    }
    if (includesAny(`${label} ${formula}`, ["closed won", "opportunity"])) {
      return "Closed-won outcomes";
    }
  }
  if (domain === "energy") {
    if (formula.includes("solar generation")) {
      return "Solar generation";
    }
    if (formula.includes("load")) {
      return "Load";
    }
    if (formula.includes("grid import")) {
      return "Grid import";
    }
    if (formula.includes("grid export")) {
      return "Grid export";
    }
    if (label === "spend" || formula.includes("cost")) {
      return "Energy cost";
    }
  }
  if (domain === "retail") {
    if (formula.includes("fulfilled orders")) {
      return "Fulfilled orders";
    }
    if (formula.includes("fulfillment cost")) {
      return "Fulfillment cost";
    }
    if (formula.includes("gross margin")) {
      return "Gross margin";
    }
    if (formula.includes("backorder")) {
      return "Backorder pressure";
    }
    if (label === "spend" && formula.includes("cost")) {
      return "Fulfillment cost";
    }
  }
  return kpi.label;
}

function parseKpiContext(contextLine: string) {
  const topMatch = contextLine.match(/top\s+([^:]+):\s*([^.;]+)/i);
  if (topMatch) {
    return {
      type: "top" as const,
      dimension: topMatch[1].trim(),
      leader: topMatch[2].trim()
    };
  }

  const bestWorstMatch = contextLine.match(/best:\s*([^·;|]+)\s*[·|]\s*worst:\s*([^.;]+)/i);
  if (bestWorstMatch) {
    return {
      type: "best_worst" as const,
      best: bestWorstMatch[1].trim(),
      worst: bestWorstMatch[2].trim()
    };
  }

  return null;
}

function buildKpiEvidence(metric: string, dimension: string | undefined, parsedContext: ReturnType<typeof parseKpiContext>) {
  const metricLabel = sentenceCase(publicLabel(metric));
  const dimensionLabel = displayDimension(dimension) || "segment";

  if (!parsedContext) {
    return null;
  }

  if (parsedContext.type === "top") {
    const sourceDimension = displayDimension(parsedContext.dimension) || dimensionLabel;
    return `${parsedContext.leader} is the main ${sourceDimension} driver for ${metricLabel.toLowerCase()}, rather than the result being evenly spread across ${sourceDimension}.`;
  }

  return `Across ${dimensionLabel}, ${metricLabel.toLowerCase()} ${usesPluralVerb(metricLabel) ? "run" : "runs"} strongest in ${parsedContext.best} and weakest in ${parsedContext.worst}.`;
}

function isWeakGenericDimension(value?: string | null) {
  return includesAny(value ?? "", ["note", "message", "description", "comment", "label", "status", "stage", "flag"]);
}

function isUnsafeCrmDimension(value?: string | null) {
  return includesAny(value ?? "", ["campaign", "ad group", "advertising", "marketing medium", "paid search", "paid social"]);
}

function buildKpiSignal(kpi: ExecutiveInsightKpiFact, domain: ExecutiveInsightDomain): ExecutiveInsightSignal | null {
  if (kpi.reliability === "low") {
    return null;
  }
  const metric = metricLabelForKpi(kpi, domain);
  if (normalize(metric) === "total activity") {
    return null;
  }
  const dimension = kpi.relatedDimension;
  const contextLine = humanizeKpiContextLine(kpi.contextLine);
  const parsedContext = parseKpiContext(contextLine);
  const parsedDimension = parsedContext?.type === "top" ? parsedContext.dimension : dimension;
  if (domain === "generic" && isWeakGenericDimension(parsedDimension)) {
    return null;
  }
  if (domain === "crm" && isUnsafeCrmDimension(parsedDimension)) {
    return null;
  }
  const evidence = buildKpiEvidence(metric, dimension, parsedContext);
  if (!evidence) {
    return null;
  }
  const reliability =
    kpi.reliability === "medium" || (kpi.warnings?.length ?? 0) > 0
      ? "Coverage is incomplete, so the spread should be treated as directional rather than decision-grade."
      : undefined;

  return {
    type: classifyMetric(metric),
    metric,
    dimension,
    strength: kpi.reliability === "high" ? "strong" : "partial",
    evidence,
    implication: implicationFor(domain, metric, dimension),
    reliability,
    domain,
    source: "kpi"
  };
}

function resolveTopLeaderFromKpiCards(
  facts: AnalyticsFacts,
  domain: ExecutiveInsightDomain,
  metricTerms: string[]
): { dimension?: string; name: string; share?: number } | null {
  const kpi = facts.kpiCards.find((card) => includesAny(metricLabelForKpi(card, domain), metricTerms));
  if (!kpi?.contextLine) {
    return null;
  }

  const parsedContext = parseKpiContext(humanizeKpiContextLine(kpi.contextLine));
  if (parsedContext?.type !== "top") {
    return null;
  }

  return {
    dimension: kpi.relatedDimension ?? parsedContext.dimension,
    name: parsedContext.leader
  };
}

function buildConcentrationSignal(facts: AnalyticsFacts, domain: ExecutiveInsightDomain): ExecutiveInsightSignal | null {
  const topEntity = facts.concentration.top1RevenueEntity;
  const top3Share = facts.concentration.top3RevenueShare;

  if (!topEntity || top3Share === undefined) {
    return null;
  }

  const metricLabel = domain === "generic" ? "observed value concentration" : "revenue concentration";
  const valueLabel = domain === "generic" ? "observed value" : "revenue";
  const implication =
    domain === "call_tracking" || domain === "marketing"
      ? "The commercial result may depend on a narrow part of the channel mix, so the leading source is worth reviewing alongside call quality before investment decisions are treated as settled."
      : domain === "crm"
        ? "Pipeline value appears concentrated in a small part of the journey mix, so the heaviest stages or journeys are worth reviewing alongside progression quality."
      : domain === "retail"
        ? "The commercial result appears concentrated in a small part of the assortment, so leading categories are worth reviewing alongside inventory and margin coverage."
        : domain === "generic"
          ? "The measured result appears concentrated in a narrow part of the dataset, but the metric should stay neutral until the domain meaning is better grounded."
        : "The headline result appears to be driven by a narrow part of the dataset rather than broad-based performance.";

  return {
    type: "concentration",
    metric: metricLabel,
    dimension: topEntity.dimension,
    strength: "strong",
    evidence: `${topEntity.name} contributes ${formatPercent(topEntity.share)} of ${valueLabel}, and the top 3 ${pluralizeDimensionLabel(displayDimension(topEntity.dimension).toLowerCase())} account for ${formatPercent(top3Share)} overall.`,
    implication,
    domain,
    source: "fact"
  };
}

function buildEfficiencyMismatchSignal(facts: AnalyticsFacts, domain: ExecutiveInsightDomain): ExecutiveInsightSignal | null {
  const mismatch = facts.comparisons.revenueVsEfficiencyMismatches[0];
  if (!mismatch) {
    return null;
  }

  return {
    type: "efficiency",
    metric: "revenue versus efficiency",
    strength: "strong",
    evidence: mismatch.note,
    implication:
      domain === "call_tracking" || domain === "marketing"
        ? "Scale and return are not lining up cleanly, so channel decisions should weigh efficiency against raw volume before the current mix is treated as settled."
        : "The gap suggests the headline leader is not automatically the best operating choice once efficiency is considered.",
    domain,
    source: "fact"
  };
}

function buildTrendSignal(facts: AnalyticsFacts, domain: ExecutiveInsightDomain): ExecutiveInsightSignal | null {
  const trendChart = facts.charts.find((chart) => chart.analysisRole === "trend" && chart.keyObservation && chart.metric);
  if (!trendChart?.keyObservation) {
    return null;
  }

  let metric = publicLabel(trendChart.metric ?? trendChart.title);
  if (domain === "crm") {
    if (includesAny(metric, ["calls", "call volume", "lead count"])) {
      metric = "Lead volume";
    } else if (includesAny(metric, ["revenue"])) {
      metric = "Realized revenue";
    } else if (includesAny(metric, ["estimated value", "pipeline value"])) {
      metric = "Estimated value";
    } else if (includesAny(metric, ["callback", "follow up", "follow-up", "contact attempts"])) {
      metric = "Follow-up pressure";
    }
  }
  if (domain === "generic" && includesAny(metric, ["revenue", "sales", "income", "gmv", "value"])) {
    metric = "Observed value";
  }
  const evidence = humanizeChartEvidence(trendChart.keyObservation);
  const crmEvidence =
    domain === "crm" && metric === "Lead volume"
      ? evidence.replace(/^Calls\b/, "Lead volume").replace(/\bcalls\b/g, "lead volume")
      : domain === "crm" && metric === "Realized revenue"
      ? evidence.replace(/^Revenue\b/, "Realized revenue")
      : domain === "crm" && metric === "Estimated value"
      ? evidence.replace(/^Revenue\b/, "Estimated value")
      : domain === "generic" && metric === "Observed value"
        ? evidence
            .replace(/^Revenue\b/, "Observed value")
            .replace(/\brevenue\b/g, "observed value")
            .replace(/\bsales value\b/gi, "observed value")
      : evidence;
  const normalizedMetric = normalize(metric);
  const implication =
    domain === "call_tracking" || domain === "marketing"
      ? "Demand does not appear fully stable, so performance is better read from the direction of movement rather than the latest point alone."
      : domain === "energy"
        ? "Operating variability is showing up over time, so follow-up review can separate supply movement from site behavior before treating the swing as settled."
        : domain === "operations"
          ? "Operational load appears to vary across the period, so the timing of the swings is worth reviewing before drawing a staffing conclusion."
          : domain === "retail"
            ? includesAny(normalizedMetric, ["cost", "spend", "fulfillment"])
            ? "Fulfillment pressure appears to change over time rather than stay flat, so periods with sharper cost movement may warrant review."
              : "Order activity appears to shift over time, so the sharpest swing periods are worth reviewing for replenishment or fulfillment context."
            : domain === "crm"
              ? "Pipeline activity appears to move over time, so value changes are worth comparing with follow-up activity and broader stage progression."
            : "The observed metric is moving over time rather than settling into a stable range, so interpretation should stay close to the measured field.";

  return {
    type: "trend",
    metric,
    dimension: trendChart.dimension ?? undefined,
    strength: "partial",
    evidence: crmEvidence,
    implication,
    domain,
    source: "chart"
  };
}

function buildRelationshipSignal(params: {
  category: ExecutiveInsightRelationshipCategory;
  domain: ExecutiveInsightDomain;
  metric: string;
  dimension?: string;
  evidence: string;
  implication: string;
  strength?: ExecutiveInsightSignal["strength"];
  reliability?: string;
}): ExecutiveInsightSignal {
  return {
    type: "relationship",
    metric: params.metric,
    dimension: params.dimension,
    strength: params.strength ?? "strong",
    evidence: params.evidence,
    implication: params.implication,
    reliability: params.reliability,
    domain: params.domain,
    source: "fact",
    relationshipCategory: params.category
  };
}

function leadingEntityFromObservation(observation: string) {
  const normalized = observation.trim();
  const patterns = [
    /^([^,.]+?)\s+leads\b/i,
    /^([^,.]+?)\s+contributes\b/i,
    /^([^,.]+?)\s+sits at the strong end\b/i,
    /^Across [^,]+,\s+[^ ]+\s+runs strongest in\s+([^,.]+)/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function parseStrongestWeakestObservation(observation: string) {
  const strongestMatch = observation.match(/strongest in ([^,.]+?)(?: at|,|\.|$)/i);
  const weakestMatch = observation.match(/(?:weakest in|sits lowest|lowest(?:,)?(?: which is)?(?: where)?)(?: in)?\s+([^,.]+?)(?: at|,|\.|$)/i);

  if (!strongestMatch?.[1] || !weakestMatch?.[1]) {
    return null;
  }

  return {
    strongest: strongestMatch[1].trim(),
    weakest: weakestMatch[1].trim()
  };
}

function buildCallTrackingRelationships(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const revenueLeader =
    facts.topFindings.topRevenueSegment ??
    (facts.concentration.top1RevenueEntity
      ? {
          dimension: facts.concentration.top1RevenueEntity.dimension,
          name: facts.concentration.top1RevenueEntity.name,
          share: facts.concentration.top1RevenueEntity.share
        }
      : resolveTopLeaderFromKpiCards(facts, "call_tracking", ["revenue from calls", "revenue", "estimated value"]));
  const missedCallChart = facts.charts.find((chart) => includesAny(chart.metric ?? "", ["missed"]) && chart.keyObservation);

  if (revenueLeader && missedCallChart?.keyObservation) {
    const missedEvidence = humanizeChartEvidence(missedCallChart.keyObservation);
    const sameLeader = normalizeEntityName(missedEvidence).includes(normalizeEntityName(revenueLeader.name));
    const revenueShareText = revenueLeader.share !== undefined ? ` contributes ${formatPercent(revenueLeader.share)} of revenue` : " is the leading revenue source";
    signals.push(
      buildRelationshipSignal({
        category: "quality_vs_revenue",
        domain: "call_tracking",
        metric: "revenue versus missed-call pressure",
        dimension: revenueLeader.dimension,
        evidence: sameLeader
          ? `${revenueLeader.name}${revenueShareText}, and ${missedEvidence}`
          : `${revenueLeader.name}${revenueShareText}, while ${missedEvidence}`,
        implication: sameLeader
          ? "The strongest revenue source is also carrying visible missed-call leakage, so attribution quality may be overstating channel health."
          : "Revenue concentration and missed-call pressure do not appear to land in the same place, so channel performance is worth reviewing alongside operational leakage."
      })
    );
  }

  const efficiencyMismatch = facts.comparisons.revenueVsEfficiencyMismatches[0];
  if (efficiencyMismatch?.lowerEfficiencyName) {
    signals.push(
      buildRelationshipSignal({
        category: "quality_vs_revenue",
        domain: "call_tracking",
        metric: "revenue versus efficiency alignment",
        evidence: efficiencyMismatch.note,
        implication: "Acquisition scale and acquisition efficiency do not appear aligned, so channel decisions should not rely on raw revenue leadership alone.",
        strength: "partial"
      })
    );
  }

  return signals;
}

function buildOperationsRelationships(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const missedCallChart = facts.charts.find((chart) => includesAny(chart.metric ?? "", ["missed"]) && chart.keyObservation);
  const talkTimeChart = facts.charts.find((chart) => includesAny(chart.metric ?? "", ["talk"]) && chart.keyObservation);

  if (missedCallChart?.keyObservation && talkTimeChart?.keyObservation) {
    const missedObservation = humanizeChartEvidence(missedCallChart.keyObservation);
    const talkObservation = humanizeChartEvidence(talkTimeChart.keyObservation);
    const missedLeaderText = leadingEntityFromObservation(missedObservation) ?? "the leading service line";
    const talkLeaderText = leadingEntityFromObservation(talkObservation) ?? "the leading agent team";
    const missedLeader = normalizeEntityName(missedLeaderText);
    const talkLeader = normalizeEntityName(talkLeaderText);
    const samePressurePoint = Boolean(missedLeader && talkLeader && missedLeader === talkLeader);

    signals.push(
      buildRelationshipSignal({
        category: "pressure_coupling",
        domain: "operations",
        metric: "missed-call pressure versus talk-time load",
        evidence: samePressurePoint
          ? `${sentenceCase(missedLeaderText)} carries both the heaviest missed-call pressure and the highest talk time load.`
          : `${sentenceCase(missedLeaderText)} carries the heaviest missed-call pressure, while ${talkLeaderText} carries the highest talk time load.`,
        implication: samePressurePoint
          ? "Missed-call pressure and handling load appear to peak in the same part of the operation, which may indicate a localized service bottleneck."
          : "Missed-call pressure and handling load appear to peak in different parts of the operation, so staffing review should separate demand pressure from handling capacity."
      })
    );
  }

  return signals;
}

function buildRetailRelationships(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const costCard = facts.kpiCards.find((card) => includesAny(metricLabelForKpi(card, "retail"), ["fulfillment cost"]));
  const orderCard = facts.kpiCards.find((card) => includesAny(metricLabelForKpi(card, "retail"), ["fulfilled orders"]));

  if (costCard?.contextLine && orderCard?.contextLine && sameDimensionFamily(costCard.relatedDimension, orderCard.relatedDimension)) {
    const costContext = parseKpiContext(humanizeKpiContextLine(costCard.contextLine));
    const orderContext = parseKpiContext(humanizeKpiContextLine(orderCard.contextLine));
    if (costContext?.type === "best_worst" && orderContext?.type === "best_worst") {
      const sameLeader = normalizeEntityName(costContext.best) === normalizeEntityName(orderContext.best);
      signals.push(
        buildRelationshipSignal({
          category: "cost_vs_outcome",
          domain: "retail",
          metric: "fulfillment cost versus fulfilled orders",
          dimension: costCard.relatedDimension,
          evidence: sameLeader
            ? `${costContext.best} sits at the strong end of both fulfillment cost and fulfilled orders across ${displayDimension(costCard.relatedDimension).toLowerCase()}.`
            : `${costContext.best} sits at the strong end of fulfillment cost, while ${orderContext.best} leads fulfilled orders across ${displayDimension(costCard.relatedDimension).toLowerCase()}.`,
          implication: sameLeader
            ? "Throughput and cost pressure appear to rise together in the same part of the business, so efficiency review should check whether volume is being handled cleanly."
            : "Cost pressure and order throughput do not appear concentrated in the same place, which may indicate uneven operating efficiency rather than simple demand growth."
        })
      );
    }
  }

  return signals;
}

function buildRetailOperationalSignals(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const warehouseCostChart = facts.charts.find(
    (chart) =>
      Boolean(chart.keyObservation) &&
      normalize(chart.dimension) === "warehouse" &&
      includesAny(chart.metric ?? chart.title, ["spend", "cost", "fulfillment"])
  );

  if (warehouseCostChart?.keyObservation) {
    const spread = parseStrongestWeakestObservation(humanizeChartEvidence(warehouseCostChart.keyObservation));
    if (spread) {
      signals.push({
        type: "variance",
        metric: "warehouse fulfillment cost spread",
        dimension: "warehouse",
        strength: "strong",
        evidence: `Across warehouses, fulfillment cost runs strongest in ${spread.strongest} and weakest in ${spread.weakest}.`,
        implication: "Inventory pressure appears uneven across warehouses, which may indicate localized operational strain rather than broad catalog-wide pressure.",
        domain: "retail",
        source: "fact"
      });
    }
  }

  return signals;
}

function buildEnergyRelationships(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const solarCard = facts.kpiCards.find((card) => includesAny(metricLabelForKpi(card, "energy"), ["solar generation", "solar kwh"]));
  const loadCard = facts.kpiCards.find((card) => includesAny(metricLabelForKpi(card, "energy"), ["load"]));
  const solarTrend = facts.charts.find((chart) => includesAny(chart.metric ?? "", ["solar"]) && chart.analysisRole === "trend" && chart.keyObservation);

  if (solarCard?.contextLine && loadCard?.contextLine && sameDimensionFamily(solarCard.relatedDimension, loadCard.relatedDimension)) {
    const solarContext = parseKpiContext(humanizeKpiContextLine(solarCard.contextLine));
    const loadContext = parseKpiContext(humanizeKpiContextLine(loadCard.contextLine));
    if (solarContext?.type === "best_worst" && loadContext?.type === "best_worst") {
      const sameBest = normalizeEntityName(solarContext.best) === normalizeEntityName(loadContext.best);
      signals.push(
        buildRelationshipSignal({
          category: "generation_vs_load",
          domain: "energy",
          metric: "solar generation versus load",
          dimension: solarCard.relatedDimension,
          evidence: sameBest
            ? `${solarContext.best} sits at the strong end of both solar output and load across ${displayDimension(solarCard.relatedDimension).toLowerCase()}.`
            : `${solarContext.best} sits at the strong end of solar output, while ${loadContext.best} carries the highest load across ${displayDimension(solarCard.relatedDimension).toLowerCase()}.`,
          implication: sameBest
            ? "The heaviest-demand site is also the strongest generator, so operating swings may be shaped by both supply and demand in the same location."
            : "Generation variability and demand pressure do not appear to peak in the same place, so operating swings may reflect supply balance more than raw load growth."
        })
      );
    }
  }

  if (solarTrend?.keyObservation && loadCard?.contextLine) {
    const loadContext = parseKpiContext(humanizeKpiContextLine(loadCard.contextLine));
    const loadLeader = loadContext?.type === "best_worst" ? loadContext.best : "the leading site";
    signals.push(
      buildRelationshipSignal({
        category: "generation_vs_load",
        domain: "energy",
        metric: "solar trend versus load profile",
        evidence: `${humanizeChartEvidence(solarTrend.keyObservation)} Site load remains strongest in ${loadLeader}.`,
        implication: "The operating pattern is worth separating into supply movement over time and demand concentration by site, rather than treating the fluctuation as a single demand story.",
        strength: "partial"
      })
    );
  }

  return signals;
}

function buildEnergyOperationalSignals(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const importCard = facts.kpiCards.find((card) => includesAny(metricLabelForKpi(card, "energy"), ["grid import"]));
  const exportCard = facts.kpiCards.find((card) => includesAny(metricLabelForKpi(card, "energy"), ["grid export"]));

  if (importCard?.contextLine && exportCard?.contextLine && sameDimensionFamily(importCard.relatedDimension, exportCard.relatedDimension)) {
    const importContext = parseKpiContext(humanizeKpiContextLine(importCard.contextLine));
    const exportContext = parseKpiContext(humanizeKpiContextLine(exportCard.contextLine));
    if (importContext?.type === "best_worst" && exportContext?.type === "best_worst") {
      const sameBest = normalizeEntityName(importContext.best) === normalizeEntityName(exportContext.best);
      signals.push({
        type: "variance",
        metric: "grid reliance asymmetry",
        dimension: importCard.relatedDimension,
        strength: "strong",
        evidence: sameBest
          ? `${importContext.best} sits at the strong end of both grid import and grid export across ${displayDimension(importCard.relatedDimension).toLowerCase()}.`
          : `${importContext.best} sits at the strong end of grid import, while ${exportContext.best} sits at the strong end of grid export across ${displayDimension(importCard.relatedDimension).toLowerCase()}.`,
        implication: sameBest
          ? "Grid dependence and export activity appear concentrated in the same location, so external supply reliance may not be evenly distributed across sites."
          : "Import dependence and export strength appear to peak in different places, which may indicate uneven grid reliance across the operating footprint.",
        domain: "energy",
        source: "fact"
      });
    }
  }

  return signals;
}

function findStageLikeChart(facts: AnalyticsFacts) {
  return facts.charts.find(
    (chart) =>
      includesAny(`${chart.title} ${chart.dimension ?? ""} ${chart.metric ?? ""}`, [
        "stage",
        "lifecycle",
        "pipeline",
        "journey status",
        "opportunity"
      ])
  );
}

function buildCrmRelationships(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const topEntity = facts.concentration.top1RevenueEntity;
  const top3Share = facts.concentration.top3RevenueShare;
  const trend = buildTrendSignal(facts, "crm");
  const stageChart = findStageLikeChart(facts);

  if (topEntity && top3Share !== undefined && includesAny(topEntity.dimension, ["customer journey", "journey", "stage", "pipeline"])) {
    const metricLabel = includesAny(topEntity.name, ["callback", "recontact", "follow up", "follow-up"]) ? "estimated value" : "pipeline value";
    signals.push(
      buildRelationshipSignal({
        category: "pipeline_dependency",
        domain: "crm",
        metric: "pipeline concentration versus journey fragmentation",
        dimension: topEntity.dimension,
      evidence: `${topEntity.name} contributes ${formatPercent(topEntity.share)} of ${metricLabel}, and the top 3 ${pluralizeDimensionLabel(displayDimension(topEntity.dimension).toLowerCase())} account for ${formatPercent(top3Share)} overall.`,
        implication: includesAny(topEntity.name, ["callback", "recontact", "follow up", "follow-up"])
          ? "Follow-up dependency appears concentrated in a narrow part of the pipeline rather than spread evenly across customer journeys."
          : "A small number of customer journeys appear to carry most of the pipeline value while the remaining journeys contribute more fragmented activity."
      })
    );
  }

  if (topEntity && trend && includesAny(topEntity.dimension, ["customer journey", "journey", "stage", "pipeline"])) {
    signals.push(
      buildRelationshipSignal({
        category: "concentration_vs_trend",
        domain: "crm",
        metric: "pipeline concentration versus trend",
        dimension: topEntity.dimension,
        evidence: `${topEntity.name} carries the largest share of estimated value, while value also fluctuates across the observed period.`,
        implication: "Recent movement appears shaped by a narrow part of the pipeline rather than evenly distributed progression across the full journey mix.",
        strength: "partial"
      })
    );
  }

  if (stageChart?.keyObservation) {
    signals.push(
      buildRelationshipSignal({
        category: "stage_imbalance",
        domain: "crm",
        metric: "stage progression imbalance",
        dimension: stageChart.dimension ?? undefined,
        evidence: humanizeChartEvidence(stageChart.keyObservation),
        implication: "Lead progression appears uneven across lifecycle stages, with stronger concentration in some stages than in closed outcomes.",
        strength: "partial"
      })
    );
  } else if (stageChart) {
    const stageDimension = displayDimension(stageChart.dimension) || "lifecycle stage";
    const metricLabel = publicLabel(stageChart.metric ?? "value").toLowerCase();
    signals.push(
      buildRelationshipSignal({
        category: "stage_imbalance",
        domain: "crm",
        metric: "stage progression coverage",
        dimension: stageChart.dimension ?? undefined,
        evidence: `${sentenceCase(stageDimension)} is available as a dedicated funnel dimension for ${metricLabel}, so progression can be reviewed stage by stage rather than as one blended total.`,
        implication: "Stage progression should be reviewed directly, especially where closed outcomes may be lagging earlier-stage volume.",
        strength: "partial"
      })
    );
  }

  return signals;
}

function buildGenericRelationships(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const concentration = buildConcentrationSignal(facts, "generic");
  const trend = buildTrendSignal(facts, "generic");

  if (concentration && trend) {
    const topEntity = facts.concentration.top1RevenueEntity;
    signals.push(
      buildRelationshipSignal({
        category: "concentration_vs_trend",
        domain: "generic",
        metric: "concentration versus trend",
        dimension: concentration.dimension,
        evidence: topEntity
          ? `${topEntity.name} has the largest observed value share, while observed value also fluctuates across the observed period.`
          : `Observed value concentration remains narrow while observed value also fluctuates across the observed period.`,
        implication: "Recent movement may be coming from a narrow part of the dataset rather than from broad-based change, but the metric should remain neutral without stronger domain grounding.",
        strength: "partial"
      })
    );
  }

  return signals;
}

function buildGenericAnalyticalSignals(facts: AnalyticsFacts): ExecutiveInsightSignal[] {
  const signals: ExecutiveInsightSignal[] = [];
  const topSegment = facts.topFindings.topRevenueSegment;
  const weakestSegment = facts.topFindings.weakestSegment;

  if (
    topSegment &&
    weakestSegment &&
    normalize(topSegment.dimension) === normalize(weakestSegment.dimension) &&
    !isWeakGenericDimension(topSegment.dimension)
  ) {
    signals.push({
      type: "variance",
      metric: "segment value spread",
      dimension: topSegment.dimension,
      strength: "strong",
      evidence: `Across ${displayDimension(topSegment.dimension).toLowerCase()}, observed value runs strongest in ${topSegment.name} and weakest in ${weakestSegment.name}.`,
      implication: "Observed value appears unevenly distributed across segments, without enough grounding to treat it as revenue or another business KPI.",
      domain: "generic",
      source: "fact"
    });
  }

  return signals;
}

function buildRelationshipSignals(facts: AnalyticsFacts, domain: ExecutiveInsightDomain): ExecutiveInsightSignal[] {
  if (domain === "call_tracking") {
    return buildCallTrackingRelationships(facts);
  }
  if (domain === "operations") {
    return buildOperationsRelationships(facts);
  }
  if (domain === "retail") {
    return buildRetailRelationships(facts);
  }
  if (domain === "energy") {
    return buildEnergyRelationships(facts);
  }
  if (domain === "crm") {
    return buildCrmRelationships(facts);
  }
  return buildGenericRelationships(facts);
}

function buildDomainPrimitiveSignals(facts: AnalyticsFacts, domain: ExecutiveInsightDomain): ExecutiveInsightSignal[] {
  if (domain === "retail") {
    return buildRetailOperationalSignals(facts);
  }
  if (domain === "energy") {
    return buildEnergyOperationalSignals(facts);
  }
  if (domain === "generic") {
    return buildGenericAnalyticalSignals(facts);
  }
  return [];
}

function buildChartSignal(chart: AnalyticsFacts["charts"][number], domain: ExecutiveInsightDomain): ExecutiveInsightSignal | null {
  if (!chart.metric || !chart.keyObservation) {
    return null;
  }
  if (domain === "generic" && isWeakGenericDimension(chart.dimension)) {
    return null;
  }
  if (domain === "crm" && isUnsafeCrmDimension(chart.dimension)) {
    return null;
  }
  const metric =
    domain === "generic" && includesAny(chart.metric, ["revenue", "sales", "income", "gmv", "value", "return amount"])
      ? "Observed value"
      : domain === "retail" && includesAny(chart.metric, ["spend", "cost"])
      ? "Fulfillment cost"
      : domain === "energy" && includesAny(chart.metric, ["spend", "cost"])
      ? "Energy cost"
      : domain === "crm" && includesAny(chart.metric, ["estimated value", "pipeline value"])
      ? "Estimated value"
      : domain === "crm" && includesAny(chart.metric, ["revenue", "realized revenue"])
      ? "Realized revenue"
      : domain === "crm" && includesAny(chart.metric, ["calls", "call volume", "lead count"])
      ? "Lead volume"
      : domain === "crm" && includesAny(chart.metric, ["qualifiedcall", "qualified call", "qualified lead"])
      ? "Qualified leads"
      : domain === "crm" && includesAny(chart.metric, ["callback", "follow up", "follow-up", "contact attempts"])
      ? "Follow-up pressure"
      : domain === "crm" && includesAny(chart.metric, ["convertedcall", "converted call", "closed won", "opportunity"])
      ? "Closed-won outcomes"
      : publicLabel(chart.metric);
  const evidence =
    domain === "generic" && metric === "Observed value"
      ? humanizeChartEvidence(chart.keyObservation)
          .replace(/^Revenue\b/, "Observed value")
          .replace(/\brevenue\b/g, "observed value")
          .replace(/\bsales value\b/gi, "observed value")
      : domain === "retail" && includesAny(chart.metric, ["spend", "cost"])
      ? humanizeChartEvidence(chart.keyObservation).replace(/\bSpend\b/g, "Fulfillment cost").replace(/\bspend\b/g, "fulfillment cost")
      : domain === "energy" && includesAny(chart.metric, ["spend", "cost"])
      ? humanizeChartEvidence(chart.keyObservation).replace(/\bSpend\b/g, "Energy cost").replace(/\bspend\b/g, "energy cost")
      : domain === "crm"
      ? humanizeChartEvidence(chart.keyObservation)
          .replace(/\bQualified leads qualified calls\b/g, "Qualified leads")
          .replace(/\bqualified calls\b/g, "qualified leads")
          .replace(/\bconverted calls\b/g, "closed-won outcomes")
          .replace(/^Calls\b/g, "Lead volume")
          .replace(/\bcalls\b/g, "lead volume")
      : humanizeChartEvidence(chart.keyObservation);
  const role = chart.analysisRole;
  const type: ExecutiveInsightSignalType =
    role === "trend"
      ? "trend"
      : role === "distribution"
        ? "concentration"
        : classifyMetric(chart.metric);

  return {
    type,
    metric,
    dimension: chart.dimension ?? undefined,
    strength: "partial",
    evidence,
    implication: implicationFor(domain, metric, chart.dimension ?? undefined),
    domain,
    source: "chart"
  };
}

function humanizeChartEvidence(value: string) {
  return value
    .replace(/\bmissedcall\b/gi, "missed calls")
    .replace(/\bqualifiedcall\b/gi, "qualified calls")
    .replace(/\bconvertedcall\b/gi, "converted calls")
    .replace(/\btalktime\b/gi, "talk time")
    .replace(/\bcallvolume\b/gi, "call volume")
    .replace(/\bSales Value Aud\b/g, "Sales value")
    .replace(/\bsales value aud\b/g, "sales value")
    .replace(/\bCase Count\b/g, "Case count")
    .replace(/\bcase count\b/g, "case count")
    .replace(/\bfulfilledorders\b/gi, "fulfilled orders")
    .replace(/\bsource channel account\b/gi, "source channels account for")
    .replace(/\bSolar Kwh\b/g, "Solar output")
    .replace(/\bsolar kwh\b/g, "solar output")
    .replace(/\bLoad Kwh\b/g, "Load")
    .replace(/\bload kwh\b/g, "load")
    .replace(/\btraffic srcs\b/gi, "traffic sources")
    .replace(/\bmkt mediums\b/gi, "marketing mediums");
}

function buildReliabilitySignal(facts: AnalyticsFacts, domain: ExecutiveInsightDomain): ExecutiveInsightSignal | null {
  const warnings = [
    ...(facts.datasetSummary.dataSummaryNotes ?? []).filter((note) =>
      /partial|coverage|denominator|aggregated|ambiguous|grounding|financial interpretation|not assumed|avoid/i.test(note)
    ),
    ...facts.datasetSummary.warnings,
    ...facts.kpiCards.flatMap((kpi) => kpi.warnings ?? [])
  ]
    .filter((warning) => !/no clear kpi candidates/i.test(warning))
    .slice(0, 2);

  if (warnings.length === 0) {
    return null;
  }

  return {
    type: "reliability",
    metric: "decision confidence",
    strength: "partial",
    evidence: warnings.join(" "),
    implication: "Cross-segment comparisons can still guide investigation, but the ranking should not be treated as fully decision-grade until the missing support is resolved.",
    reliability: warnings.join(" "),
    domain,
    source: "fact"
  };
}

export function passesExecutiveInsightQualityGate(signal: ExecutiveInsightSignal) {
  const combined = `${signal.evidence} ${signal.implication}`;
  const normalizedEvidence = normalize(signal.evidence);
  const normalizedCombined = normalize(combined);
  const hasAnalyticalShape =
    /(concentrat|account for|accounting for|varies across|higher than|lower than|gap|spread|peak|trend|fluctuat|declin|increas|stable|uneven|rather than|across)/.test(normalizedCombined);
  const hasInternalTrustLanguage =
    /(grounded signal|semantic signal|partially grounded|conclusions should stay tied|should be interpreted alongside|should be read as an operational usage signal)/.test(normalizedCombined);
  const isPureValueRestatement =
    /^([a-z0-9 %$().,-]+ )?is [a-z0-9 %$().,-]+$/.test(normalizedEvidence) &&
    !/(top|best|worst|concentrat|varies|spread|peak|from|to|across)/.test(normalizedEvidence);

  return Boolean(
    signal.metric.trim() &&
      signal.evidence.trim() &&
      signal.implication.trim() &&
      hasAnalyticalShape &&
      !hasInternalTrustLanguage &&
      !isPureValueRestatement &&
      !isDomainUnsafe(combined, signal.domain)
  );
}

export function isExecutiveInsightBulletSupported(bullet: string, facts: ExecutiveInsightFacts) {
  if (!bullet.trim() || isDomainUnsafe(bullet, facts.domain)) {
    return false;
  }
  const normalized = normalize(bullet);
  return facts.signals.some((signal) => {
    const metric = normalize(signal.metric);
    const dimension = normalize(signal.dimension);
    return (metric && normalized.includes(metric)) || (dimension && normalized.includes(dimension));
  });
}

function signalPriority(signal: ExecutiveInsightSignal) {
  const typePriority: Record<ExecutiveInsightSignalType, number> = {
    relationship: 7,
    risk: 6,
    variance: 5,
    concentration: 4,
    trend: 3,
    efficiency: 2,
    reliability: 1
  };
  const sourcePriority = signal.source === "fact" ? 0.6 : signal.source === "chart" ? 0.3 : 0;
  return typePriority[signal.type] + sourcePriority + (signal.strength === "strong" ? 0.5 : 0);
}

function signalBucket(signal: ExecutiveInsightSignal) {
  if (signal.type === "relationship") {
    return "relationship";
  }
  if (signal.type === "trend") {
    return "trend";
  }
  if (signal.type === "reliability") {
    return "reliability";
  }
  if (signal.type === "risk" || signal.type === "concentration") {
    return "concentration_risk";
  }
  return "variance";
}

function metricFamily(signal: ExecutiveInsightSignal) {
  return normalize(signal.metric);
}

function implicationFamily(signal: ExecutiveInsightSignal) {
  return normalize(signal.implication)
    .replace(/^that /, "")
    .replace(/\b(the next review|follow-up|review should|should)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function implicationType(signal: ExecutiveInsightSignal) {
  const normalized = normalize(signal.implication);
  if (/(not aligned|not concentrated in the same place|not peaking in the same place|rather than)/.test(normalized)) {
    return "mismatch";
  }
  if (/(moving over time|not yet stable|varying across the period|fluctuat|increased|declined|steady)/.test(normalized)) {
    return "trend";
  }
  if (/(not evenly distributed|concentrated|narrow part|heaviest share|dominat)/.test(normalized)) {
    return "concentration";
  }
  if (/(spread|unevenly distributed|weak end|strongest|weakest|localized operational strain|grid reliance)/.test(normalized)) {
    return "spread";
  }
  if (/(directional|decision-grade|coverage|missing support)/.test(normalized)) {
    return "reliability";
  }
  return "general";
}

function evidenceFamily(signal: ExecutiveInsightSignal) {
  return normalize(signal.evidence)
    .replace(/\b\d+(?:\.\d+)?k\b/g, "#")
    .replace(/\b\d+(?:\.\d+)?%/g, "#")
    .replace(/\b\d+(?:\.\d+)?\b/g, "#")
    .replace(/\bon \d{4}-\d{2}-\d{2}\b/g, " on date")
    .replace(/\b(starting at|ending at|peak at|contributes|accounting for|account for)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryAnchorSegment(signal: ExecutiveInsightSignal) {
  const evidence = signal.evidence.trim();
  return (
    leadingEntityFromObservation(evidence) ??
    evidence.match(/^([^,.]+?)\s+drives the largest observed revenue share/i)?.[1]?.trim() ??
    evidence.match(/^([^,.]+?)\s+carries the largest share/i)?.[1]?.trim() ??
    null
  );
}

function primaryAnchorKey(signal: ExecutiveInsightSignal) {
  const anchor = normalize(primaryAnchorSegment(signal));
  const dimension = normalize(signal.dimension);
  if (!anchor) {
    return "";
  }
  return `${dimension}:${anchor}`;
}

function ownsDetailedQuantAnchor(signal: ExecutiveInsightSignal) {
  const normalized = normalize(signal.evidence);
  return /(accounting for|contributes .* of|top 3 .* account for|top 3 .* contribute)/.test(normalized);
}

function evidenceOverlaps(left: ExecutiveInsightSignal, right: ExecutiveInsightSignal) {
  const leftEvidence = evidenceFamily(left);
  const rightEvidence = evidenceFamily(right);
  if (!leftEvidence || !rightEvidence) {
    return false;
  }
  return (
    leftEvidence === rightEvidence ||
    leftEvidence.includes(rightEvidence) ||
    rightEvidence.includes(leftEvidence)
  );
}

function relationshipAlreadyCovers(selected: ExecutiveInsightSignal[], candidate: ExecutiveInsightSignal) {
  const metric = normalize(candidate.metric);
  return selected.some((signal) => {
    if (signal.type !== "relationship") {
      return false;
    }
    if (signal.relationshipCategory === "quality_vs_revenue" && candidate.source === "kpi") {
      return includesAny(metric, ["revenue", "value"]);
    }
    return false;
  });
}

function anchorAlreadyOwned(selected: ExecutiveInsightSignal[], candidate: ExecutiveInsightSignal) {
  const candidateAnchor = primaryAnchorKey(candidate);
  if (!candidateAnchor) {
    return false;
  }

  return selected.some((signal) => {
    const selectedAnchor = primaryAnchorKey(signal);
    if (!selectedAnchor || selectedAnchor !== candidateAnchor) {
      return false;
    }

    if (signalBucket(signal) === signalBucket(candidate)) {
      return true;
    }

    if (implicationType(signal) === implicationType(candidate)) {
      return true;
    }

    if (signal.type === "relationship" || candidate.type === "relationship") {
      return true;
    }

    return evidenceOverlaps(signal, candidate);
  });
}

function signalSpecificityBoost(signal: ExecutiveInsightSignal) {
  const text = normalize(`${signal.evidence} ${signal.implication}`);
  let score = 0;
  if (/\b(top 3|accounting for|contributes|peak|starting at|ending at|strongest|weakest)\b/.test(text)) {
    score += 0.5;
  }
  if (signal.relationshipCategory) {
    score += 0.75;
  }
  if (signal.reliability && /incomplete|missing|coverage/.test(normalize(signal.reliability))) {
    score += 0.2;
  }
  return score;
}

function rankedSignals(signals: ExecutiveInsightSignal[]) {
  return [...signals].sort((left, right) => {
    const scoreDiff =
      signalPriority(right) +
      signalSpecificityBoost(right) -
      (signalPriority(left) + signalSpecificityBoost(left));
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return right.evidence.length - left.evidence.length;
  });
}

function selectBestCandidate(
  candidates: ExecutiveInsightSignal[],
  selected: ExecutiveInsightSignal[],
  options?: {
    requireDistinctMetric?: boolean;
    requireDistinctRelationshipCategory?: boolean;
    preferDistinctAnchor?: boolean;
  }
) {
  const usedFamilies = new Set(selected.map(metricFamily));
  const usedImplications = new Set(selected.map(implicationFamily));
  const usedEvidence = new Set(selected.map(evidenceFamily));
  const usedRelationshipCategories = new Set(
    selected
      .map((signal) => signal.relationshipCategory)
      .filter((value): value is ExecutiveInsightRelationshipCategory => Boolean(value))
  );

  return rankedSignals(candidates).find((signal) => {
    if (options?.requireDistinctMetric && usedFamilies.has(metricFamily(signal))) {
      return false;
    }
    if (usedImplications.has(implicationFamily(signal))) {
      return false;
    }
    if (usedEvidence.has(evidenceFamily(signal))) {
      return false;
    }
    if (selected.some((entry) => evidenceOverlaps(entry, signal))) {
      return false;
    }
    if (relationshipAlreadyCovers(selected, signal)) {
      return false;
    }
    if (options?.preferDistinctAnchor && anchorAlreadyOwned(selected, signal)) {
      return false;
    }
    if (
      options?.requireDistinctRelationshipCategory &&
      signal.relationshipCategory &&
      usedRelationshipCategories.has(signal.relationshipCategory)
    ) {
      return false;
    }
    return true;
  });
}

function balanceExecutiveInsightSignals(signals: ExecutiveInsightSignal[]) {
  const selected: ExecutiveInsightSignal[] = [];
  const domain = signals[0]?.domain ?? "generic";
  const minimumTarget = domain === "call_tracking" ? 4 : domain === "generic" ? 2 : 3;
  const grouped = new Map<string, ExecutiveInsightSignal[]>();

  for (const signal of rankedSignals(signals)) {
    const bucket = signalBucket(signal);
    const current = grouped.get(bucket) ?? [];
    current.push(signal);
    grouped.set(bucket, current);
  }

  const relationship = selectBestCandidate(grouped.get("relationship") ?? [], selected, {
    requireDistinctRelationshipCategory: true
  });
  if (relationship) {
    selected.push(relationship);
  }

  const trend = selectBestCandidate(grouped.get("trend") ?? [], selected, {
    requireDistinctMetric: true,
    preferDistinctAnchor: true
  });
  if (trend) {
    selected.push(trend);
  }

  const concentrationRisk = selectBestCandidate(grouped.get("concentration_risk") ?? [], selected, {
    requireDistinctMetric: true,
    preferDistinctAnchor: true
  });
  if (concentrationRisk) {
    selected.push(concentrationRisk);
  }

  const variance = selectBestCandidate(grouped.get("variance") ?? [], selected, {
    requireDistinctMetric: true,
    preferDistinctAnchor: true
  });
  if (variance) {
    selected.push(variance);
  }

  const reliability = selectBestCandidate(
    (grouped.get("reliability") ?? []).filter((signal) => /missing|coverage|directional|decision-grade/i.test(`${signal.evidence} ${signal.implication} ${signal.reliability ?? ""}`)),
    selected
  );
  if (reliability && selected.length < 4) {
    selected.push(reliability);
  }

  for (const signal of rankedSignals(signals)) {
    if (selected.length >= 5) {
      break;
    }
    if (selected.includes(signal)) {
      continue;
    }
    const sameBucketCount = selected.filter((entry) => signalBucket(entry) === signalBucket(signal)).length;
    const maxRelationshipCount = domain === "crm" || domain === "call_tracking" ? 2 : 1;
    if (signal.type === "relationship") {
      if (sameBucketCount >= maxRelationshipCount) {
        continue;
      }
      if (
        signal.relationshipCategory &&
        selected.some((entry) => entry.relationshipCategory === signal.relationshipCategory)
      ) {
        continue;
      }
    }
    if (sameBucketCount >= 2) {
      continue;
    }
    if (selected.some((entry) => metricFamily(entry) === metricFamily(signal))) {
      continue;
    }
    if (selected.some((entry) => implicationFamily(entry) === implicationFamily(signal))) {
      continue;
    }
    if (selected.some((entry) => evidenceFamily(entry) === evidenceFamily(signal) || evidenceOverlaps(entry, signal))) {
      continue;
    }
    if (relationshipAlreadyCovers(selected, signal)) {
      continue;
    }
    if (anchorAlreadyOwned(selected, signal)) {
      continue;
    }
    selected.push(signal);
  }

  if (selected.length < minimumTarget) {
    for (const signal of rankedSignals(signals)) {
      if (selected.length >= minimumTarget) {
        break;
      }
      if (selected.includes(signal)) {
        continue;
      }
      if (selected.some((entry) => implicationFamily(entry) === implicationFamily(signal))) {
        continue;
      }
      if (selected.some((entry) => evidenceFamily(entry) === evidenceFamily(signal) || evidenceOverlaps(entry, signal))) {
        continue;
      }
      if (relationshipAlreadyCovers(selected, signal)) {
        continue;
      }
      if (
        signal.relationshipCategory &&
        selected.some((entry) => entry.relationshipCategory === signal.relationshipCategory)
      ) {
        continue;
      }
      selected.push(signal);
    }
  }

  return selected;
}

function compressSignalEvidence(signal: ExecutiveInsightSignal, context: { detailedAnchorUsed: boolean }) {
  let evidence = signal.evidence.trim();

  if (context.detailedAnchorUsed && signal.type !== "relationship") {
    const sentences = evidence.split(/(?<=\.)\s+(?=[A-Z])/);
    evidence = sentences
      .filter((sentence) => !/^The top 3 .*(account for|contribute)/i.test(sentence.trim()))
      .map((sentence) => sentence.trim())
      .join(" ")
      .replace(/\s+,/g, ",")
      .trim();
  }

  return {
    ...signal,
    evidence
  };
}

function finalizeExecutiveInsightSignals(signals: ExecutiveInsightSignal[]) {
  const finalized: ExecutiveInsightSignal[] = [];
  let detailedAnchorUsed = false;

  for (const signal of signals) {
    const compressed = compressSignalEvidence(signal, { detailedAnchorUsed });
    finalized.push(compressed);
    if (!detailedAnchorUsed && ownsDetailedQuantAnchor(compressed)) {
      detailedAnchorUsed = true;
    }
  }

  return finalized;
}

export function buildExecutiveInsightFacts(facts: AnalyticsFacts): ExecutiveInsightFacts {
  const domain = constrainDomainWithDataSummary(resolveExecutiveInsightDomain(facts), facts);
  const baseSignals = [
    buildConcentrationSignal(facts, domain),
    buildEfficiencyMismatchSignal(facts, domain),
    buildTrendSignal(facts, domain),
    ...buildDomainPrimitiveSignals(facts, domain),
    ...facts.kpiCards.map((kpi) => buildKpiSignal(kpi, domain)),
    ...facts.charts.map((chart) => buildChartSignal(chart, domain)),
    buildReliabilitySignal(facts, domain)
  ].filter((signal): signal is ExecutiveInsightSignal => signal !== null);
  const relationshipSignals = buildRelationshipSignals(facts, domain);
  const rawSignals = [...relationshipSignals, ...baseSignals];

  const rejectedSignals: ExecutiveInsightFacts["rejectedSignals"] = [];
  const seen = new Set<string>();
  const metricCounts = new Map<string, number>();
  const metricTypes = new Map<string, Set<ExecutiveInsightSignalType>>();
  const signals: ExecutiveInsightSignal[] = [];

  for (const signal of rawSignals.sort((left, right) => signalPriority(right) - signalPriority(left))) {
    const key = `${signal.type}:${normalize(signal.metric)}:${normalize(signal.dimension)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const metricKey = normalize(signal.metric);
    const metricCount = metricCounts.get(metricKey) ?? 0;
    const usedTypes = metricTypes.get(metricKey) ?? new Set<ExecutiveInsightSignalType>();
    if (usedTypes.has(signal.type) || metricCount >= 2) {
      rejectedSignals.push({ reason: "duplicate_metric_family", evidence: signal.evidence });
      continue;
    }
    if (!passesExecutiveInsightQualityGate(signal)) {
      rejectedSignals.push({ reason: "failed_quality_gate", evidence: `${signal.evidence} ${signal.implication}` });
      continue;
    }
    metricCounts.set(metricKey, metricCount + 1);
    usedTypes.add(signal.type);
    metricTypes.set(metricKey, usedTypes);
    signals.push(signal);
  }

  return {
    domain,
    analystFrame: analystFrame(domain),
    signals: finalizeExecutiveInsightSignals(balanceExecutiveInsightSignals(signals)),
    reliabilityCaveats: rawSignals
      .filter((signal) => signal.type === "reliability" || Boolean(signal.reliability))
      .map((signal) => signal.reliability ?? signal.evidence)
      .slice(0, 3),
    rejectedSignals
  };
}

export function executiveSignalToBullet(signal: ExecutiveInsightSignal) {
  const phrasedSignal = polishExecutiveSignalForAnalyst(signal);
  return `${phrasedSignal.evidence} ${sentenceCase(phrasedSignal.implication)}${phrasedSignal.reliability ? ` ${sentenceCase(phrasedSignal.reliability)}` : ""}`;
}
