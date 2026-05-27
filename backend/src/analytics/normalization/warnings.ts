import type { DatasetRow, PrimitiveValue } from "../types.js";
import { parseDateValue, quantile } from "../../utils/inference.js";
import { normalizeSampleValue } from "./valueNormalization.js";
import { detectOutcomeHints } from "./domainHints.js";
import type { CleanedDatasetProfile, CleaningWarning, CleanedColumnProfile, ColumnNameMapping } from "./types.js";

function hasMetadata(columns: CleanedColumnProfile[], key: "normalizedMoneyValueCount" | "normalizedPercentageValueCount" | "dateLikeValueCount") {
  return columns.some((column) => column.valueMetadata[key] > 0);
}

export function buildNormalizationWarnings(params: {
  rowCount: number;
  columns: CleanedColumnProfile[];
  duplicateCanonicalNames: string[];
  structureGrain: CleanedDatasetProfile["structureHint"]["grain"];
  paidRows: number;
  unpaidRows: number;
  rowsWithMissingSpend: number;
}) {
  const warnings: CleaningWarning[] = [];

  for (const columnName of params.duplicateCanonicalNames) {
    warnings.push({
      code: "duplicate_canonical_name",
      severity: "info",
      columnName,
      message: `Some columns normalized to the same canonical name, so safe suffixes were added for ${columnName}.`
    });
  }

  if (params.structureGrain === "aggregated_call_summary") {
    warnings.push({
      code: "dataset_appears_aggregated",
      severity: "warning",
      message: "This dataset appears to contain campaign or channel summaries, so call totals should be read from the call-count fields."
    });
  }

  if (params.unpaidRows > 0) {
    warnings.push({
      code: "organic_or_unpaid_channels_detected",
      severity: "info",
      message: "Some unpaid channels are included, so paid efficiency metrics may exclude them."
    });
  }

  if (params.paidRows > 0 && params.rowsWithMissingSpend > 0) {
    warnings.push({
      code: "spend_appears_incomplete",
      severity: "warning",
      message: "Spend data appears incomplete, so ROAS may be less reliable."
    });
  }

  if (hasMetadata(params.columns, "normalizedMoneyValueCount")) {
    warnings.push({
      code: "money_values_normalized",
      severity: "info",
      message: "Some money values were normalized from text format."
    });
  }

  if (hasMetadata(params.columns, "normalizedPercentageValueCount")) {
    warnings.push({
      code: "percentage_values_normalized",
      severity: "info",
      message: "Some percentage values were normalized from text format."
    });
  }

  if (params.columns.some((column) => column.outcomeHints.length > 0)) {
    warnings.push({
      code: "outcome_values_grouped",
      severity: "info",
      message: "Some outcome values were grouped into call outcome families such as qualified or missed."
    });
  }

  if (hasMetadata(params.columns, "dateLikeValueCount")) {
    warnings.push({
      code: "date_like_values_detected",
      severity: "info",
      message: "Some date-like values were normalized from text format."
    });
  }

  return warnings;
}

function buildCanonicalRows(rows: DatasetRow[], mappings: ColumnNameMapping[]) {
  return rows.map((row) =>
    Object.fromEntries(mappings.map((mapping) => [mapping.canonicalName, row[mapping.originalName] ?? null]))
  );
}

function isPresent(value: PrimitiveValue) {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function countCoveredRows(rows: DatasetRow[], columnNames: string[], mode: "present" | "numeric" = "present") {
  if (columnNames.length === 0) {
    return 0;
  }

  return rows.filter((row) =>
    columnNames.some((columnName) => {
      const value = row[columnName] ?? null;

      if (mode === "numeric") {
        return typeof normalizeSampleValue(value, columnName).value === "number";
      }

      return isPresent(value);
    })
  ).length;
}

function findColumns(columns: CleanedColumnProfile[], pattern: RegExp) {
  return columns.map((column) => column.canonicalName).filter((columnName) => pattern.test(columnName));
}

function findBestDimensionColumn(columns: CleanedColumnProfile[], patterns: RegExp[]) {
  return (
    columns.find((column) => patterns.some((pattern) => pattern.test(column.canonicalName)))?.canonicalName ?? null
  );
}

function countUniqueValues(rows: DatasetRow[], columnName: string) {
  return new Set(
    rows
      .map((row) => row[columnName])
      .filter((value): value is PrimitiveValue => isPresent(value))
      .map((value) => String(value).trim())
  ).size;
}

function formatCoverage(label: string, covered: number, total: number) {
  return `${label}: ${covered}/${total} records available.`;
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pluralizeUnit(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function humanizeFieldLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateRange(start: Date, end: Date) {
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startText = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC"
  });
  const endText = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });

  return `Date range: ${startText}–${endText}.`;
}

