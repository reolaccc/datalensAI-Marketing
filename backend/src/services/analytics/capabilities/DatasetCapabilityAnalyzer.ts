import type { DatasetCapabilities, DatasetProfile, KpiCandidate } from "../../../analytics/types.js";
import { KPI_ALIASES } from "../../../utils/inference.js";
import { resolveSemanticDimensionSourceColumn } from "../../../analytics/semanticContract.js";

const DIMENSION_HINTS = [
  "campaign",
  "channel",
  "device",
  "region",
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

function resolvePreferredMetric(profile: DatasetProfile, kpis: KpiCandidate[]) {
  const contract = profile.semanticContract;
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
  if (!contract) {
    return null;
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

  const categoricalDimensions = rankColumns(profile.categoricalColumns, DIMENSION_HINTS);
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
      ...profile.numericColumns
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
