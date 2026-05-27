import { resolveSemanticDimensionSourceColumn } from "../../../analytics/semanticContract.js";
import { resolveMetricValue } from "./chartDataUtils.js";
import type { ChartAnalysisRole, ChartBlueprint, ChartBusinessArea, ChartSelectionContext, ChartSemanticRole } from "./chartSelectionTypes.js";

const FORBIDDEN_RELATIONSHIP_METRIC_KEYS = new Set([
  "qualifiedcall",
  "convertedcall",
  "missedcall",
  "answeredcall",
  "repeatcaller",
  "callid",
  "callreference",
  "interactionref",
  "tracknumber",
  "trackingnumber",
  "callernumber",
  "destinationnumber",
  "phonenumber",
  "statusflag",
  "binaryflag"
]);

function normalize(value: string | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/_/g, " ").trim();
}

function uniqueBlueprints(blueprints: ChartBlueprint[]) {
  const seen = new Set<string>();
  return blueprints.filter((blueprint) => {
    const key = [
      blueprint.chartType,
      blueprint.metric ?? "",
      blueprint.dimension ?? "",
      blueprint.groupBy ?? "",
      blueprint.secondaryMetric ?? ""
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildFallbackDimension(context: ChartSelectionContext) {
  const explicitTarget = context.intent.targetDimensions[0];
  if (explicitTarget) {
    return explicitTarget;
  }

  if (context.intent.explicitDimensionMention) {
    return null;
  }

  const semanticContract = context.capabilities.semanticContract;
  const preferredHint = context.semanticProfile?.dimensionHints.find((hint) => {
    if (!semanticContract) {
      return false;
    }

    const sourceColumn = resolveSemanticDimensionSourceColumn(semanticContract, hint);
    return sourceColumn !== null;
  });
  if (preferredHint && semanticContract) {
    const sourceColumn = resolveSemanticDimensionSourceColumn(semanticContract, preferredHint);
    if (sourceColumn) {
      return sourceColumn;
    }
  }

  return context.capabilities.defaultDimension;
}

function buildFallbackMetric(context: ChartSelectionContext) {
  const firstRequested = context.intent.targetMetrics[0];
  if (firstRequested) {
    return firstRequested;
  }

  const semanticMetric = context.semanticProfile?.metricSignals
    .map((signal) => signal.metric)
    .find((metric) => [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(metric));
  if (semanticMetric) {
    return semanticMetric;
  }

  if (context.intent.primaryIntent === "efficiency_analysis") {
    return ["roi", "roas", "conversion_rate", "revenue", "cost"].find((metric) =>
      [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(metric)
    ) ?? context.capabilities.defaultMetric;
  }

  return context.capabilities.defaultMetric;
}

function isAdditiveMetric(metric: string | null | undefined) {
  return ["revenue", "spend", "clicks", "impressions", "conversions"].includes(String(metric ?? ""));
}

function isNonAdditiveRatioMetric(metric: string | null | undefined) {
  return [
    "roas",
    "ctr",
    "cvr",
    "cpc",
    "cpa",
    "roi",
    "conversion_rate",
    "conversion rate",
    "margin",
    "profit_margin"
  ].includes(String(metric ?? "").toLowerCase());
}

function getSemanticCategoryCount(context: ChartSelectionContext, dimension: string | null | undefined) {
  if (!dimension) {
    return null;
  }

  const profileColumn = context.profile.columns.find((column) => column.name === dimension);
  if (profileColumn && profileColumn.kind === "categorical") {
    return profileColumn.uniqueCount;
  }

  const semanticContract = context.capabilities.semanticContract;
  const mappedColumn = semanticContract ? resolveSemanticDimensionSourceColumn(semanticContract, dimension) : null;
  const mappedProfile = mappedColumn ? context.profile.columns.find((column) => column.name === mappedColumn) : null;
  return mappedProfile?.uniqueCount ?? null;
}

function isSemanticCompositionDimension(context: ChartSelectionContext, dimension: string | null | undefined) {
  const normalized = String(dimension ?? "").toLowerCase();
  if (!normalized) {
    return false;
  }

  return ["channel", "campaign", "device", "region", "source", "medium"].some((hint) => normalized.includes(hint));
}

const EXPLICIT_FUNNEL_FIELD_HINTS = [
  "sales_stage",
  "funnel_stage",
  "lead_stage",
  "pipeline_stage",
  "opportunity_stage",
  "stage",
  "step",
  "funnel",
  "pipeline"
];
const FUNNEL_STAGE_RANKS: Array<{ pattern: RegExp; rank: number }> = [
  { pattern: /\b(new|lead|inquiry|enquiry|prospect|captured|awareness|visitor)\b/i, rank: 1 },
  { pattern: /\b(contacted|reached|connected|answered|consideration|engaged)\b/i, rank: 2 },
  { pattern: /\b(follow[\s-]?up|nurtured|appointment|booked|mql|marketing qualified)\b/i, rank: 3 },
  { pattern: /\b(qualified|sql|sales qualified)\b/i, rank: 4 },
  { pattern: /\b(quote sent|proposal|demo|negotiation|opportunity)\b/i, rank: 5 },
  { pattern: /\b(converted|conversion|won|closed won|sale|customer)\b/i, rank: 6 }
];
const NON_PROGRESSIVE_FUNNEL_VALUE_HINTS = [
  /\bmissed\b/i,
  /\bvoicemail\b/i,
  /\babandoned\b/i,
  /\bnot[\s-]?qualified\b/i,
  /\bno[\s-]?answer\b/i,
  /\bfailed\b/i,
  /\blost\b/i,
  /\bcancelled\b/i,
  /\bspam\b/i
];

function averageCategoryLabelLength(context: ChartSelectionContext, dimension: string | null | undefined) {
  if (!dimension) {
    return 0;
  }

  const profileColumn = context.profile.columns.find((column) => column.name === dimension);
  const labels = profileColumn?.topCategories?.map((entry) => String(entry.value ?? "").trim()).filter(Boolean) ?? [];
  if (labels.length === 0) {
    return 0;
  }

  return labels.reduce((sum, label) => sum + label.length, 0) / labels.length;
}

function topCategoryLabels(context: ChartSelectionContext, dimension: string | null | undefined) {
  if (!dimension) {
    return [];
  }

  const profileColumn = context.profile.columns.find((column) => column.name === dimension);
  return profileColumn?.topCategories?.map((entry) => String(entry.value ?? "").trim()).filter(Boolean) ?? [];
}

function preferredComparisonChartType(context: ChartSelectionContext, dimension: string | null | undefined) {
  const categoryCount = getSemanticCategoryCount(context, dimension);
  const averageLabelLength = averageCategoryLabelLength(context, dimension);
  if ((categoryCount !== null && categoryCount > 6) || averageLabelLength >= 14) {
    return "horizontal_bar" as const;
  }

  return "bar" as const;
}

function canUseCompositionChart(
  context: ChartSelectionContext,
  metric: string | null,
  dimension: string | null
) {
  if (!metric || !dimension) {
    return false;
  }

  if (!isAdditiveMetric(metric) || isNonAdditiveRatioMetric(metric)) {
    return false;
  }

  if (!isSemanticCompositionDimension(context, dimension)) {
    return false;
  }

  const categoryCount = getSemanticCategoryCount(context, dimension);
  if (categoryCount !== null && categoryCount > 6) {
    return false;
  }

  return categoryCount === null || (categoryCount >= 2 && categoryCount <= 6);
}

function funnelStageRank(value: string) {
  for (const candidate of FUNNEL_STAGE_RANKS) {
    if (candidate.pattern.test(value)) {
      return candidate.rank;
    }
  }
  return null;
}

function hasClearFunnelProgression(context: ChartSelectionContext, stageField: string | null | undefined) {
  if (!stageField) {
    return false;
  }

  const normalizedField = normalize(stageField);
  const labels = topCategoryLabels(context, stageField);
  if (labels.length < 2) {
    return false;
  }

  const explicitStageField = EXPLICIT_FUNNEL_FIELD_HINTS.some((hint) => normalizedField.includes(hint));
  if (!explicitStageField) {
    return false;
  }

  const rankedLabels = labels
    .map((label) => ({ label, rank: funnelStageRank(label) }))
    .filter((entry): entry is { label: string; rank: number } => entry.rank !== null);
  const nonProgressiveCount = labels.filter((label) => NON_PROGRESSIVE_FUNNEL_VALUE_HINTS.some((pattern) => pattern.test(label))).length;
  const progressionCoverage = labels.length > 0 ? rankedLabels.length / labels.length : 0;
  const uniqueRanks = [...new Set(rankedLabels.map((entry) => entry.rank))].sort((left, right) => left - right);
  if (nonProgressiveCount > 0) {
    return false;
  }
  if (progressionCoverage < 0.75) {
    return false;
  }
  if (uniqueRanks.length < 3 || uniqueRanks[uniqueRanks.length - 1] - uniqueRanks[0] < 2) {
    return false;
  }
  return true;
}

function preferredFunnelStageField(context: ChartSelectionContext) {
  return context.capabilities.funnelStageFields.find((field) => hasClearFunnelProgression(context, field)) ?? null;
}

function metricSourceColumns(context: ChartSelectionContext, metric: string) {
  const contract = context.capabilities.semanticContract;
  const semanticSources = contract?.metricResolutions?.[metric]?.sourceColumns ?? [];
  const matchingProfileColumn = context.profile.columns.find((column) => column.name === metric);
  return [...new Set([...semanticSources, ...(matchingProfileColumn ? [matchingProfileColumn.name] : [])])];
}

function semanticRoleForMetric(context: ChartSelectionContext, metric: string) {
  const contract = context.capabilities.semanticContract;
  if (!contract) {
    return null;
  }

  const sourceColumn = metricSourceColumns(context, metric)[0];
  if (!sourceColumn) {
    return null;
  }

  return contract.roleMappings?.find((entry) => entry.rawColumn === sourceColumn)?.semanticRole ?? null;
}

function metricPairs(context: ChartSelectionContext, xMetric: string, yMetric: string) {
  return context.rows
    .map((row) => {
      const x = resolveMetricValue(row, xMetric, context.capabilities, context.profile);
      const y = resolveMetricValue(row, yMetric, context.capabilities, context.profile);
      return x === null || y === null ? null : { x, y };
    })
    .filter((pair): pair is { x: number; y: number } => pair !== null);
}

function uniqueNumericCount(values: number[]) {
  return new Set(values.map((value) => Number(value.toFixed(4)))).size;
}

function estimateCorrelation(pairs: Array<{ x: number; y: number }>) {
  if (pairs.length < 3) {
    return 0;
  }

  const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (const pair of pairs) {
    numerator += (pair.x - meanX) * (pair.y - meanY);
    denominatorX += (pair.x - meanX) ** 2;
    denominatorY += (pair.y - meanY) ** 2;
  }

  return numerator / Math.sqrt(denominatorX * denominatorY || 1);
}

function isForbiddenRelationshipMetric(context: ChartSelectionContext, metric: string) {
  const normalizedMetric = normalize(metric).replace(/\s+/g, "");
  if (FORBIDDEN_RELATIONSHIP_METRIC_KEYS.has(normalizedMetric)) {
    return true;
  }

  if (/\b(id|ref|reference|tracking|phone|number|flag|status)\b/.test(normalize(metric))) {
    return true;
  }

  const semanticRole = semanticRoleForMetric(context, metric);
  return semanticRole !== null && FORBIDDEN_RELATIONSHIP_METRIC_KEYS.has(normalize(semanticRole).replace(/\s+/g, ""));
}

function canUseScatterChart(
  context: ChartSelectionContext,
  xMetric: string | null | undefined,
  yMetric: string | null | undefined
) {
  if (!xMetric || !yMetric || xMetric === yMetric) {
    return false;
  }

  if (isForbiddenRelationshipMetric(context, xMetric) || isForbiddenRelationshipMetric(context, yMetric)) {
    return false;
  }

  const pairs = metricPairs(context, xMetric, yMetric);
  if (pairs.length < 12) {
    return false;
  }

  const xValues = pairs.map((pair) => pair.x);
  const yValues = pairs.map((pair) => pair.y);
  const uniqueX = uniqueNumericCount(xValues);
  const uniqueY = uniqueNumericCount(yValues);
  if (uniqueX <= 2 || uniqueY <= 2 || uniqueX < 5 || uniqueY < 5) {
    return false;
  }

  const xRange = Math.max(...xValues) - Math.min(...xValues);
  const yRange = Math.max(...yValues) - Math.min(...yValues);
  if (xRange <= 0 || yRange <= 0) {
    return false;
  }

  return Math.abs(estimateCorrelation(pairs)) >= 0.18;
}

function maybeAddScatterCandidate(
  candidates: ChartBlueprint[],
  context: ChartSelectionContext,
  input: Omit<ChartBlueprint, "id" | "score">
) {
  if (!input.metric || !input.secondaryMetric) {
    return false;
  }

  if (!canUseScatterChart(context, input.metric, input.secondaryMetric)) {
    return false;
  }

  pushCandidate(candidates, input);
  return true;
}

function semanticDimensionColumn(context: ChartSelectionContext, semanticRoles: string[]) {
  return (
    context.capabilities.semanticContract?.roleMappings?.find(
      (entry) => entry.kind === "dimension" && semanticRoles.includes(entry.semanticRole ?? "")
    )?.rawColumn ?? null
  );
}

function operationsPrimaryMetric(context: ChartSelectionContext) {
  return (
    ["calls", "missedCall", "answeredCall", "repeat_caller_rate", "talkTime", "handleTime", "waitTime", "ringTime", "qualityScore"].find((metric) =>
      [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(metric)
    ) ?? null
  );
}

function isOperationsOnlyContext(context: ChartSelectionContext) {
  const domain = context.capabilities.semanticContract?.detectedDomain?.domain;
  const availableMetrics = [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics];
  const hasMarketingValueMetric = ["revenue", "spend", "roas", "roi", "clicks", "impressions", "conversions"].some((metric) =>
    availableMetrics.includes(metric)
  );

  return (domain === "call_tracking" || domain === "call_operations") && !hasMarketingValueMetric;
}

function isCallTrackingBusinessContext(context: ChartSelectionContext) {
  const domain = context.capabilities.semanticContract?.detectedDomain?.domain;
  return (
    domain === "call_tracking" ||
    domain === "call_operations" ||
    domain === "marketing_attribution" ||
    domain === "mixed_call_tracking_attribution"
  );
}

function isCallTrackingAttributionContext(context: ChartSelectionContext) {
  return isCallTrackingBusinessContext(context) && !isOperationsOnlyContext(context);
}

function hasStrongCallTrackingChartSignals(context: ChartSelectionContext) {
  return (
    hasMetricCapability(context, "calls") ||
    hasMetricCapability(context, "qualifiedCall") ||
    hasMetricCapability(context, "missedCall") ||
    hasMetricCapability(context, "repeat_caller_rate") ||
    Boolean(semanticDimensionColumn(context, ["callOutcome", "callStatus", "location", "queue", "branch"]))
  );
}

function hasMetricCapability(context: ChartSelectionContext, metric: string) {
  return [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(metric);
}

function pickDimensionByHints(context: ChartSelectionContext, hints: string[]) {
  const normalizedHints = hints.map((hint) => normalize(hint));
  const dimensions = context.capabilities.categoricalDimensions;
  return (
    dimensions.find((dimension) => {
      const normalizedDimension = normalize(dimension);
      return normalizedHints.some((hint) => normalizedDimension.includes(hint));
    }) ?? null
  );
}

function preferredAttributionVolumeDimension(context: ChartSelectionContext) {
  return (
    semanticDimensionColumn(context, ["marketingChannel", "channel", "source", "campaignName", "campaign"]) ??
    pickDimensionByHints(context, ["channel", "campaign", "source", "medium"]) ??
    context.capabilities.defaultDimension
  );
}

function preferredAttributionOperationsDimension(context: ChartSelectionContext) {
  return (
    semanticDimensionColumn(context, ["location", "branch", "queue", "accountName", "account"]) ??
    pickDimensionByHints(context, ["location", "branch", "queue", "account"]) ??
    preferredAttributionVolumeDimension(context)
  );
}

function preferredAttributionPerformanceDimension(context: ChartSelectionContext) {
  return (
    semanticDimensionColumn(context, ["campaignName", "campaign", "marketingChannel", "channel", "source", "medium"]) ??
    pickDimensionByHints(context, ["campaign", "channel", "source", "medium"]) ??
    context.capabilities.defaultDimension
  );
}

function preferredAttributionOutcomeMetric(context: ChartSelectionContext) {
  if (hasMetricCapability(context, "roas")) {
    return "roas";
  }
  return ["revenue", "convertedCall"].find((metric) => hasMetricCapability(context, metric)) ?? null;
}

function preferredAttributionEfficiencyMetric(context: ChartSelectionContext) {
  return ["cost_per_qualified_call", "cost_per_conversion", "roas", "spend"].find((metric) => hasMetricCapability(context, metric)) ?? null;
}

function maybeAddOperationsOverviewCandidates(
  candidates: ChartBlueprint[],
  context: ChartSelectionContext,
  dateField: string | null
) {
  const outcomeDimension = semanticDimensionColumn(context, ["callOutcome"]);
  const locationDimension = semanticDimensionColumn(context, ["location"]) ?? context.capabilities.defaultDimension;
  const accountDimension = semanticDimensionColumn(context, ["accountName", "account"]);
  const durationMetric = ["talkTime", "handleTime", "waitTime", "ringTime"].find((metric) =>
    [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(metric)
  );

  if (dateField) {
    pushCandidate(candidates, {
      chartType: "line",
      intent: "general_overview",
      title: "calls over time",
      description: "Track call volume over time.",
      reason: "A time view is the fastest operational read on call demand.",
      whyThisChart: "Operations datasets should open with call volume across time when a datetime field is available.",
      metric: "calls",
      xAxis: dateField,
      yAxis: "calls",
      limit: 0,
      filters: [],
      priority: 100,
      semanticRole: "main_answer",
      analysisRole: "trend",
      businessArea: "volume"
    });
  }

  if (outcomeDimension) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, outcomeDimension),
      intent: "comparison",
      title: "calls by outcome",
      description: "Compare call volume by outcome.",
      reason: "Outcome mix is one of the clearest operational quality signals.",
      whyThisChart: "Operations dashboards should show where call volume ends up when an outcome field exists.",
      metric: "calls",
      dimension: outcomeDimension,
      xAxis: outcomeDimension,
      yAxis: "calls",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 92,
      semanticRole: "supporting_comparison",
      analysisRole: "comparison",
      businessArea: "quality"
    });
  }

  if (locationDimension) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, locationDimension),
      intent: "comparison",
      title: "calls by location",
      description: "Compare call volume across business locations or queues.",
      reason: "Location volume helps teams see where demand and staffing pressure are concentrated.",
      whyThisChart: "Operations dashboards should include one segment view for where calls are landing.",
      metric: "calls",
      dimension: locationDimension,
      xAxis: locationDimension,
      yAxis: "calls",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 88,
      semanticRole: "supporting_comparison",
      analysisRole: "comparison",
      businessArea: "volume"
    });
  }

  if (locationDimension && [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes("missedCall")) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, locationDimension),
      intent: "comparison",
      title: "missed calls by location",
      description: "Show where missed calls are concentrated.",
      reason: "Missed-call concentration highlights operational coverage gaps.",
      whyThisChart: "Missed calls should be grouped by a business location or queue when the field exists.",
      metric: "missedCall",
      dimension: locationDimension,
      xAxis: locationDimension,
      yAxis: "missedCall",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 84,
      semanticRole: "trend_or_distribution",
      analysisRole: "comparison",
      businessArea: "operations"
    });
  }

  if (durationMetric && (accountDimension || locationDimension)) {
    const durationDimension = accountDimension ?? locationDimension;
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, durationDimension),
      intent: "comparison",
      title: `${durationMetric} by ${durationDimension}`,
      description: "Show where handling load is heaviest.",
      reason: "Duration load highlights where teams spend the most time handling calls.",
      whyThisChart: "Operational duration should be grouped by a business-facing segment instead of identifiers.",
      metric: durationMetric,
      dimension: durationDimension,
      xAxis: durationDimension,
      yAxis: durationMetric,
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 76,
      semanticRole: "diagnostic",
      analysisRole: "comparison",
      businessArea: "operations"
    });
  }
}

