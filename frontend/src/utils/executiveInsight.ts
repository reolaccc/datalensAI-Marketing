import type { AnalysisResponse } from "../types";

function normalizeBullet(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isBusinessInsight(value: string) {
  return !/(^next\s*:|next question:|data quality|missing cell|missing cells|duplicate row|duplicate rows|outlier|outliers|eda|profiling|dirty data|warning)/i.test(
    value.trim()
  );
}

function rewriteSuggestionAsInsight(question: string) {
  const trimmed = question.trim().replace(/[?.!]+$/, "");
  const normalized = trimmed.toLowerCase();

  if (!trimmed) {
    return "";
  }

  if (normalized.includes("performing best on both revenue and efficiency")) {
    return "Compare the strongest revenue segment with the most efficient segment.";
  }

  if (normalized.includes("deserves more budget and which one needs corrective action")) {
    return "Scale the strongest segment and tighten spend on the weakest one.";
  }

  if (normalized.startsWith("which segment")) {
    return "Compare segment performance across revenue and efficiency.";
  }

  if (normalized.startsWith("which campaign")) {
    return "Review campaign performance across revenue and efficiency.";
  }

  if (normalized.startsWith("what")) {
    return `Assess ${trimmed.slice(4).trim().replace(/^is\s+/i, "").replace(/^the\s+/i, "the ")}`.trim();
  }

  if (normalized.startsWith("how")) {
    return `Evaluate ${trimmed.slice(3).trim().replace(/^is\s+/i, "").replace(/^the\s+/i, "the ")}`.trim();
  }

  if (normalized.startsWith("are") || normalized.startsWith("is") || normalized.startsWith("do") || normalized.startsWith("does") || normalized.startsWith("should")) {
    return `Check whether ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`.replace(/[?.!]+$/, "");
  }

  return `Explore: ${trimmed}`;
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

  executiveSummary.suggestedQuestions.forEach((question) => {
    push(rewriteSuggestionAsInsight(question));
  });

  return collected.slice(0, limit);
}