function findOutcomeColumns(columns: CleanedColumnProfile[]) {
  return columns
    .filter(
      (column) =>
        column.outcomeHints.length > 0 ||
        /\b(disposition|outcome|status|qualified_calls|missed_calls|converted_calls|answered_calls)\b/.test(
          column.canonicalName
        )
    )
    .map((column) => column.canonicalName);
}

function findQualifiedOutcomeColumns(columns: CleanedColumnProfile[]) {
  return columns
    .filter(
      (column) =>
        column.outcomeHints.includes("qualified") ||
        /\b(qualified_calls|qualified_call_count|qualified_leads|disposition|outcome|status)\b/.test(column.canonicalName)
    )
    .map((column) => column.canonicalName);
}

function findCallCountColumns(columns: CleanedColumnProfile[]) {
  return columns
    .filter((column) => /\b(total_calls|call_count|calls|call_volume|inbound_calls)\b/.test(column.canonicalName))
    .map((column) => column.canonicalName);
}

function findDateColumns(columns: CleanedColumnProfile[]) {
  return columns
    .filter(
      (column) =>
        column.physicalType === "datetime" ||
        /\b(date|datetime|timestamp|time)\b/.test(column.canonicalName)
    )
    .map((column) => column.canonicalName);
}

function buildDateRangeNote(rows: DatasetRow[], dateColumns: string[]) {
  const dates = rows
    .flatMap((row) => dateColumns.map((columnName) => parseDateValue(row[columnName] ?? null)))
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => left.getTime() - right.getTime());

  if (dates.length === 0) {
    return null;
  }

  return formatDateRange(dates[0], dates[dates.length - 1]);
}

