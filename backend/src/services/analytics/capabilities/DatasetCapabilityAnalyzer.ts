import type { DatasetCapabilities, DatasetProfile, KpiCandidate } from "../../../analytics/types.js";
import { KPI_ALIASES } from "../../../utils/inference.js";
import { resolveSemanticDimensionSourceColumn } from "../../../analytics/semanticContract.js";

const DIMENSION_HINTS = [
  "campaign",
  "channel",
  "device",
  "region",
  "location",
  "account",
  "status",
  "outcome",
  "customer_segment",
  "segment",
  "landing_page",
  "source",
  "country",
  "market"
];

const FUNNEL_HINTS = ["stage", "step", "funnel", "pipeline", "status"];
const PREFERRED_CANONICAL_METRICS = ["revenue", "spend", "clicks", "impressions", "conversions"] as const;
const PREFERRED_CANONICAL_DIMENSIONS = ["date", "campaign", "channel", "device", "region"] as const;
const CALL_OPERATIONS_PREFERRED_METRICS = [
  "calls",
  "missedCall",
  "answeredCall",
  "repeat_caller_rate",
  "callDuration",
  "talkTime",
  "handleTime",
  "waitTime",
  "ringTime",
  "qualityScore"
] as const;
const CALL_OPERATIONS_PREFERRED_DIMENSIONS = ["callOutcome", "location", "accountName", "account"] as const;
const IDENTIFIER_ROLE_KEYS = new Set(["callId", "callerNumber", "destinationNumber", "trackingNumber"]);
const FLAG_ROLE_KEYS = new Set(["qualifiedCall", "convertedCall", "missedCall", "answeredCall", "repeatCaller", "firstTimeCaller"]);