function maybeAddCallTrackingAttributionOverviewCandidates(
  candidates: ChartBlueprint[],
  context: ChartSelectionContext,
  dateField: string | null
) {
  const volumeDimension = preferredAttributionVolumeDimension(context);
  const performanceDimension = preferredAttributionPerformanceDimension(context);
  const operationsDimension = preferredAttributionOperationsDimension(context);
  const outcomeMetric = preferredAttributionOutcomeMetric(context);
  const efficiencyMetric = preferredAttributionEfficiencyMetric(context);

  if (dateField && hasMetricCapability(context, "calls")) {
    pushCandidate(candidates, {
      chartType: "line",
      intent: "general_overview",
      title: "calls over time",
      description: "Track overall call volume across time.",
      reason: "Call volume is the clearest starting point for an attribution dashboard.",
      whyThisChart: "Call-tracking dashboards should open with demand volume before drilling into efficiency or revenue.",
      metric: "calls",
      xAxis: dateField,
      yAxis: "calls",
      limit: 0,
      filters: [],
      priority: 100,
      semanticRole: "main_answer",
      analysisRole: "trend",
      businessArea: "volume"
    });
  }

  if (performanceDimension && hasMetricCapability(context, "qualifiedCall")) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, performanceDimension),
      intent: "comparison",
      title: "Qualified Calls by Campaign",
      description: "Compare qualified call volume across the strongest performance segment.",
      reason: "This shows which sources produce calls that are actually sales-relevant.",
      whyThisChart: "A call-tracking dashboard should separate call quality from raw volume.",
      metric: "qualifiedCall",
      dimension: performanceDimension,
      xAxis: performanceDimension,
      yAxis: "qualifiedCall",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 96,
      semanticRole: "supporting_comparison",
      analysisRole: "comparison",
      businessArea: "quality"
    });
  } else if (performanceDimension && hasMetricCapability(context, "convertedCall")) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, performanceDimension),
      intent: "comparison",
      title: "Converted Calls by Campaign",
      description: "Compare converted call volume across the strongest performance segment.",
      reason: "This highlights which sources turn demand into completed outcomes.",
      whyThisChart: "When qualified-call fields are not available, converted calls are the closest quality signal.",
      metric: "convertedCall",
      dimension: performanceDimension,
      xAxis: performanceDimension,
      yAxis: "convertedCall",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 94,
      semanticRole: "supporting_comparison",
      analysisRole: "comparison",
      businessArea: "conversion"
    });
  }

  if (efficiencyMetric && performanceDimension) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, performanceDimension),
      intent: "efficiency_analysis",
      title:
        efficiencyMetric === "cost_per_qualified_call"
          ? "Cost per Qualified Call by Campaign"
          : efficiencyMetric === "cost_per_conversion"
            ? "Cost per Conversion by Campaign"
            : efficiencyMetric === "roas"
              ? "ROAS by Campaign"
              : "Spend by Campaign",
      description:
        efficiencyMetric === "cost_per_qualified_call"
          ? "Compare the cost required to generate a qualified call."
          : efficiencyMetric === "cost_per_conversion"
            ? "Compare the cost required to generate a converted call."
            : efficiencyMetric === "roas"
              ? "Compare return on ad spend across the strongest performance segment."
              : "Show where budget is concentrated.",
      reason:
        efficiencyMetric === "spend"
          ? "This gives spend context without letting it dominate the dashboard."
          : "This highlights which campaigns are most cost-efficient.",
      whyThisChart:
        efficiencyMetric === "spend"
          ? "Spend should only appear as supporting context when stronger efficiency metrics are unavailable."
          : "Call-tracking dashboards should show budget efficiency, not just raw spend.",
      metric: efficiencyMetric,
      dimension: performanceDimension,
      xAxis: performanceDimension,
      yAxis: efficiencyMetric,
      sort: efficiencyMetric === "cost_per_qualified_call" || efficiencyMetric === "cost_per_conversion" || efficiencyMetric === "cost_per_call" ? "asc" : "desc",
      limit: 8,
      filters: [],
      priority: 92,
      semanticRole: "trend_or_distribution",
      analysisRole: "efficiency",
      businessArea: "efficiency"
    });
  }

  if (hasMetricCapability(context, "spend") && hasMetricCapability(context, "qualifiedCall")) {
    const addedScatter = maybeAddScatterCandidate(candidates, context, {
      chartType: "scatter",
      intent: "efficiency_analysis",
      title: "Qualified Calls vs Spend",
      description: "Compare spend against qualified call volume.",
      reason: "This highlights where budget is generating meaningful call quality instead of volume alone.",
      whyThisChart: "Call-tracking dashboards need one efficiency relationship view when the data supports it.",
      metric: "spend",
      secondaryMetric: "qualifiedCall",
      xAxis: "spend",
      yAxis: "qualifiedCall",
      limit: 0,
      filters: [],
      priority: 84,
      semanticRole: "diagnostic",
      analysisRole: "efficiency",
      businessArea: "efficiency"
    });
    if (!addedScatter && performanceDimension && hasMetricCapability(context, "spend") && efficiencyMetric !== "spend") {
      pushCandidate(candidates, {
        chartType: preferredComparisonChartType(context, performanceDimension),
        intent: "efficiency_analysis",
        title: "Spend by Campaign",
        description: "Show where budget is concentrated.",
        reason: "This keeps spend visible without letting it dominate the dashboard.",
        whyThisChart: "Spend should only appear as supporting context when paired with stronger call-tracking charts.",
        metric: "spend",
        dimension: performanceDimension,
        xAxis: performanceDimension,
        yAxis: "spend",
        sort: "desc",
        limit: 8,
        filters: [],
        priority: 74,
        semanticRole: "diagnostic",
        analysisRole: "efficiency",
        businessArea: "efficiency"
      });
    }
  }

  if (performanceDimension && hasMetricCapability(context, "convertedCall")) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, performanceDimension),
      intent: "comparison",
      title: "Converted Calls by Campaign",
      description: "Compare converted call volume across the strongest performance segment.",
      reason: "This answers which campaigns actually convert best.",
      whyThisChart: "Converted calls are the clearest conversion chart when explicit conversion-rate metrics are unavailable.",
      metric: "convertedCall",
      dimension: performanceDimension,
      xAxis: performanceDimension,
      yAxis: "convertedCall",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 90,
      semanticRole: "trend_or_distribution",
      analysisRole: "comparison",
      businessArea: "conversion"
    });
  }

  if (performanceDimension && outcomeMetric && outcomeMetric !== "roas") {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, performanceDimension),
      intent: "comparison",
      title: `${outcomeMetric} by ${performanceDimension}`,
      description: `Compare ${outcomeMetric} across the strongest performance segment.`,
      reason: "This keeps commercial outcome visible alongside call volume and efficiency.",
      whyThisChart: "Revenue should appear as an outcome view, not as the entire dashboard story.",
      metric: outcomeMetric,
      dimension: performanceDimension,
      xAxis: performanceDimension,
      yAxis: outcomeMetric,
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 78,
      semanticRole: "diagnostic",
      analysisRole: "comparison",
      businessArea: "outcome"
    });
  }

  if (operationsDimension && hasMetricCapability(context, "missedCall")) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, operationsDimension),
      intent: "comparison",
      title: "Missed Calls by Location",
      description: "Show where missed calls are concentrated.",
      reason: "Missed calls highlight where opportunity is leaking after demand is created.",
      whyThisChart: "Attribution dashboards should still surface operational loss when the field exists.",
      metric: "missedCall",
      dimension: operationsDimension,
      xAxis: operationsDimension,
      yAxis: "missedCall",
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 84,
      semanticRole: "diagnostic",
      analysisRole: "comparison",
      businessArea: "operations"
    });
  }

  const durationMetric = ["talkTime", "handleTime", "waitTime", "ringTime"].find((metric) =>
    hasMetricCapability(context, metric)
  );
  if (durationMetric && operationsDimension) {
    pushCandidate(candidates, {
      chartType: preferredComparisonChartType(context, operationsDimension),
      intent: "comparison",
      title: `${durationMetric} by ${operationsDimension}`,
      description: "Show where call handling load is heaviest.",
      reason: "Duration helps expose operational drag even when missed-call data is unavailable.",
      whyThisChart: "Operations risk can also appear through unusually long call handling or wait times.",
      metric: durationMetric,
      dimension: operationsDimension,
      xAxis: operationsDimension,
      yAxis: durationMetric,
      sort: "desc",
      limit: 8,
      filters: [],
      priority: 80,
      semanticRole: "diagnostic",
      analysisRole: "comparison",
      businessArea: "operations"
    });
  }
}

