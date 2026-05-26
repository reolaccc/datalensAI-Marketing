import type { PrimitiveValue } from "../analytics/types.js";

export const KPI_ALIASES: Record<string, string[]> = {
  revenue: ["revenue", "sales", "income", "gmv", "conversion_value"],
  roas: ["roas", "return_on_ad_spend"],
  ctr: ["ctr", "click_through_rate", "click-through rate"],
  cvr: ["cvr", "conversion_rate", "conv_rate"],
  clicks: ["clicks", "click_count"],
  impressions: ["impressions", "views"],
  spend: ["spend", "cost", "ad_spend", "budget", "media_cost", "paid_media_cost"],
  conversions: ["conversions", "conversion_count", "orders", "purchases"],
  calls: ["calls", "total_calls", "call volume"],
  qualifiedCall: ["qualified calls", "qualified call", "qualified", "is_qualified"],
  convertedCall: ["converted calls", "converted call", "converted", "booked", "sale"],
  callDuration: ["call duration", "avg call duration", "duration", "talk time"],
  repeat_caller_rate: ["repeat caller rate", "repeat caller", "returning caller rate"],
  missedCall: ["missed calls", "missed call", "missed call rate"],
  answeredCall: ["answered calls", "answered call", "answered call rate"],
  cost_per_qualified_call: ["cost per qualified call", "cpqc", "cost_per_qualified_call"],
  cost_per_conversion: ["cost per conversion", "cpa", "cost_per_conversion"]
};

export function sanitizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, "_").replace(/[^\w]/g, "").toLowerCase();
}

export function parseNumber(value: PrimitiveValue): number | null {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value).replace(/[$,%\s,]/g, "");
  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDateValue(value: PrimitiveValue): Date | null {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 946_684_800 && value <= 4_102_444_800) {
      return new Date(value * 1000);
    }

    if (value >= 946_684_800_000 && value <= 4_102_444_800_000) {
      return new Date(value);
    }

    return null;
  }

  const input = String(value).trim();
  if (!input) {
    return null;
  }

  if (/^\d+$/.test(input)) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(input)) {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalizedYmd = input.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (normalizedYmd) {
    return buildValidatedDate(
      Number(normalizedYmd[1]),
      Number(normalizedYmd[2]),
      Number(normalizedYmd[3]),
      Number(normalizedYmd[4] ?? 0),
      Number(normalizedYmd[5] ?? 0),
      Number(normalizedYmd[6] ?? 0)
    );
  }

  const normalizedDmy = input.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (normalizedDmy) {
    return buildValidatedDate(
      Number(normalizedDmy[3]),
      Number(normalizedDmy[2]),
      Number(normalizedDmy[1]),
      Number(normalizedDmy[4] ?? 0),
      Number(normalizedDmy[5] ?? 0),
      Number(normalizedDmy[6] ?? 0)
    );
  }

  return null;
}

function buildValidatedDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return candidate;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function quantile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentile;
  const base = Math.floor(position);
  const rest = position - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) {
    return 0;
  }

  const xMean = x.reduce((sum, value) => sum + value, 0) / n;
  const yMean = y.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (let index = 0; index < n; index += 1) {
    const xDelta = x[index] - xMean;
    const yDelta = y[index] - yMean;
    numerator += xDelta * yDelta;
    xVariance += xDelta ** 2;
    yVariance += yDelta ** 2;
  }

  const denominator = Math.sqrt(xVariance * yVariance);
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}
