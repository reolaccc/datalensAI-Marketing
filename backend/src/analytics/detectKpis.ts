import type { DatasetProfile, DatasetRow, KpiCandidate } from "./types.js";
import { buildKpiCandidates } from "./kpiCards.js";

export function detectKpis(rows: DatasetRow[], profile: DatasetProfile): KpiCandidate[] {
  return buildKpiCandidates(rows, profile);
}
