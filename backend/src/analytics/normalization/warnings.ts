import type { DatasetRow, PrimitiveValue } from "../types.js";
import { parseDateValue, quantile } from "../../utils/inference.js";
import { normalizeSampleValue } from "./valueNormalization.js";
import { detectOutcomeHints } from "./domainHints.js";
import type { CleanedDatasetProfile, CleaningWarning, CleanedColumnProfile, ColumnNameMapping } from "./types.js";

type SummaryDomain = "call_tracking" | "operations" | "crm" | "retail" | "energy" | "generic";

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

function normalizeLabel(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function hasColumn(columns: CleanedColumnProfile[], patterns: RegExp[]) {
  return columns.some((column) => patterns.some((pattern) => pattern.test(column.canonicalName)));
}

function matchingColumns(columns: CleanedColumnProfile[], patterns: RegExp[]) {
  return columns
    .map((column) => column.canonicalName)
    .filter((columnName) => patterns.some((pattern) => pattern.test(columnName)));
}

function uniqueLabels(labels: string[]) {
  return [...new Set(labels.filter(Boolean))];
}

function summaryFieldLabel(value: string) {
  return normalizeLabel(value)
    .replace(/\bcustomer journey stage\b/g, "journey stage")
    .replace(/\bjourney label\b/g, "journey field")
    .replace(/\bcustomer journey\b/g, "customer journey")
    .replace(/\bsales stage\b/g, "journey stage")
    .replace(/\blifecycle stage\b/g, "journey stage")
    .replace(/\bowner team\b/g, "owner team")
    .replace(/\bowner pod\b/g, "owner team")
    .replace(/\bagent queue\b/g, "owner team")
    .replace(/\bcallback required\b/g, "callback")
    .replace(/\bcontact attempts\b/g, "contact attempts")
    .replace(/\bclosed won count\b/g, "closed-won outcomes")
    .replace(/\bdeal won\b/g, "closed-won outcome flag")
    .replace(/\bopportunity created\b/g, "opportunity-created outcomes")
    .replace(/\bopportunity opened\b/g, "opportunity-created outcomes")
    .replace(/\bestimated pipeline value aud\b/g, "estimated pipeline value")
    .replace(/\bexpected pipeline amount\b/g, "estimated pipeline value")
    .replace(/\bestimated pipeline value\b/g, "estimated pipeline value")
    .replace(/\bestimated value\b/g, "estimated value")
    .replace(/\brealized revenue aud\b/g, "realized revenue")
    .replace(/\brealized revenue\b/g, "realized revenue")
    .replace(/\bcall count\b/g, "call volume")
    .replace(/\btotal calls\b/g, "call volume")
    .replace(/\bcase count\b/g, "case volume")
    .replace(/\bresolved count\b/g, "resolved activity")
    .replace(/\bescalation count\b/g, "escalation activity")
    .replace(/\breopen count\b/g, "reopen activity")
    .replace(/\bcsat score\b/g, "CSAT score")
    .replace(/\btraffic src\b/g, "traffic source")
    .replace(/\btraffic origin\b/g, "traffic source")
    .replace(/\butm campaign name\b/g, "campaign label")
    .replace(/\bmkt medium\b/g, "marketing medium")
    .replace(/\bmissed calls\b/g, "missed-call outcomes")
    .replace(/\bqualified calls\b/g, "qualified outcomes")
    .replace(/\bconverted calls\b/g, "converted outcomes")
    .replace(/\btalk time sec\b/g, "talk time")
    .replace(/\btalk seconds\b/g, "talk time")
    .replace(/\bcall result\b/g, "call outcome")
    .replace(/\bqualified flag\b/g, "qualified outcome flag")
    .replace(/\bbooking created\b/g, "booking outcome flag")
    .replace(/\bsolar kwh\b/g, "solar output")
    .replace(/\bfacility load kwh\b/g, "load")
    .replace(/\bload kwh\b/g, "load")
    .replace(/\bgrid import kwh\b/g, "grid import")
    .replace(/\bgrid export kwh\b/g, "grid export")
    .replace(/\bgross margin pct\b/g, "gross margin")
    .replace(/\bgross sales value\b/g, "sales value")
    .replace(/\bfulfilment site\b/g, "fulfillment site")
    .replace(/\bfulfilment cost\b/g, "fulfillment cost")
    .replace(/\borders fulfilled\b/g, "fulfilled orders")
    .replace(/\borders requested\b/g, "requested orders")
    .replace(/\bcase intake\b/g, "case intake")
    .replace(/\bresolved cases\b/g, "resolved activity")
    .replace(/\bescalated cases\b/g, "escalation activity")
    .replace(/\breopened cases\b/g, "reopen activity")
    .replace(/\bavg handle minutes\b/g, "handle time")
    .replace(/\bsupport stream\b/g, "support stream")
    .replace(/\bsegment label\b/g, "segment");
}

function formatFieldList(fields: string[]) {
  const unique = uniqueLabels(fields).slice(0, 4);
  return unique.join(", ");
}

function inferSummaryDomain(profile: CleanedDatasetProfile) {
  const columns = profile.columns;
  const crmStageHit = hasColumn(columns, [/\bcustomer_journey\b/i, /\bcustomer_journey_stage\b/i, /\bjourney_label\b/i, /\bsales_stage\b/i, /\blifecycle_stage\b/i, /\bpipeline\b/i]);
  const crmFollowUpHit = hasColumn(columns, [/\bcallback_required\b/i, /\bcontact_attempts\b/i, /\bfollow_?up\b/i, /\brecontact\b/i]);
  const crmOwnerHit = hasColumn(columns, [/\bowner_team\b/i, /\bowner_pod\b/i, /\bagent_queue\b/i, /\baccount_owner\b/i, /\bsales_owner\b/i]);
  const crmOutcomeHit = hasColumn(columns, [/\bclosed_won\b/i, /\bclosed_won_count\b/i, /\bdeal_won\b/i, /\bopportunity_created\b/i, /\bopportunity_opened\b/i]);
  const crmValueHit = hasColumn(columns, [/\bestimated_pipeline_value\b/i, /\bestimated_value\b/i, /\bexpected_pipeline_amount\b/i, /\brealized_revenue\b/i, /\brevenue\b/i]);
  const crmIdHit = hasColumn(columns, [/\bcrm_record_id\b/i, /\blead_id\b/i, /\blead_reference\b/i, /\bcustomer_id\b/i, /\bopportunity_id\b/i]);
  const crmClusters = [crmStageHit, crmFollowUpHit, crmOwnerHit, crmOutcomeHit, crmValueHit, crmIdHit].filter(Boolean).length;
  const explicitCallTrackingHit = hasColumn(columns, [/\bcaller_number/i, /\btracking_number/i, /\btracking_line/i, /\bcall_start/i, /\bcall_started/i, /\btotal_calls\b/i, /\bcall_count\b/i, /\bwait_time/i, /\bduration_sec/i, /\btalk_seconds/i, /\bmissed_call_flag/i, /\bcall_outcome/i, /\bcall_result/i, /\bqualified_flag/i, /\bbooking_created/i]);
  const marketingTrackingHit = hasColumn(columns, [/\btraffic_src\b/i, /\btraffic_origin\b/i, /\butm_campaign\b/i, /\bmkt_medium\b/i, /\bcampaign\b/i, /\badgroup\b/i, /\bad_spend\b/i, /\bad_cost\b/i, /\broas\b/i]);

  if (hasColumn(columns, [/\bsolar_kwh\b/i, /\bload_kwh\b/i, /\bfacility_load_kwh\b/i, /\bgrid_import_kwh\b/i, /\bgrid_export_kwh\b/i, /\bbattery\b/i])) {
    return "energy" as const;
  }
  if (hasColumn(columns, [/\bwarehouse\b/i, /\bsku_group\b/i, /\bfulfilment_site\b/i, /\bstock\b/i, /\bstockout\b/i, /\bbackorder\b/i, /\bfulfillment\b/i, /\bfulfilment\b/i, /\bgross_margin\b/i, /\bmargin_band\b/i, /\binventory\b/i])) {
    return "retail" as const;
  }
  if (
    !explicitCallTrackingHit &&
    !marketingTrackingHit &&
    (
      (crmStageHit && (crmFollowUpHit || crmOwnerHit || crmOutcomeHit)) ||
      (crmFollowUpHit && crmOutcomeHit && crmValueHit) ||
      (crmClusters >= 3 && crmStageHit)
    )
  ) {
    return "crm" as const;
  }
  const operationsStructureHit = hasColumn(columns, [/\bservice_line\b/i, /\bqueue_name\b/i, /\bsupport_stream\b/i]);
  const operationsPressureHit = hasColumn(columns, [/\bcase_intake\b/i, /\bresolved_cases\b/i, /\bescalated_cases\b/i, /\breopened_cases\b/i, /\bavg_handle_minutes\b/i, /\bsla_met\b/i, /\btalk_time\b/i, /\bmissed_reason\b/i, /\bcallback_required\b/i, /\bops_cost\b/i]);
  if (operationsStructureHit || (operationsPressureHit && !marketingTrackingHit && !crmStageHit)) {
    return "operations" as const;
  }
  if (explicitCallTrackingHit || (marketingTrackingHit && hasColumn(columns, [/\bcall_uid\b/i, /\bcall_result\b/i, /\bqualified_flag\b/i, /\bbooking_created\b/i])) || hasColumn(columns, [/\bcall_uid\b/i, /\benquiry_ref\b/i, /\blead_quality_flag\b/i, /\bjob_won_flag\b/i])) {
    return "call_tracking" as const;
  }
  return "generic" as const;
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
        /\b(disposition|outcome|status|qualified_calls|qualified_flag|missed_calls|converted_calls|converted_event|answered_calls|booking_created|opportunity_opened|opportunity_created|deal_won|closed_won|resolved_cases|escalated_cases|sla_met|completion_flag)\b/.test(
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
        /\b(qualified_calls|qualified_flag|qualified_event|qualified_call_count|qualified_leads|disposition|outcome|status)\b/.test(column.canonicalName)
    )
    .map((column) => column.canonicalName);
}

function findCallCountColumns(columns: CleanedColumnProfile[]) {
  return columns
    .filter((column) => /\b(total_calls|call_count|calls|call_volume|inbound_calls|event_count)\b/.test(column.canonicalName))
    .map((column) => column.canonicalName);
}

function findDateColumns(columns: CleanedColumnProfile[]) {
  return columns
    .filter(
      (column) =>
        column.physicalType === "datetime" ||
        /\b(date|datetime|timestamp|time|created_on|observed_on|work_date|stock_day|period_date|reading_date|event_ref)\b/.test(column.canonicalName)
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

function buildRecordCountNote(
  domain: SummaryDomain,
  rows: DatasetRow[],
  columns: CleanedColumnProfile[],
  totalRows: number
) {
  const serviceLineColumn = findBestDimensionColumn(columns, [/\bservice_line\b/i]);
  const journeyColumn = findBestDimensionColumn(columns, [/\bcustomer_journey\b/i, /\bcustomer_journey_stage\b/i, /\bjourney_label\b/i, /\bsales_stage\b/i, /\blifecycle_stage\b/i]);
  const siteColumn = findBestDimensionColumn(columns, [/\bsite\b/i, /\bsite_name\b/i]);
  const warehouseColumn = findBestDimensionColumn(columns, [/\bwarehouse\b/i, /\bfulfilment_site\b/i, /\bfulfillment_site\b/i]);
  const sourceColumn = findBestDimensionColumn(columns, [/\btraffic_src\b/i, /\btraffic_origin\b/i, /\bchannel\b/i, /\bsource\b/i, /\bmedium\b/i]);
  const supportColumn = findBestDimensionColumn(columns, [/\bservice_line\b/i, /\bsupport_stream\b/i, /\bqueue_name\b/i]);
  const genericGroupingColumn = findBestDimensionColumn(columns, [/\bsegment\b/i, /\bsegment_label\b/i, /\bgroup_name\b/i, /\bcategory\b/i, /\bregion\b/i]);

  if (domain === "crm" && journeyColumn) {
    return `${totalRows.toLocaleString()} rows loaded; CRM grouping coverage includes ${countUniqueValues(rows, journeyColumn).toLocaleString()} ${pluralizeUnit(countUniqueValues(rows, journeyColumn), "journey")}.`;
  }
  if (domain === "operations" && (serviceLineColumn || supportColumn)) {
    const column = serviceLineColumn ?? supportColumn!;
    return `${totalRows.toLocaleString()} rows loaded; support grouping coverage includes ${countUniqueValues(rows, column).toLocaleString()} ${pluralizeUnit(countUniqueValues(rows, column), "service group")}.`;
  }
  if (domain === "energy" && siteColumn) {
    return `${totalRows.toLocaleString()} rows loaded; site coverage includes ${countUniqueValues(rows, siteColumn).toLocaleString()} ${pluralizeUnit(countUniqueValues(rows, siteColumn), "site")}.`;
  }
  if (domain === "retail" && warehouseColumn) {
    return `${totalRows.toLocaleString()} rows loaded; fulfillment location coverage includes ${countUniqueValues(rows, warehouseColumn).toLocaleString()} ${pluralizeUnit(countUniqueValues(rows, warehouseColumn), "location")}.`;
  }
  if (domain === "call_tracking" && sourceColumn) {
    return `${totalRows.toLocaleString()} rows loaded; source coverage includes ${countUniqueValues(rows, sourceColumn).toLocaleString()} ${pluralizeUnit(countUniqueValues(rows, sourceColumn), "traffic source")}.`;
  }
  if (genericGroupingColumn) {
    return `${totalRows.toLocaleString()} rows loaded; grouping coverage includes ${countUniqueValues(rows, genericGroupingColumn).toLocaleString()} ${pluralizeUnit(countUniqueValues(rows, genericGroupingColumn), "group")}.`;
  }

  return `${totalRows.toLocaleString()} rows loaded for structural review.`;
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

function buildDomainStructureNote(domain: SummaryDomain, profile: CleanedDatasetProfile) {
  const columns = profile.columns;

  if (domain === "crm") {
    const fields = formatFieldList([
      ...matchingColumns(columns, [/\bcustomer_journey\b/i, /\bcustomer_journey_stage\b/i, /\bjourney_label\b/i, /\bsales_stage\b/i, /\blifecycle_stage\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bowner_team\b/i, /\bowner_pod\b/i, /\bagent_queue\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bcallback_required\b/i, /\bcontact_attempts\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bclosed_won\b/i, /\bclosed_won_count\b/i, /\bdeal_won\b/i, /\bopportunity_created\b/i, /\bopportunity_opened\b/i]).map(summaryFieldLabel)
    ]);

    return fields ? `Available CRM fields: ${fields}.` : null;
  }

  if (domain === "call_tracking") {
    const callCountField = findExplicitCallCountColumn(profile);
    const callCountNote = callCountField ? `Call volume can be read from ${summaryFieldLabel(callCountField)}.` : null;
    const fields = formatFieldList([
      ...matchingColumns(columns, [/\btraffic_src\b/i, /\btraffic_origin\b/i, /\bmkt_medium\b/i, /\bcampaign\b/i, /\butm_campaign\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bmissed_call_flag\b/i, /\bqualified_calls?\b/i, /\bqualified_flag\b/i, /\bconverted_calls?\b/i, /\bbooking_created\b/i, /\bcall_outcome\b/i, /\bcall_result\b/i, /\btracking_line\b/i]).map(summaryFieldLabel)
    ]);

    return callCountNote ?? (fields ? `Available call-tracking fields: ${fields}.` : null);
  }

  if (domain === "operations") {
    const fields = formatFieldList([
      ...matchingColumns(columns, [/\bservice_line\b/i, /\bsupport_stream\b/i, /\bqueue_name\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bcallback_required\b/i, /\bmissed_reason\b/i, /\bcall_answered\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\btalk_time\b/i, /\bwait_time\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bcase_intake\b/i, /\bresolved_count\b/i, /\bresolved_cases\b/i, /\bescalation_count\b/i, /\bescalated_cases\b/i, /\breopen_count\b/i, /\breopened_cases\b/i, /\bcsat_score\b/i, /\bsla_met\b/i]).map(summaryFieldLabel)
    ]);

    return fields ? `Available support operations fields: ${fields}.` : null;
  }

  if (domain === "retail") {
    const fields = formatFieldList([
      ...matchingColumns(columns, [/\bwarehouse\b/i, /\bfulfilment_site\b/i, /\bfulfillment_site\b/i, /\bcategory\b/i, /\bsku_group\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bfulfilled_orders\b/i, /\borders_fulfilled\b/i, /\borders_requested\b/i, /\bfulfillment_cost\b/i, /\bfulfilment_cost\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bgross_margin\b/i, /\bmargin_band\b/i, /\bstockout\b/i, /\bbackorder\b/i]).map(summaryFieldLabel)
    ]);

    return fields ? `Available retail operations fields: ${fields}.` : null;
  }

  if (domain === "energy") {
    const fields = formatFieldList([
      ...matchingColumns(columns, [/\bsite\b/i, /\bsite_name\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bsolar_kwh\b/i, /\bload_kwh\b/i, /\bfacility_load_kwh\b/i]).map(summaryFieldLabel),
      ...matchingColumns(columns, [/\bgrid_import_kwh\b/i, /\bgrid_export_kwh\b/i]).map(summaryFieldLabel)
    ]);

    return fields ? `Available energy fields: ${fields}.` : null;
  }

  const fields = formatFieldList([
    ...matchingColumns(columns, [/\bsegment\b/i, /\bsegment_label\b/i, /\bgroup_name\b/i, /\bteam\b/i, /\bcategory\b/i, /\bsource\b/i, /\bstatus_stage\b/i]).map(summaryFieldLabel),
    ...matchingColumns(columns, [/\bactivity_count\b/i, /\bactivity_units\b/i, /\bobserved_value\b/i, /\bvalue_estimate\b/i, /\bestimated_value\b/i, /\brevenue\b/i, /\bcase_count\b/i, /\bquality_score\b/i, /\bquality_index\b/i, /\bdelay_days\b/i]).map(summaryFieldLabel)
  ]);

  return fields ? `Available generic fields: ${fields}; business meaning is not assumed.` : null;
}

function buildDomainValueOrOutcomeNote(
  domain: SummaryDomain,
  profile: CleanedDatasetProfile,
  rows: DatasetRow[],
  spendColumns: string[],
  revenueColumns: string[],
  outcomeColumns: string[]
) {
  const columns = profile.columns;
  const totalRows = rows.length;
  const spendCoverage = spendColumns.length > 0 ? countCoveredRows(rows, spendColumns, "numeric") : 0;
  const revenueCoverage = revenueColumns.length > 0 ? countCoveredRows(rows, revenueColumns, "numeric") : 0;
  const outcomeCoverage = outcomeColumns.length > 0 ? countCoveredRows(rows, outcomeColumns) : 0;

  if (domain === "crm") {
    const hasEstimatedValue = hasColumn(columns, [/\bestimated_pipeline_value\b/i, /\bestimated_value\b/i]);
    const hasRealizedRevenue = hasColumn(columns, [/\brealized_revenue\b/i, /\brevenue\b/i]);
    if (hasEstimatedValue && hasRealizedRevenue) {
      return "Value interpretation is partially grounded because estimated and realized value are available but should not be treated as the same metric.";
    }
    const outcomeFields = formatFieldList(
      matchingColumns(columns, [/\bclosed_won\b/i, /\bclosed_won_count\b/i, /\bdeal_won\b/i, /\bopportunity_created\b/i, /\bopportunity_opened\b/i]).map(summaryFieldLabel)
    );
    if (outcomeFields) {
      return `Outcome fields are available: ${outcomeFields}.`;
    }
    if (hasEstimatedValue) {
      return "Estimated value is available, but realized outcomes should be checked separately before financial interpretation.";
    }
    return null;
  }

  if (domain === "call_tracking") {
    const outcomeFields = formatFieldList(
      matchingColumns(columns, [/\bmissed_call_flag\b/i, /\bqualified_calls?\b/i, /\bqualified_flag\b/i, /\bconverted_calls?\b/i, /\bbooking_created\b/i, /\bcall_outcome\b/i, /\bcall_result\b/i]).map(summaryFieldLabel)
    );
    if (spendColumns.length > 0 || revenueColumns.length > 0) {
      const coverageBase = spendColumns.length > 0 && spendCoverage < totalRows
        ? `Spend coverage: ${spendCoverage}/${totalRows} records`
        : revenueColumns.length > 0 && revenueCoverage < totalRows
        ? `Revenue coverage: ${revenueCoverage}/${totalRows} records`
        : "Spend and revenue fields are available";
      return `${coverageBase}; efficiency comparisons should depend on spend and revenue coverage.`;
    }
    return outcomeFields ? `Outcome fields are available: ${outcomeFields}.` : null;
  }

  if (domain === "operations") {
    const outcomeFields = formatFieldList(
      matchingColumns(columns, [/\bcallback_required\b/i, /\bmissed_reason\b/i, /\bcall_answered\b/i, /\bcase_intake\b/i, /\bresolved_count\b/i, /\bresolved_cases\b/i, /\bescalation_count\b/i, /\bescalated_cases\b/i, /\breopen_count\b/i, /\breopened_cases\b/i, /\bcsat_score\b/i, /\bsla_met\b/i]).map(summaryFieldLabel)
    );
    return outcomeFields ? `Operational outcome fields are available: ${outcomeFields}.` : null;
  }

  if (domain === "retail") {
    const retailFields = formatFieldList(
      matchingColumns(columns, [/\bfulfilled_orders\b/i, /\borders_fulfilled\b/i, /\borders_requested\b/i, /\bfulfillment_cost\b/i, /\bfulfilment_cost\b/i, /\bgross_margin\b/i, /\bmargin_band\b/i, /\bstockout\b/i, /\bbackorder\b/i]).map(summaryFieldLabel)
    );
    return retailFields ? `Inventory and fulfillment fields are available: ${retailFields}.` : null;
  }

  if (domain === "energy") {
    return hasColumn(columns, [/\bsite\b/i, /\bsite_name\b/i]) ? "Site-level comparisons are available; interpretation should separate solar, load, and grid measures." : null;
  }

  if (outcomeColumns.length > 0 && outcomeCoverage > 0) {
    return `Outcome-style fields are available in ${outcomeCoverage}/${totalRows} records, but domain meaning remains partial.`;
  }
  if (revenueColumns.length > 0 && revenueCoverage > 0) {
    return `Value-like fields are available in ${revenueCoverage}/${totalRows} records, but they should not be promoted to revenue without stronger grounding.`;
  }
  if (domain === "generic") {
    const genericMeasures = formatFieldList(
      matchingColumns(columns, [/\bactivity_count\b/i, /\bactivity_units\b/i, /\bobserved_value\b/i, /\bvalue_estimate\b/i, /\bquality_score\b/i, /\bquality_index\b/i, /\bcompletion_flag\b/i, /\bdelay_days\b/i]).map(summaryFieldLabel)
    );
    if (genericMeasures) {
      return `Neutral measures are available: ${genericMeasures}.`;
    }
  }

  return null;
}

function buildQualityOrCoverageNote(
  domain: SummaryDomain,
  profile: CleanedDatasetProfile,
  rows: DatasetRow[],
  spendColumns: string[],
  revenueColumns: string[],
  outcomeColumns: string[]
) {
  const totalRows = rows.length;
  const spendCoverage = spendColumns.length > 0 ? countCoveredRows(rows, spendColumns, "numeric") : 0;
  const revenueCoverage = revenueColumns.length > 0 ? countCoveredRows(rows, revenueColumns, "numeric") : 0;
  const outcomeCoverage = outcomeColumns.length > 0 ? countCoveredRows(rows, outcomeColumns) : 0;

  if (profile.reliability.rowsWithMissingSpend > 0 && spendColumns.length > 0) {
    return `Spend-based analysis is partially reliable because ${spendCoverage}/${totalRows} records contain spend values.`;
  }
  if (revenueColumns.length > 0 && revenueCoverage > 0 && revenueCoverage < totalRows) {
    return `Financial interpretation is partially grounded because ${revenueCoverage}/${totalRows} records contain value fields.`;
  }
  if (outcomeColumns.length > 0 && outcomeCoverage > 0 && outcomeCoverage < totalRows) {
    return `Outcome interpretation is partially grounded because ${outcomeCoverage}/${totalRows} records contain outcome values.`;
  }
  if (domain === "generic" && (revenueColumns.length > 0 || outcomeColumns.length > 0)) {
    return "Domain grounding is partial; comparisons should stay close to visible fields and avoid business-specific interpretation.";
  }
  if (domain === "generic") {
    return "Domain grounding is partial; value comparisons should stay neutral and avoid financial interpretation.";
  }

  return null;
}

function buildColumnCoverageNote(profile: CleanedDatasetProfile) {
  const numericCount = profile.columns.filter((column) => column.physicalType === "numeric").length;
  const categoricalCount = profile.columns.filter((column) => column.physicalType === "categorical").length;
  const datetimeCount = profile.columns.filter((column) => column.physicalType === "datetime").length;
  const parts = [
    numericCount > 0 ? `${numericCount} numeric ${pluralizeUnit(numericCount, "field")}` : "",
    categoricalCount > 0 ? `${categoricalCount} categorical ${pluralizeUnit(categoricalCount, "field")}` : "",
    datetimeCount > 0 ? `${datetimeCount} date ${pluralizeUnit(datetimeCount, "field")}` : ""
  ].filter(Boolean);

  return parts.length > 0 ? `Column coverage: ${parts.join(", ")}.` : null;
}

function buildGranularityNote(profile: CleanedDatasetProfile) {
  if (profile.structureHint.grain === "aggregated_call_summary") {
    return "Rows appear aggregated, so rate and ratio comparisons should use explicit denominator fields.";
  }
  if (profile.structureHint.grain === "row_level_call_log") {
    return "Rows appear event-level, so counts can usually be read as record-level activity.";
  }
  return null;
}

function polishSummaryNote(note: string) {
  return note
    .replace(/\bRevenue-related analysis\b/i, "Financial interpretation")
    .replace(/\bdriver\b/i, "field");
}

export function buildDataSummaryNotes(profile: CleanedDatasetProfile, rows: DatasetRow[]) {
  const notes: string[] = [];
  const canonicalRows = buildCanonicalRows(rows, profile.columnMappings);
  const domain = inferSummaryDomain(profile);
  const totalRows = canonicalRows.length;
  const spendColumns = findColumns(profile.columns, /\b(spend|spend_amount|cost|ad_cost|ad_spend|media_cost|budget|fulfillment_cost|fulfilment_cost)/);
  const revenueColumns = findColumns(profile.columns, /\b(revenue|return_amount|sale_value|sales_value|gross_sales_value|sales|income|gmv|conversion_value|booked_job_value|quote_value|value_estimate|observed_value|estimated_value|expected_pipeline_amount|estimated_pipeline_value|realized_revenue)/);
  const outcomeColumns = findOutcomeColumns(profile.columns);

  const candidates = [
    buildRecordCountNote(domain, canonicalRows, profile.columns, totalRows),
    buildDateRangeNote(canonicalRows, findDateColumns(profile.columns)),
    buildColumnCoverageNote(profile),
    buildGranularityNote(profile),
    buildQualityOrCoverageNote(domain, profile, canonicalRows, spendColumns, revenueColumns, outcomeColumns),
    buildDomainStructureNote(domain, profile),
    buildDomainValueOrOutcomeNote(domain, profile, canonicalRows, spendColumns, revenueColumns, outcomeColumns)
  ].filter((note): note is string => Boolean(note));

  for (const note of candidates) {
    if (!notes.includes(note)) {
      notes.push(note);
    }
  }

  return notes.slice(0, 5).map(polishSummaryNote);
}
