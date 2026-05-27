import type { PrimitiveValue } from "../types.js";

export type PhysicalColumnType = "numeric" | "categorical" | "datetime" | "boolean" | "mixed" | "unknown";

export type DatasetGrainHint = "row_level_call_log" | "aggregated_call_summary" | "unknown";

export type ChannelSpendHint = "paid" | "unpaid" | "unknown";

export type OutcomeFamilyHint = "qualified" | "converted" | "missed" | "answered";

export type CleaningWarningCode =
  | "duplicate_canonical_name"
  | "dataset_appears_aggregated"
  | "organic_or_unpaid_channels_detected"
  | "spend_appears_incomplete"
  | "money_values_normalized"
  | "percentage_values_normalized"
  | "outcome_values_grouped"
  | "date_like_values_detected";

export interface CleaningWarning {
  code: CleaningWarningCode;
  severity: "info" | "warning";
  message: string;
  columnName?: string;
}

export interface ColumnNameMapping {
  originalName: string;
  canonicalName: string;
  duplicateIndex?: number;
  wasChanged: boolean;
}

export interface ValueNormalizationMetadata {
  normalizedMoneyValueCount: number;
  normalizedPercentageValueCount: number;
  booleanLikeValueCount: number;
  dateLikeValueCount: number;
}

export interface CleanedColumnProfile {
  originalName: string;
  canonicalName: string;
  physicalType: PhysicalColumnType;
  nullCount: number;
  emptyStringCount: number;
  nonNullCount: number;
  uniqueCount: number;
  cleanedSampleValues: PrimitiveValue[];
  valueMetadata: ValueNormalizationMetadata;
  channelHints: ChannelSpendHint[];
  outcomeHints: OutcomeFamilyHint[];
  warnings: CleaningWarning[];
}

export interface DatasetStructureHint {
  grain: DatasetGrainHint;
  confidence: number;
  signals: string[];
}

export interface DatasetReliabilityMetadata {
  paidRows: number;
  unpaidRows: number;
  rowsWithMissingSpend: number;
  rowsWithZeroSpend: number;
}

export interface CleanedDatasetProfile {
  rowCount: number;
  columnCount: number;
  columns: CleanedColumnProfile[];
  columnMappings: ColumnNameMapping[];
  originalToCanonical: Record<string, string>;
  canonicalToOriginal: Record<string, string[]>;
  structureHint: DatasetStructureHint;
  warnings: CleaningWarning[];
  reliability: DatasetReliabilityMetadata;
}
