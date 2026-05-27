import type { DatasetRow, PrimitiveValue } from "../types.js";
import { normalizeColumnNames } from "./columnNormalization.js";
import { detectDatasetStructureHint } from "./datasetStructureHints.js";
import { detectChannelHints, detectOutcomeHints } from "./domainHints.js";
import {
  type CleanedColumnProfile,
  type CleanedDatasetProfile,
  type ColumnNameMapping,
  type DatasetReliabilityMetadata,
  type ValueNormalizationMetadata
} from "./types.js";
import { normalizeSampleValue, inferPhysicalType } from "./valueNormalization.js";
import { buildNormalizationWarnings } from "./warnings.js";

function emptyMetadata(): ValueNormalizationMetadata {
  return {
    normalizedMoneyValueCount: 0,
    normalizedPercentageValueCount: 0,
    booleanLikeValueCount: 0,
    dateLikeValueCount: 0
  };
}

function addMetadata(target: ValueNormalizationMetadata, partial: Partial<ValueNormalizationMetadata>) {
  target.normalizedMoneyValueCount += partial.normalizedMoneyValueCount ?? 0;
  target.normalizedPercentageValueCount += partial.normalizedPercentageValueCount ?? 0;
  target.booleanLikeValueCount += partial.booleanLikeValueCount ?? 0;
  target.dateLikeValueCount += partial.dateLikeValueCount ?? 0;
}

function collectColumnValues(rows: DatasetRow[], columnName: string): PrimitiveValue[] {
  return rows.map((row) => row[columnName] ?? null);
}

function buildColumnProfile(mapping: ColumnNameMapping, rows: DatasetRow[]): CleanedColumnProfile {
  const originalValues = collectColumnValues(rows, mapping.originalName);
  const cleanedValues = originalValues.map((value) => normalizeSampleValue(value, mapping.canonicalName));
  const cleanedSampleValues = cleanedValues
    .map((entry) => entry.value)
    .filter((value, index, values) => values.findIndex((candidate) => candidate === value) === index)
    .slice(0, 8);
  const metadata = emptyMetadata();

  for (const entry of cleanedValues) {
    addMetadata(metadata, entry.metadata);
  }

  const stringValues = cleanedValues.map((entry) => entry.value);
  const nonNullValues = stringValues.filter((value) => value !== null);
  const channelHints = detectChannelHints(cleanedSampleValues);
  const outcomeHints = detectOutcomeHints(cleanedSampleValues);

  return {
    originalName: mapping.originalName,
    canonicalName: mapping.canonicalName,
    physicalType: inferPhysicalType(stringValues),
    nullCount: originalValues.filter((value) => value === null || value === undefined).length,
    emptyStringCount: originalValues.filter((value) => typeof value === "string" && value.trim() === "").length,
    nonNullCount: nonNullValues.length,
    uniqueCount: new Set(nonNullValues.map((value) => JSON.stringify(value))).size,
    cleanedSampleValues,
    valueMetadata: metadata,
    channelHints,
    outcomeHints,
    warnings: []
  };
}

function buildReliabilityMetadata(rows: DatasetRow[], columns: CleanedColumnProfile[]): DatasetReliabilityMetadata {
  const spendColumns = columns
    .map((column) => column.canonicalName)
    .filter((columnName) => /\b(spend|cost|ad_spend|media_cost|budget)\b/.test(columnName));
  const channelColumns = columns
    .map((column) => column.canonicalName)
    .filter((columnName) => /\b(channel|source|medium|source_medium)\b/.test(columnName));

  let paidRows = 0;
  let unpaidRows = 0;
  let rowsWithMissingSpend = 0;
  let rowsWithZeroSpend = 0;

  for (const row of rows) {
    const channelValues = channelColumns
      .map((columnName) => row[columnName])
      .filter((value): value is PrimitiveValue => value !== undefined);
    const channelHints = detectChannelHints(channelValues);
    const spendValues = spendColumns.map((columnName) => normalizeSampleValue(row[columnName] ?? null, columnName).value);
    const firstSpend = spendValues.find((value) => typeof value === "number") as number | undefined;

    if (channelHints.includes("paid")) {
      paidRows += 1;
      if (firstSpend === undefined) {
        rowsWithMissingSpend += 1;
      } else if (firstSpend === 0) {
        rowsWithZeroSpend += 1;
      }
    } else if (channelHints.includes("unpaid")) {
      unpaidRows += 1;
    }
  }

  return {
    paidRows,
    unpaidRows,
    rowsWithMissingSpend,
    rowsWithZeroSpend
  };
}

export function buildCleanedDatasetProfile(rows: DatasetRow[]): CleanedDatasetProfile {
  const originalColumnNames = Object.keys(rows[0] ?? {});
  const columnMappings = normalizeColumnNames(originalColumnNames);
  const columns = columnMappings.map((mapping) => buildColumnProfile(mapping, rows));
  const duplicateCanonicalNames = columnMappings
    .filter((mapping) => mapping.duplicateIndex !== undefined)
    .map((mapping) => mapping.canonicalName);
  const originalToCanonical = Object.fromEntries(columnMappings.map((mapping) => [mapping.originalName, mapping.canonicalName]));
  const canonicalToOriginal = columnMappings.reduce<Record<string, string[]>>((accumulator, mapping) => {
    accumulator[mapping.canonicalName] = [...(accumulator[mapping.canonicalName] ?? []), mapping.originalName];
    return accumulator;
  }, {});
  const structureHint = detectDatasetStructureHint(columnMappings.map((mapping) => mapping.canonicalName));
  const reliability = buildReliabilityMetadata(
    rows.map((row) =>
      Object.fromEntries(columnMappings.map((mapping) => [mapping.canonicalName, row[mapping.originalName] ?? null]))
    ),
    columns
  );
  const warnings = buildNormalizationWarnings({
    rowCount: rows.length,
    columns,
    duplicateCanonicalNames,
    structureGrain: structureHint.grain,
    paidRows: reliability.paidRows,
    unpaidRows: reliability.unpaidRows,
    rowsWithMissingSpend: reliability.rowsWithMissingSpend
  });

  return {
    rowCount: rows.length,
    columnCount: originalColumnNames.length,
    columns,
    columnMappings,
    originalToCanonical,
    canonicalToOriginal,
    structureHint,
    warnings,
    reliability
  };
}

export * from "./types.js";
export * from "./columnNormalization.js";
export * from "./valueNormalization.js";
export * from "./datasetStructureHints.js";
export * from "./domainHints.js";
export * from "./warnings.js";