function normalize(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function rankColumns(columns: string[], preferred: string[]) {
  return [...columns].sort((left, right) => {
    const leftScore = preferred.findIndex((item) => left.includes(item));
    const rightScore = preferred.findIndex((item) => right.includes(item));
    const normalizedLeft = leftScore === -1 ? preferred.length : leftScore;
    const normalizedRight = rightScore === -1 ? preferred.length : rightScore;
    return normalizedLeft - normalizedRight;
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function firstAvailable<T>(values: Array<T | null | undefined>) {
  return values.find((value): value is T => value !== null && value !== undefined) ?? null;
}

function getRoleMapping(profile: DatasetProfile, column: string) {
  return profile.semanticContract?.roleMappings?.find((entry) => entry.rawColumn === column) ?? null;
}

function isIdentifierLikeColumn(profile: DatasetProfile, column: string) {
  const mapping = getRoleMapping(profile, column);
  if (mapping?.kind === "identifier" || (mapping?.semanticRole && IDENTIFIER_ROLE_KEYS.has(mapping.semanticRole))) {
    return true;
  }

  const normalized = normalize(column);
  return /\b(id|ref|reference|tracking|phone|dialled|dialed|extension|ext|number)\b/.test(normalized);
}

function isFlagLikeColumn(profile: DatasetProfile, column: string) {
  const mapping = getRoleMapping(profile, column);
  if (mapping?.kind === "flag" || (mapping?.semanticRole && FLAG_ROLE_KEYS.has(mapping.semanticRole))) {
    return true;
  }

  return /\b(flag|is |has )\b/.test(normalize(column));
}

function businessNumericColumns(profile: DatasetProfile) {
  return profile.numericColumns.filter((column) => {
    const mapping = getRoleMapping(profile, column);
    if (isIdentifierLikeColumn(profile, column) || isFlagLikeColumn(profile, column)) {
      return false;
    }

    if (mapping?.kind === "metric" || mapping?.kind === "value") {
      return true;
    }

    return true;
  });
}

function businessCategoricalColumns(profile: DatasetProfile) {
  return profile.categoricalColumns.filter((column) => !isIdentifierLikeColumn(profile, column));
}

function semanticDimensionColumns(profile: DatasetProfile) {
  const mappings = profile.semanticContract?.roleMappings ?? [];
  return unique(
    mappings
      .filter((entry) => entry.kind === "dimension" && profile.categoricalColumns.includes(entry.rawColumn))
      .map((entry) => entry.rawColumn)
      .filter((column) => !isIdentifierLikeColumn(profile, column))
  );
}

function resolvePreferredMetric(profile: DatasetProfile, kpis: KpiCandidate[]) {
  const contract = profile.semanticContract;
  const detectedDomain = contract?.detectedDomain?.domain;

  if (detectedDomain === "call_tracking" || detectedDomain === "call_operations") {
    const operationsMetric = CALL_OPERATIONS_PREFERRED_METRICS.find((metric) => contract?.availableMetrics.includes(metric));
    if (operationsMetric) {
      return operationsMetric;
    }
  }

  if (contract) {
    const preferredCanonical = PREFERRED_CANONICAL_METRICS.find((metric) => contract.availableMetrics.includes(metric));
    if (preferredCanonical) {
      return preferredCanonical;
    }
  }

  return kpis[0]?.column ?? null;
}

function resolvePreferredDimension(profile: DatasetProfile) {
  const contract = profile.semanticContract;
  const detectedDomain = contract?.detectedDomain?.domain;
  if (!contract) {
    return null;
  }

  if (detectedDomain === "call_tracking" || detectedDomain === "call_operations") {
    const operationsDimension = firstAvailable(
      CALL_OPERATIONS_PREFERRED_DIMENSIONS.map((dimension) => {
        const sourceColumn = resolveSemanticDimensionSourceColumn(contract, dimension);
        return sourceColumn && profile.categoricalColumns.includes(sourceColumn) ? sourceColumn : null;
      })
    );
    if (operationsDimension) {
      return operationsDimension;
    }
  }

  return firstAvailable(
    PREFERRED_CANONICAL_DIMENSIONS
      .filter((dimension) => dimension !== "date")
      .map((dimension) => {
        const sourceColumn = resolveSemanticDimensionSourceColumn(contract, dimension);
        return sourceColumn && profile.categoricalColumns.includes(sourceColumn) ? sourceColumn : null;
      })
  );
}

function resolvePreferredDateDimension(profile: DatasetProfile) {
  const contract = profile.semanticContract;
  const sourceColumn = contract ? resolveSemanticDimensionSourceColumn(contract, "date") : null;
  if (sourceColumn && profile.datetimeColumns.includes(sourceColumn)) {
    return sourceColumn;
  }

  return profile.datetimeColumns[0] ?? null;
}

function resolveNamedMetrics(profile: DatasetProfile) {
  const metrics = new Set<string>();

  for (const column of profile.numericColumns) {
    for (const aliases of Object.values(KPI_ALIASES)) {
      if (aliases.some((alias) => column.includes(alias))) {
        metrics.add(column);
      }
    }
  }

  return [...metrics];
}

export function analyzeDatasetCapabilities(
  profile: DatasetProfile,
  kpis: KpiCandidate[]
): DatasetCapabilities {
  const semanticContract = profile.semanticContract;
  const namedMetrics = resolveNamedMetrics(profile);
  const derivedMetrics: string[] = [];
  const preferredDateDimension = resolvePreferredDateDimension(profile);
  const filteredNumericColumns = businessNumericColumns(profile);
  const filteredCategoricalColumns = businessCategoricalColumns(profile);
  const semanticDimensions = semanticDimensionColumns(profile);

  if (semanticContract) {
    derivedMetrics.push(...semanticContract.derivedMetrics);
  }

  if (!namedMetrics.includes("roas") && profile.numericColumns.includes("revenue") && profile.numericColumns.includes("cost")) {
    derivedMetrics.push("roas");
  }

  if (
    !namedMetrics.includes("cvr") &&
    profile.numericColumns.includes("conversions") &&
    profile.numericColumns.includes("clicks")
  ) {
    derivedMetrics.push("cvr");
  }

  const categoricalDimensions = rankColumns(
    unique([...semanticDimensions, ...filteredCategoricalColumns]),
    DIMENSION_HINTS
  );
  const segmentFields = categoricalDimensions.filter((column) =>
    DIMENSION_HINTS.some((hint) => column.includes(hint))
  );
  const funnelStageFields = profile.columns
    .filter((column) => column.kind === "categorical" && FUNNEL_HINTS.some((hint) => column.name.includes(hint)))
    .map((column) => column.name);

  return {
    numericMetrics: unique([
      ...(semanticContract?.availableMetrics ?? []),
      ...namedMetrics,
      ...filteredNumericColumns
    ]),
    categoricalDimensions,
    datetimeFields: unique([
      ...(preferredDateDimension ? [preferredDateDimension] : []),
      ...profile.datetimeColumns
    ]),
    kpiCandidates: kpis.map((kpi) => kpi.column),
    segmentFields,
    comparisonFields: segmentFields.length > 0 ? segmentFields : categoricalDimensions,
    anomalyFields: unique([
      ...profile.outliers.map((item) => item.column),
      ...profile.numericColumns,
      ...(semanticContract?.availableMetrics ?? [])
    ]),
    derivedMetrics: unique(derivedMetrics),
    defaultMetric:
      resolvePreferredMetric(profile, kpis) ??
      semanticContract?.availableMetrics[0] ??
      namedMetrics[0] ??
      profile.numericColumns[0] ??
      null,
    defaultDimension:
      resolvePreferredDimension(profile) ??
      categoricalDimensions[0] ??
      null,
    defaultDateDimension: preferredDateDimension,
    funnelStageFields: unique(funnelStageFields),
    semanticContract
  };
}
