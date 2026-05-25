import type { AnalysisResponse } from "../types";

export function buildEdaSummaryBullets(summary: string, limit = 4) {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return [normalized];
  }

  return sentences.slice(0, limit);
}

export function buildCompactEdaHighlights(analysis: AnalysisResponse) {
  const topSignals = analysis.kpis.slice(0, 3).map((kpi) => kpi.label);
  return [
    `${analysis.datasetSummary.rowCount} rows · ${analysis.datasetSummary.columnCount} columns`,
    analysis.profile.missingCells > 0
      ? `${analysis.profile.missingCells} missing cell${analysis.profile.missingCells === 1 ? "" : "s"}`
      : "No missing cells",
    analysis.profile.duplicateRowCount > 0
      ? `${analysis.profile.duplicateRowCount} duplicate row${analysis.profile.duplicateRowCount === 1 ? "" : "s"}`
      : "No duplicate rows",
    topSignals.length > 0 ? `Top signals: ${topSignals.join(", ")}` : "No strong KPI candidates"
  ];
}