function inferAnalysisRole(input: Omit<ChartBlueprint, "id" | "score">): ChartAnalysisRole {
  if (input.analysisRole) {
    return input.analysisRole;
  }

  if (input.chartType === "donut") {
    return "composition";
  }
  if (input.chartType === "funnel") {
    return "funnel";
  }
  if (input.chartType === "anomaly_trend") {
    return "anomaly";
  }
  if (input.chartType === "line") {
    return "trend";
  }
  if (input.chartType === "scatter" || input.chartType === "heatmap") {
    return input.intent === "efficiency_analysis" ? "efficiency" : "relationship";
  }
  if (input.chartType === "histogram" || input.chartType === "box_plot") {
    return "distribution";
  }
  if (input.intent === "efficiency_analysis") {
    return "efficiency";
  }
  if (input.intent === "anomaly_detection") {
    return "anomaly";
  }
  if (input.intent === "funnel_analysis") {
    return "funnel";
  }
  return "comparison";
}

function createBlueprint(
  input: Omit<ChartBlueprint, "id" | "score">
): ChartBlueprint {
  const normalizedAxes =
    input.chartType === "horizontal_bar" && input.metric && input.dimension
      ? {
          ...input,
          xAxis: input.metric,
          yAxis: input.dimension
        }
      : input;

  return {
    id: `${normalizedAxes.chartType}-${normalizedAxes.metric ?? "none"}-${normalizedAxes.dimension ?? "none"}-${normalizedAxes.groupBy ?? "none"}`,
    analysisRole: normalizedAxes.analysisRole ?? inferAnalysisRole(normalizedAxes),
    businessQuestionAnswered:
      normalizedAxes.businessQuestionAnswered ??
      buildBusinessQuestionAnswered(normalizedAxes.metric ?? null, normalizedAxes.dimension ?? normalizedAxes.groupBy ?? null, normalizedAxes.semanticRole),
    score: normalizedAxes.priority,
    ...normalizedAxes
  };
}

