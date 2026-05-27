import type { PrimitiveValue } from "../types.js";
import type { ChannelSpendHint, OutcomeFamilyHint } from "./types.js";

const UNPAID_PATTERNS = [/\borganic\b/i, /\bseo\b/i, /\bdirect\b/i, /\breferral\b/i, /\bemail\b/i];
const PAID_PATTERNS = [/\bgoogle ads\b/i, /\bpaid search\b/i, /\bppc\b/i, /\bmeta ads\b/i, /\bpaid social\b/i, /\bcpc\b/i];
const QUALIFIED_PATTERNS = [/\bqualified lead\b/i, /\bbooked appointment\b/i, /\bclosed won\b/i, /\bconverted\b/i, /\bsale\b/i, /\bquote sent\b/i];
const CONVERTED_PATTERNS = [/\bclosed won\b/i, /\bconverted\b/i, /\bsale\b/i];
const MISSED_PATTERNS = [/\bmissed\b/i, /\babandoned\b/i, /\bno answer\b/i, /\bvoicemail\b/i, /\bhung up\b/i];
const ANSWERED_PATTERNS = [/\banswered\b/i, /\bconnected\b/i, /\binbound\b/i, /\boutbound\b/i];

function asStrings(values: PrimitiveValue[]) {
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function detectChannelHints(values: PrimitiveValue[]): ChannelSpendHint[] {
  const strings = asStrings(values);
  const hints = new Set<ChannelSpendHint>();

  for (const value of strings) {
    if (UNPAID_PATTERNS.some((pattern) => pattern.test(value))) {
      hints.add("unpaid");
    }
    if (PAID_PATTERNS.some((pattern) => pattern.test(value))) {
      hints.add("paid");
    }
  }

  return hints.size > 0 ? [...hints] : ["unknown"];
}

export function detectOutcomeHints(values: PrimitiveValue[]): OutcomeFamilyHint[] {
  const strings = asStrings(values);
  const hints = new Set<OutcomeFamilyHint>();

  for (const value of strings) {
    if (QUALIFIED_PATTERNS.some((pattern) => pattern.test(value))) {
      hints.add("qualified");
    }
    if (CONVERTED_PATTERNS.some((pattern) => pattern.test(value))) {
      hints.add("converted");
    }
    if (MISSED_PATTERNS.some((pattern) => pattern.test(value))) {
      hints.add("missed");
    }
    if (ANSWERED_PATTERNS.some((pattern) => pattern.test(value))) {
      hints.add("answered");
    }
  }

  return [...hints];
}
