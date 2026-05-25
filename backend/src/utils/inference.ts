import type { PrimitiveValue } from "../analytics/types.js";

export const KPI_ALIASES: Record<string, string[]> = {
  revenue: ["revenue", "sales", "income", "gmv", "conversion_value"],
  roas: ["roas", "return_on_ad_spend"],
  ctr: ["ctr", "click_through_rate", "click-through rate"],
  cvr: ["cvr", "conversion_rate", "conv_rate"],
  clicks: ["clicks", "click_count"],
  impressions: ["impressions", "views"],
  spend: ["spend", "cost", "ad_spend", "budget", "media_cost", "paid_media_cost"],
  conversions: ["conversions", "conversion_count", "orders", "purchases"]
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

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