function pushCandidate(
  candidates: ChartBlueprint[],
  input: Omit<ChartBlueprint, "id" | "score">
) {
  candidates.push(createBlueprint(input));
}

function buildBusinessQuestionAnswered(
  metric: string | null | undefined,
  dimension: string | null | undefined,
  role: ChartSemanticRole | "composition"
) {
  if (role === "main_answer") {
    if (metric && dimension) {
      return `How does ${metric} vary across ${dimension}?`;
    }
    if (metric) {
      return `What is happening to ${metric}?`;
    }
  }

  if (role === "supporting_comparison" && metric && dimension) {
    return `Which ${dimension} segments are strongest or weakest on ${metric}?`;
  }

  if (role === "trend_or_distribution" && metric) {
    return `Is the pattern in ${metric} broad, concentrated, or changing over time?`;
  }

  if (role === "diagnostic" && metric) {
    return `What secondary view helps explain the pattern in ${metric}?`;
  }

  if (role === "composition" && metric && dimension) {
    return `What share of ${metric} comes from each ${dimension}?`;
  }

  return "What business pattern does this chart explain?";
}

function buildCompositionQuestion(metric: string, dimension: string) {
  return `What share of ${metric} comes from each ${dimension}?`;
}

function maybeAddCompositionCandidate(
  candidates: ChartBlueprint[],
  context: ChartSelectionContext,
  metric: string | null,
  dimension: string | null
) {
  if (!canUseCompositionChart(context, metric, dimension)) {
    return false;
  }

  pushCandidate(candidates, {
    chartType: "donut",
    intent: context.intent.primaryIntent === "general_overview" ? "general_overview" : "comparison",
    title: `${metric} share by ${dimension}`,
    description: `Show how ${metric} is distributed across ${dimension}.`,
    reason: `This shows the composition of ${metric} and how much each ${dimension} contributes.`,
    whyThisChart: `A composition view is best when a business wants to understand share and concentration.`,
    businessQuestionAnswered: buildCompositionQuestion(metric!, dimension!),
    metric,
    dimension,
    xAxis: dimension,
    yAxis: metric,
    sort: "desc",
    limit: 8,
    filters: [],
    priority: 88,
    semanticRole: "supporting_comparison",
    analysisRole: "composition"
  });

  return true;
}