function isQualifiedValue(value: PrimitiveValue) {
  if (typeof value === "number") {
    return value > 0;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return detectOutcomeHints([value]).some((hint) => hint === "qualified" || hint === "converted");
}

function getNumericValue(row: DatasetRow, columnName: string) {
  const normalized = normalizeSampleValue(row[columnName] ?? null, columnName).value;
  return typeof normalized === "number" ? normalized : null;
}

function collectNumericMetricValues(rows: DatasetRow[], columnNames: string[]) {
  return rows
    .map((row) =>
      columnNames.reduce<number | null>((best, columnName) => {
        if (best !== null) {
          return best;
        }
        return getNumericValue(row, columnName);
      }, null)
    )
    .filter((value): value is number => value !== null);
}

function countUnusuallyHighValues(values: number[]) {
  if (values.length < 4) {
    return 0;
  }

  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const threshold = q3 + (q3 - q1) * 1.5;

  return values.filter((value) => value > threshold).length;
}

function countRowsWithUnusuallyHighMetric(rows: DatasetRow[], columnNames: string[]) {
  const values = collectNumericMetricValues(rows, columnNames);
  return countUnusuallyHighValues(values);
}

function countSpendWithoutQualifiedRows(rows: DatasetRow[], spendColumns: string[], qualifiedColumns: string[]) {
  if (spendColumns.length === 0 || qualifiedColumns.length === 0) {
    return 0;
  }

  return rows.filter((row) => {
    const hasSpend = spendColumns.some((columnName) => typeof normalizeSampleValue(row[columnName] ?? null, columnName).value === "number");
    if (!hasSpend) {
      return false;
    }

    const hasQualified = qualifiedColumns.some((columnName) => isQualifiedValue(normalizeSampleValue(row[columnName] ?? null, columnName).value));
    return !hasQualified;
  }).length;
}

function countRowsWithHighCostPerQualifiedCall(rows: DatasetRow[], spendColumns: string[], qualifiedColumns: string[]) {
  if (spendColumns.length === 0 || qualifiedColumns.length === 0) {
    return 0;
  }

  const ratios = rows
    .map((row) => {
      const spend = spendColumns.reduce<number | null>((best, columnName) => best ?? getNumericValue(row, columnName), null);
      const qualified = qualifiedColumns.reduce<number>((sum, columnName) => {
        const normalized = normalizeSampleValue(row[columnName] ?? null, columnName).value;
        if (typeof normalized === "number") {
          return sum + Math.max(0, normalized);
        }
        return sum + (isQualifiedValue(normalized) ? 1 : 0);
      }, 0);

      if (spend === null || qualified <= 0) {
        return null;
      }

      return spend / qualified;
    })
    .filter((value): value is number => value !== null);

  return countUnusuallyHighValues(ratios);
}

function countRowsWithHighCallVolumeLowQualified(
  rows: DatasetRow[],
  callCountColumns: string[],
  qualifiedColumns: string[]
) {
  if (callCountColumns.length === 0 || qualifiedColumns.length === 0) {
    return 0;
  }

  const rowMetrics = rows
    .map((row) => {
      const calls = callCountColumns.reduce<number | null>((best, columnName) => best ?? getNumericValue(row, columnName), null);
      if (calls === null || calls <= 0) {
        return null;
      }

      const qualified = qualifiedColumns.reduce<number>((sum, columnName) => {
        const normalized = normalizeSampleValue(row[columnName] ?? null, columnName).value;
        if (typeof normalized === "number") {
          return sum + Math.max(0, normalized);
        }
        return sum + (isQualifiedValue(normalized) ? 1 : 0);
      }, 0);

      return { calls, qualifiedRate: qualified / calls };
    })
    .filter((value): value is { calls: number; qualifiedRate: number } => value !== null);

  if (rowMetrics.length < 4) {
    return 0;
  }

  const highCallThreshold = quantile(
    rowMetrics.map((entry) => entry.calls).sort((left, right) => left - right),
    0.75
  );
  const lowQualifiedThreshold = quantile(
    rowMetrics.map((entry) => entry.qualifiedRate).sort((left, right) => left - right),
    0.25
  );

  return rowMetrics.filter((entry) => entry.calls >= highCallThreshold && entry.qualifiedRate <= lowQualifiedThreshold).length;
}

function buildCoverageNotes(
  rows: DatasetRow[],
  totalRows: number,
  denominatorLabel: "campaigns" | "records",
  columns: {
    spend: string[];
    revenue: string[];
    outcomes: string[];
  }
) {
  const coverage = [
    columns.spend.length > 0
      ? { label: "Spend", covered: countCoveredRows(rows, columns.spend, "numeric") }
      : null,
    columns.revenue.length > 0
      ? { label: "Revenue", covered: countCoveredRows(rows, columns.revenue, "numeric") }
      : null,
    columns.outcomes.length > 0
      ? { label: "Outcomes", covered: countCoveredRows(rows, columns.outcomes) }
      : null
  ].filter((entry): entry is { label: string; covered: number } => entry !== null);

  const partial = coverage
    .filter((entry) => entry.covered < totalRows)
    .map((entry) =>
      entry.label === "Outcomes"
        ? `Outcomes: ${entry.covered}/${totalRows} ${denominatorLabel} available.`
        : `${entry.label} coverage: ${entry.covered}/${totalRows} ${denominatorLabel}.`
    );
  const complete = coverage
    .filter((entry) => entry.covered === totalRows)
    .map((entry) =>
      entry.label === "Outcomes"
        ? `Outcomes: ${entry.covered}/${totalRows} ${denominatorLabel} available.`
        : `${entry.label} coverage: ${entry.covered}/${totalRows} ${denominatorLabel}.`
    );

  return { partial, complete };
}

function buildAnomalyNotes(rows: DatasetRow[], columns: {
  spend: string[];
  revenue: string[];
  outcomes: string[];
  qualified: string[];
  calls: string[];
}, grain: CleanedDatasetProfile["structureHint"]["grain"]) {
  const notes: string[] = [];
  const unit = grain === "aggregated_call_summary" ? "campaign" : "record";
  const units = grain === "aggregated_call_summary" ? "campaigns" : "records";
  const spendWithoutQualifiedRows = countSpendWithoutQualifiedRows(rows, columns.spend, columns.qualified);
  if (spendWithoutQualifiedRows > 0) {
    notes.push(`${formatCount(spendWithoutQualifiedRows, `${unit} has`, `${units} have`)} spend but no qualified calls.`);
  }

  const highCpqcRows = countRowsWithHighCostPerQualifiedCall(rows, columns.spend, columns.qualified);
  if (highCpqcRows > 0) {
    notes.push(`High CPQC detected in ${highCpqcRows} ${highCpqcRows === 1 ? unit : units}.`);
  }

  const highCallVolumeLowQualifiedRows = countRowsWithHighCallVolumeLowQualified(rows, columns.calls, columns.qualified);
  if (highCallVolumeLowQualifiedRows > 0) {
    notes.push(`${highCallVolumeLowQualifiedRows} ${highCallVolumeLowQualifiedRows === 1 ? unit : units} have high call volume but low qualified outcomes.`);
  }

  const highSpendRows = countRowsWithUnusuallyHighMetric(rows, columns.spend);
  if (highSpendRows > 0) {
    notes.push(`High spend detected in ${highSpendRows} ${highSpendRows === 1 ? unit : units}.`);
  }

  const highRevenueRows = countRowsWithUnusuallyHighMetric(rows, columns.revenue);
  if (highRevenueRows > 0) {
    notes.push(`Revenue outliers found in ${highRevenueRows} ${highRevenueRows === 1 ? unit : units}.`);
  }

  const highCallVolumeRows = countRowsWithUnusuallyHighMetric(rows, columns.calls);
  if (highCallVolumeRows > 0) {
    notes.push(`High call volume detected in ${highCallVolumeRows} ${highCallVolumeRows === 1 ? unit : units}.`);
  }

  return notes.slice(0, 2);
}

function buildStructureNote(
  profile: CleanedDatasetProfile,
  rows: DatasetRow[],
  totalRows: number,
  campaignColumn: string | null,
  channelColumn: string | null
) {
  const campaignCount = campaignColumn ? countUniqueValues(rows, campaignColumn) : 0;
  const channelCount = channelColumn ? countUniqueValues(rows, channelColumn) : 0;

  if (profile.structureHint.grain === "row_level_call_log") {
    if (campaignCount > 0) {
      return `${totalRows.toLocaleString()} calls across ${campaignCount.toLocaleString()} ${pluralizeUnit(campaignCount, "campaign")}.`;
    }
    if (channelCount > 0) {
      return `${totalRows.toLocaleString()} calls across ${channelCount.toLocaleString()} ${pluralizeUnit(channelCount, "channel")}.`;
    }
    return `${totalRows.toLocaleString()} ${pluralizeUnit(totalRows, "call")}.`;
  }

  if (campaignCount > 0 && channelCount > 0) {
    return `${campaignCount.toLocaleString()} ${pluralizeUnit(campaignCount, "campaign")} across ${channelCount.toLocaleString()} ${pluralizeUnit(channelCount, "channel")}.`;
  }
  if (campaignCount > 0) {
    return `${campaignCount.toLocaleString()} ${pluralizeUnit(campaignCount, "campaign")}.`;
  }
  if (channelCount > 0) {
    return `${channelCount.toLocaleString()} ${pluralizeUnit(channelCount, "channel")}.`;
  }

  return null;
}

function findExplicitCallCountColumn(profile: CleanedDatasetProfile) {
  const preferredNames = ["total_calls", "call_count", "calls", "call_volume", "inbound_calls"];

  for (const preferredName of preferredNames) {
    const mapping = profile.columnMappings.find((entry) => entry.canonicalName === preferredName);
    if (mapping) {
      return mapping.originalName;
    }
  }

  return (
    profile.columnMappings.find((entry) =>
      /\b(total_calls|call_count|calls|call_volume|inbound_calls)\b/.test(entry.canonicalName)
    )?.originalName ?? null
  );
}

export function buildDataSummaryNotes(profile: CleanedDatasetProfile, rows: DatasetRow[]) {
  const notes: string[] = [];
  const canonicalRows = buildCanonicalRows(rows, profile.columnMappings);
  const campaignColumn = findBestDimensionColumn(profile.columns, [/\bcampaign\b/i]);
  const channelColumn = findBestDimensionColumn(profile.columns, [/\bchannel\b/i, /\bsource_medium\b/i, /\bsource\b/i, /\bmedium\b/i]);
  const totalRows = canonicalRows.length;
  const spendColumns = findColumns(profile.columns, /\b(spend|cost|ad_spend|media_cost|budget)\b/);
  const revenueColumns = findColumns(profile.columns, /\b(revenue|sale_value|sales_value|sales|income|gmv|conversion_value)\b/);
  const outcomeColumns = findOutcomeColumns(profile.columns);
  const qualifiedColumns = findQualifiedOutcomeColumns(profile.columns);
  const callCountColumns = findCallCountColumns(profile.columns);
  const denominatorLabel = profile.structureHint.grain === "aggregated_call_summary" ? "campaigns" : "records";

  const structureNote = buildStructureNote(profile, canonicalRows, totalRows, campaignColumn, channelColumn);
  if (structureNote) {
    notes.push(structureNote);
  }

  const typedCoverageNotes = buildCoverageNotes(canonicalRows, totalRows, denominatorLabel, {
    spend: spendColumns,
    revenue: revenueColumns,
    outcomes: outcomeColumns
  });
  notes.push(...typedCoverageNotes.partial);

  if (profile.structureHint.grain === "aggregated_call_summary" && notes.length < 5) {
    const callCountField = findExplicitCallCountColumn(profile);
    notes.push(
      callCountField
        ? `${humanizeFieldLabel(callCountField)} field found; call volume uses that field.`
        : "Call-count field found; call volume uses that field."
    );
  }

  notes.push(
    ...buildAnomalyNotes(canonicalRows, {
      spend: spendColumns,
      revenue: revenueColumns,
      outcomes: outcomeColumns,
      qualified: qualifiedColumns,
      calls: callCountColumns
    }, profile.structureHint.grain).slice(0, Math.max(0, 5 - notes.length))
  );
  notes.push(...typedCoverageNotes.complete);

  const dateRangeNote = buildDateRangeNote(canonicalRows, findDateColumns(profile.columns));
  if (dateRangeNote && notes.length < 5) {
    notes.push(dateRangeNote);
  }

  return notes.slice(0, 5);
}
