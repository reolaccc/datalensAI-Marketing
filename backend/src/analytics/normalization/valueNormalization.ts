import type { PrimitiveValue } from "../types.js";
import type { PhysicalColumnType, ValueNormalizationMetadata } from "./types.js";

const BOOLEAN_TRUE_VALUES = new Set(["true", "yes", "y", "1"]);
const BOOLEAN_FALSE_VALUES = new Set(["false", "no", "n", "0"]);

function looksLikeIdentifierColumn(columnName: string) {
  return /(^|_)(id|uuid|guid|phone|number|tracking|reference|ref|caller|destination|enquiry|inquiry)(_|$)/i.test(columnName);
}

function looksLikePhoneValue(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function looksLikeCurrencyValue(value: string) {
  return /[$£€¥]/.test(value);
}

function looksLikePercentageValue(value: string) {
  return /%/.test(value.trim());
}

function parseSafeNumber(value: string) {
  const cleaned = value.replace(/[,$£€¥\s]/g, "");
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSafeDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^\d+$/.test(trimmed)) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(trimmed) || /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

export function normalizeSampleValue(
  value: PrimitiveValue,
  columnName: string
): { value: PrimitiveValue; metadata: Partial<ValueNormalizationMetadata> } {
  if (value === null || value === undefined) {
    return { value: null, metadata: {} };
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return { value, metadata: {} };
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return { value: null, metadata: {} };
  }

  const normalizedBoolean = trimmed.toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(normalizedBoolean)) {
    return { value: true, metadata: { booleanLikeValueCount: 1 } };
  }
  if (BOOLEAN_FALSE_VALUES.has(normalizedBoolean)) {
    return { value: false, metadata: { booleanLikeValueCount: 1 } };
  }

  const blockNumericParsing = looksLikeIdentifierColumn(columnName) || looksLikePhoneValue(trimmed);
  if (!blockNumericParsing && looksLikePercentageValue(trimmed)) {
    const parsed = parseSafeNumber(trimmed.replace(/%/g, ""));
    if (parsed !== null) {
      return {
        value: Number((parsed / 100).toFixed(6)),
        metadata: { normalizedPercentageValueCount: 1 }
      };
    }
  }

  if (!blockNumericParsing) {
    const parsed = parseSafeNumber(trimmed);
    if (parsed !== null) {
      return {
        value: parsed,
        metadata: looksLikeCurrencyValue(trimmed) ? { normalizedMoneyValueCount: 1 } : {}
      };
    }
  }

  if (!looksLikeIdentifierColumn(columnName)) {
    const parsedDate = parseSafeDate(trimmed);
    if (parsedDate) {
      return { value: parsedDate, metadata: { dateLikeValueCount: 1 } };
    }
  }

  return { value: trimmed, metadata: {} };
}

export function inferPhysicalType(values: PrimitiveValue[]): PhysicalColumnType {
  const populated = values.filter((value) => value !== null);
  if (populated.length === 0) {
    return "unknown";
  }

  const numericCount = populated.filter((value) => typeof value === "number").length;
  const booleanCount = populated.filter((value) => typeof value === "boolean").length;
  const datetimeCount = populated.filter((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)).length;

  if (numericCount === populated.length) {
    return "numeric";
  }
  if (booleanCount === populated.length) {
    return "boolean";
  }
  if (datetimeCount === populated.length) {
    return "datetime";
  }
  if (numericCount > 0 || booleanCount > 0 || datetimeCount > 0) {
    return "mixed";
  }

  return "categorical";
}