function maybeAddFunnelCandidate(
  candidates: ChartBlueprint[],
  context: ChartSelectionContext,
  metricPreference?: string | null
) {
  const stageField = preferredFunnelStageField(context);
  if (!stageField) {
    return;
  }

  const availableMetrics = [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics];
  const metric =
    metricPreference && availableMetrics.includes(metricPreference)
      ? metricPreference
      : ["conversions", "clicks", "impressions", "revenue"].find((candidate) => availableMetrics.includes(candidate)) ?? null;

  if (!metric) {
    return;
  }

  pushCandidate(candidates, {
    chartType: "funnel",
    intent: "funnel_analysis",
    title: `${metric} funnel by ${stageField}`,
    description: `Show the funnel path for ${metric} across ${stageField}.`,
    reason: `This reveals how volume moves through the funnel stages.`,
    whyThisChart: `When stage fields are available, a funnel is the clearest stage-conversion view.`,
    businessQuestionAnswered: `Where does ${metric} drop off across ${stageField}?`,
    metric,
    dimension: stageField,
    xAxis: stageField,
    yAxis: metric,
    limit: 10,
    filters: [],
    priority: 90,
    semanticRole: "main_answer",
    analysisRole: "funnel"
  });
}

export function generateRuleBasedChartCandidates(context: ChartSelectionContext): ChartBlueprint[] {
  const operationsMetric = isOperationsOnlyContext(context) ? operationsPrimaryMetric(context) : null;
  const metric = operationsMetric ?? buildFallbackMetric(context);
  const dimension = buildFallbackDimension(context);
  const dateField = context.capabilities.defaultDateDimension ?? context.capabilities.datetimeFields[0] ?? null;
  const candidates: ChartBlueprint[] = [];
  const secondaryMetric =
    context.capabilities.numericMetrics.find((candidate) => candidate !== metric) ??
    context.capabilities.kpiCandidates.find((candidate) => candidate !== metric) ??
    null;
  const comparisonDimension =
    context.capabilities.comparisonFields.find((candidate) => candidate !== dimension) ??
    context.capabilities.categoricalDimensions[1] ??
    null;

  if (!metric) {
    return [];
  }

  switch (context.intent.primaryIntent) {
    case "trend_analysis":
      if (dateField) {
        pushCandidate(candidates, {
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `Track how ${metric} changes across time.`,
            reason: `This chart answers the time-based part of the question directly.`,
            whyThisChart: `Trend analysis was detected and ${dateField} is available as a date field.`,
            businessQuestionAnswered: buildBusinessQuestionAnswered(metric, dateField, "main_answer"),
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
        });
      }
      if (dimension) {
        pushCandidate(candidates, {
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Compare ${metric} across ${dimension}.`,
            reason: `This supports the trend by showing which segments are strongest or weakest.`,
            whyThisChart: `When trends exist, a segment comparison helps isolate where the change comes from.`,
            businessQuestionAnswered: buildBusinessQuestionAnswered(metric, dimension, "supporting_comparison"),
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 85,
            semanticRole: "supporting_comparison"
        });
      }
      if (secondaryMetric && dateField) {
        pushCandidate(candidates, {
            chartType: "line",
            intent: "efficiency_analysis",
            title: `${secondaryMetric} trend over time`,
            description: `Review whether ${secondaryMetric} moved alongside ${metric}.`,
            reason: `This helps explain whether the main metric changed with a likely driver metric.`,
            whyThisChart: `A supporting metric trend is useful when users ask why a metric increased or declined.`,
            businessQuestionAnswered: buildBusinessQuestionAnswered(secondaryMetric, dateField, "trend_or_distribution"),
            metric: secondaryMetric,
            xAxis: dateField,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 78,
            semanticRole: "trend_or_distribution"
        });
      }
      pushCandidate(candidates, {
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `See the spread and concentration of ${metric}.`,
          reason: `A distribution view helps separate a gradual trend from a few extreme values.`,
          whyThisChart: `The dashboard adds one diagnostic view so the user can inspect spread and skew.`,
          businessQuestionAnswered: buildBusinessQuestionAnswered(metric, null, "diagnostic"),
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 72,
          semanticRole: "diagnostic"
      });
      break;
    case "comparison":
    case "segmentation":
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: context.intent.primaryIntent,
            title: `${metric} by ${dimension}`,
            description: `Compare ${metric} across ${dimension}.`,
            reason: `This is the clearest direct comparison for the asked segment.`,
            whyThisChart: `Comparison intent was detected and ${dimension} is the most relevant dimension.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      if (dateField && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "stacked_bar",
            intent: "segmentation",
            title: `${metric} trend by ${dimension}`,
            description: `Track ${metric} over time split by ${dimension}.`,
            reason: `This shows whether the compared segments diverged over time.`,
            whyThisChart: `Time-aware segmentation is useful after a direct comparison view.`,
            metric,
            dimension: dateField,
            groupBy: dimension,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 82,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (comparisonDimension && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "stacked_bar",
            intent: "segmentation",
            title: `${metric} by ${dimension} and ${comparisonDimension}`,
            description: `Break ${metric} down by two segments.`,
            reason: `This reveals whether a second segment explains the comparison result.`,
            whyThisChart: `Segment questions usually benefit from one deeper breakdown.`,
            metric,
            dimension,
            groupBy: comparisonDimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 75,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (secondaryMetric && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "comparison",
            title: `${secondaryMetric} by ${dimension}`,
            description: `Use a supporting metric to validate the segment comparison.`,
            reason: `A second metric adds confidence to the comparison story.`,
            whyThisChart: `The dashboard keeps one supporting comparison so the user sees another angle.`,
            metric: secondaryMetric,
            dimension,
            xAxis: secondaryMetric,
            yAxis: dimension,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 70,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
    case "ranking":
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "ranking",
            title: `${context.question.toLowerCase().includes("worst") || context.question.toLowerCase().includes("bottom") ? "Bottom" : "Top"} ${dimension} by ${metric}`,
            description: `Rank ${dimension} by ${metric}.`,
            reason: `This directly answers which performers are strongest or weakest.`,
            whyThisChart: `Ranking intent was detected, so the main chart is a sorted performer list.`,
            metric,
            dimension,
            xAxis: metric,
            yAxis: dimension,
            sort: context.question.toLowerCase().includes("worst") || context.question.toLowerCase().includes("bottom") ? "asc" : "desc",
            limit: 10,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      if (secondaryMetric && metric) {
        candidates.push(
          createBlueprint({
            chartType: "scatter",
            intent: "correlation",
            title: `${secondaryMetric} vs ${metric}`,
            description: `Check whether the ranking is explained by a second metric.`,
            reason: `A scatter plot helps show whether low performers are also inefficient on another metric.`,
            whyThisChart: `Ranking questions often need one driver view to explain why entities rank where they do.`,
            metric,
            secondaryMetric,
            xAxis: secondaryMetric,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 78,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (dateField && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `Show whether performance changed steadily or recently.`,
            reason: `A trend view reveals if weak performance is persistent or recent.`,
            whyThisChart: `The rank list is paired with one time trend when a date field exists.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 70,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "bar",
          intent: "comparison",
          title: `${metric} by ${dimension ?? "segment"}`,
          description: `Compare the same metric across the available dimension.`,
          reason: `A broader comparison helps the user see the performer list in context.`,
          whyThisChart: `The dashboard includes one contextual comparison alongside the rank list.`,
          metric,
          dimension,
          xAxis: dimension,
          yAxis: metric,
          limit: 10,
          filters: [],
          priority: 68,
          semanticRole: "diagnostic"
        })
      );
      break;
    case "anomaly_detection":
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "anomaly_trend",
            intent: "anomaly_detection",
            title: `${metric} anomalies over time`,
            description: `Scan for spikes and outlier periods in ${metric}.`,
            reason: `This is the most direct way to inspect anomalous movement over time.`,
            whyThisChart: `An anomaly question with a date field should start with a time-series anomaly view.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `Check whether anomalies are isolated or part of a wide spread.`,
          reason: `A distribution chart shows whether unusual values are rare or common.`,
          whyThisChart: `The dashboard adds one spread view to validate the anomaly signal.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 82,
          semanticRole: "supporting_comparison"
        })
      );
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "ranking",
            title: `${metric} by ${dimension}`,
            description: `Rank likely sources of the anomaly.`,
            reason: `Ranking helps isolate which segment contributes most to the spike or outlier.`,
            whyThisChart: `Anomaly investigations work better when paired with a segment ranking.`,
            metric,
            dimension,
            xAxis: metric,
            yAxis: dimension,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 74,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (secondaryMetric) {
        maybeAddScatterCandidate(candidates, context, {
          chartType: "scatter",
          intent: "correlation",
          title: `${metric} vs ${secondaryMetric}`,
          description: `Check whether anomalies coincide with a second metric.`,
          reason: `A scatter plot can reveal whether outliers are linked to another field.`,
          whyThisChart: `The dashboard keeps one relationship view for anomaly diagnosis.`,
          metric,
          secondaryMetric,
          xAxis: metric,
          yAxis: secondaryMetric,
          limit: 0,
          filters: [],
          priority: 68,
          semanticRole: "diagnostic"
        });
      }
      break;
    case "correlation":
      if (metric && secondaryMetric) {
        maybeAddScatterCandidate(candidates, context, {
          chartType: "scatter",
          intent: "correlation",
          title: `${metric} vs ${secondaryMetric}`,
          description: `Inspect the relationship between two numeric metrics.`,
          reason: `A scatter plot is the clearest direct relationship view for two metrics.`,
          whyThisChart: `Correlation intent was detected, so the main chart is a metric-vs-metric scatter.`,
          metric,
          secondaryMetric,
          xAxis: metric,
          yAxis: secondaryMetric,
          limit: 0,
          filters: [],
          priority: 100,
          semanticRole: "main_answer"
        });
      }
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `See whether the relationship changes across time.`,
            reason: `A trend view gives time context for the relationship between metrics.`,
            whyThisChart: `A relationship chart is stronger when paired with one time view.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 72,
            semanticRole: "supporting_comparison"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `Inspect the spread of the primary metric.`,
          reason: `This helps identify whether the relationship is driven by a narrow band or broad spread.`,
          whyThisChart: `The dashboard adds one metric spread view for relationship analysis.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 66,
          semanticRole: "trend_or_distribution"
        })
      );
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Check whether the relationship differs by segment.`,
            reason: `A segment comparison often reveals where a relationship is strongest.`,
            whyThisChart: `One segment comparison broadens the correlation story.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 60,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
    case "distribution":
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `View the spread of ${metric}.`,
          reason: `This is the direct answer for a distribution question.`,
          whyThisChart: `Distribution intent was detected, so the main chart is a histogram-style spread view.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 100,
          semanticRole: "main_answer"
        })
      );
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Compare spread-related outcomes across segments.`,
            reason: `A segment view helps connect the spread to business categories.`,
            whyThisChart: `The dashboard pairs one distribution view with one segment comparison.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 74,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `See whether the distribution may be shifting over time.`,
            reason: `A time view helps connect the spread to changing performance.`,
            whyThisChart: `The dashboard adds one trend as a supporting context chart.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 65,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (secondaryMetric) {
        maybeAddScatterCandidate(candidates, context, {
          chartType: "scatter",
          intent: "correlation",
          title: `${metric} vs ${secondaryMetric}`,
          description: `Check whether the distribution is connected to another metric.`,
          reason: `A scatter plot can show whether the spread is explained by a second variable.`,
          whyThisChart: `A relationship view complements a pure distribution chart.`,
          metric,
          secondaryMetric,
          xAxis: metric,
          yAxis: secondaryMetric,
          limit: 0,
          filters: [],
          priority: 60,
          semanticRole: "diagnostic"
        });
      }
      break;
    case "efficiency_analysis":
      candidates.push(
        createBlueprint({
          chartType: dateField ? "line" : "bar",
          intent: "efficiency_analysis",
          title: dateField ? `${metric} trend over time` : `${metric} by ${dimension ?? "segment"}`,
          description: `Show the main efficiency metric in the most relevant structure.`,
          reason: `This directly answers the efficiency metric the user is asking about.`,
          whyThisChart: `Efficiency analysis prefers ROI, ROAS, conversion rate, revenue, or cost first.`,
          metric,
          dimension: dateField ? null : dimension,
          xAxis: dateField ?? dimension,
          yAxis: metric,
          limit: 0,
          filters: [],
          priority: 100,
          semanticRole: "main_answer"
        })
      );
      if (dimension) {
        maybeAddCompositionCandidate(
          candidates,
          context,
          isAdditiveMetric(metric) ? metric : ["revenue", "spend", "conversions", "clicks", "impressions"].find((candidate) =>
            [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(candidate)
          ) ?? null,
          dimension
        );
      }
      if ([...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes("revenue") &&
          [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes("cost")) {
        maybeAddScatterCandidate(candidates, context, {
          chartType: "scatter",
          intent: "efficiency_analysis",
          title: "cost vs revenue",
          description: `Check efficiency by comparing cost to revenue directly.`,
          reason: `Cost versus revenue is the most diagnostic supporting view for efficiency questions.`,
          whyThisChart: `Efficiency questions benefit from a direct revenue-versus-cost relationship view.`,
          metric: "cost",
          secondaryMetric: "revenue",
          xAxis: "cost",
          yAxis: "revenue",
          limit: 0,
          filters: [],
          priority: 84,
          semanticRole: "supporting_comparison"
        });
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "ranking",
            title: `${metric} by ${dimension}`,
            description: `Rank segments on the chosen efficiency metric.`,
            reason: `A ranking view shows which segments are efficient or inefficient.`,
            whyThisChart: `The dashboard includes one segment ranking for efficiency questions.`,
            metric,
            dimension,
            xAxis: metric,
            yAxis: dimension,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 76,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (dateField && secondaryMetric) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${secondaryMetric} trend over time`,
            description: `Use a supporting metric trend to explain efficiency shifts.`,
            reason: `A second trend helps separate cost-driven and revenue-driven movement.`,
            whyThisChart: `This chart gives one supporting driver view for the efficiency question.`,
            metric: secondaryMetric,
            xAxis: dateField,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 68,
            semanticRole: "diagnostic"
          })
        );
      }
      maybeAddFunnelCandidate(candidates, context, metric);
      break;
    case "data_quality":
      candidates.push(
        createBlueprint({
          chartType: "bar",
          intent: "data_quality",
          title: "Missing values by column",
          description: `Show where missing values are concentrated.`,
          reason: `A missing-value comparison is the clearest first data-quality diagnostic.`,
          whyThisChart: `Data quality intent was detected, so the main chart focuses on missing values.`,
          metric: "missing_count",
          dimension: "column",
          xAxis: "column",
          yAxis: "missing_count",
          limit: 12,
          filters: [],
          priority: 100,
          semanticRole: "main_answer"
        })
      );
      if (metric) {
        candidates.push(
          createBlueprint({
            chartType: "histogram",
            intent: "distribution",
            title: `${metric} distribution`,
            description: `Inspect whether invalid or suspicious values cluster in one metric.`,
            reason: `A metric distribution helps spot suspicious ranges and dirty values.`,
            whyThisChart: `Data quality checks often need one numeric distribution view.`,
            metric,
            xAxis: metric,
            yAxis: "count",
            limit: 0,
            filters: [],
            priority: 74,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `Rows by ${dimension}`,
            description: `Check whether data quality issues cluster inside one segment.`,
            reason: `A segment count view helps show whether dirty data is concentrated in one group.`,
            whyThisChart: `The dashboard adds one segment count view for data quality analysis.`,
            metric: "row_count",
            dimension,
            xAxis: dimension,
            yAxis: "row_count",
            limit: 10,
            filters: [],
            priority: 62,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      break;
    case "funnel_analysis":
      if (metric) {
        const stageField = preferredFunnelStageField(context);
        if (stageField) {
        candidates.push(
          createBlueprint({
            chartType: "funnel",
            intent: "funnel_analysis",
            title: `${metric} funnel by ${stageField}`,
            description: `Use funnel stages when they exist in the dataset.`,
            reason: `This chart is the closest direct answer for a funnel question.`,
            whyThisChart: `A stage-like field was detected, so the dashboard can attempt a funnel view.`,
            metric,
            dimension: stageField,
            xAxis: stageField,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
        }
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Fallback funnel comparison when stage fields are incomplete.`,
            reason: `If funnel stages are limited, a segment bar chart is the closest stable replacement.`,
            whyThisChart: `The dashboard always keeps a valid fallback chart for funnel questions.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 76,
            semanticRole: "supporting_comparison"
          })
        );
      }
      break;
    case "general_overview":
    default:
      if (isOperationsOnlyContext(context)) {
        maybeAddOperationsOverviewCandidates(candidates, context, dateField);
        break;
      }

      if (isCallTrackingAttributionContext(context) && hasStrongCallTrackingChartSignals(context)) {
        maybeAddCallTrackingAttributionOverviewCandidates(candidates, context, dateField);
        break;
      }

      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "general_overview",
            title: `${metric} trend over time`,
            description: `Show the primary KPI across time.`,
            reason: `A trend chart gives the fastest high-level read of performance.`,
            whyThisChart: `General overview starts with the strongest KPI and the first date field.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 95,
            semanticRole: "main_answer",
            businessArea: isCallTrackingAttributionContext(context) ? "outcome" : undefined
          })
        );
      }
      if (dimension) {
        const compositionAdded = maybeAddCompositionCandidate(
          candidates,
          context,
          isAdditiveMetric(metric) ? metric : ["revenue", "spend", "conversions", "clicks", "impressions"].find((candidate) =>
            [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(candidate)
          ) ?? null,
          dimension
        );
        if (!compositionAdded) {
          const chartType = preferredComparisonChartType(context, dimension);
          candidates.push(
            createBlueprint({
              chartType,
              intent: "general_overview",
              title: `${metric} by ${dimension}`,
              description: `Compare the strongest KPI across the leading dimension.`,
              reason: `This gives a fast segment breakdown of the main KPI.`,
              whyThisChart: `A high-level dashboard should include at least one segment comparison.`,
              metric,
              dimension,
              xAxis: dimension,
              yAxis: metric,
              limit: 10,
              filters: [],
              priority: 85,
              semanticRole: "supporting_comparison",
              businessArea: isCallTrackingAttributionContext(context) ? "outcome" : undefined
            })
          );
        }
      }
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `Inspect the spread of the main KPI.`,
          reason: `A distribution view adds diagnostic context to the overview.`,
          whyThisChart: `The overview includes one spread chart to spot skew and outliers.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 72,
          semanticRole: "trend_or_distribution",
          businessArea: isCallTrackingAttributionContext(context) ? "outcome" : undefined
        })
      );
      if (secondaryMetric) {
        maybeAddScatterCandidate(candidates, context, {
          chartType: "scatter",
          intent: "correlation",
          title: `${metric} vs ${secondaryMetric}`,
          description: `Inspect a likely relationship between the top metrics.`,
          reason: `A relationship chart rounds out the overview with a diagnostic angle.`,
          whyThisChart: `The dashboard closes with one relationship chart when two metrics are available.`,
          metric,
          secondaryMetric,
          xAxis: metric,
          yAxis: secondaryMetric,
          limit: 0,
          filters: [],
          priority: 66,
          semanticRole: "diagnostic"
        });
      }
      maybeAddFunnelCandidate(candidates, context, metric);
      break;
  }

  return uniqueBlueprints(candidates);
}
