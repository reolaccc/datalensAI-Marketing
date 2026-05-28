import type { AnalysisResponse } from "../types";

function normalizeBullet(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isBusinessInsight(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  return (
    !/(^next\s*:|next question:|data quality|missing cell|missing cells|duplicate row|duplicate rows|outlier|outliers|eda|profiling|dirty data|warning)/i.test(trimmed) &&
    !/\b(dataset|data set|file|profiled)\b.*\b(rows?|columns?|fields?)\b/i.test(trimmed) &&
    !/\b\d+\s+rows?\b/i.test(trimmed) &&
    !/\b\d+\s+columns?\b/i.test(trimmed) &&
    !/\b(row count|column count|number of fields|date range)\b/i.test(trimmed) &&
    !normalized.includes("validate whether the strongest signals hold across") &&
    !/\binvestigate the (changing|improving|declining) .+ trend across .+ before making a broader recommendation\b/i.test(trimmed) &&
    !/\bthe (changing|improving|declining) .+ trend across .+ should be watched before committing budget\b/i.test(trimmed)
  );
}

export function buildExecutiveInsightBullets(executiveSummary: AnalysisResponse["executiveSummary"], limit = 6) {
  const collected: string[] = [];
  const seen = new Set<string>();
  const push = (value?: string | null) => {
    if (!value) {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!isBusinessInsight(trimmed)) {
      return;
    }

    const key = normalizeBullet(trimmed);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    collected.push(trimmed);
  };

  executiveSummary.bullets?.forEach((bullet) => push(bullet));

  const fallback = [
    executiveSummary.overview,
    executiveSummary.kpiSummary,
    executiveSummary.anomalySummary,
    executiveSummary.trendSummary
  ];
  fallback.forEach((item) => push(item));

  return collected.slice(0, limit);
}
