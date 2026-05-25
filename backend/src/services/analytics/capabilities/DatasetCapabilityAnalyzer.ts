import type { DatasetCapabilities, DatasetProfile, KpiCandidate } from "../../../analytics/types.js";
import { KPI_ALIASES } from "../../../utils/inference.js";

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
    datetimeFields: [...profile.datetimeColumns],
    kpiCandidates: kpis.map((kpi) => kpi.column),
    segmentFields,
    comparisonFields: segmentFields.length > 0 ? segmentFields : categoricalDimensions,
    anomalyFields: unique([
      ...profile.outliers.map((item) => item.column),
      ...profile.numericColumns,
      ...(semanticContract?.availableMetrics ?? [])
    ]),
    derivedMetrics: unique(derivedMetrics),
    defaultMetric: kpis[0]?.column ?? semanticContract?.availableMetrics[0] ?? namedMetrics[0] ?? profile.numericColumns[0] ?? null,
    defaultDimension: categoricalDimensions[0] ?? null,
    funnelStageFields: unique(funnelStageFields),
    semanticContract
  };
}
