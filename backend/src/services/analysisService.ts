import type { AnalysisResult } from "../analytics/types.js";
import { createAnalysisSession } from "./analysisSessionStore.js";
import { detectKpis } from "../analytics/detectKpis.js";
import { generateEdaSummary, generateExecutiveSummary } from "../ai/generateExecutiveSummary.js";
import { loadRowsIntoDuckDb } from "../providers/duckdbProvider.js";
import { parseDataset } from "../profiling/datasetParser.js";
import { profileDataset } from "../profiling/profileDataset.js";
import { selectRuleBasedCharts } from "./analytics/chart-selection/selectRuleBasedCharts.js";

export async function analyzeUploadedDataset(buffer: Buffer, fileName: string): Promise<AnalysisResult> {
  const parsed = parseDataset(buffer, fileName);
  const profile = profileDataset(parsed.rows);
  const session = createAnalysisSession({
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    rows: parsed.rows,
    profile
  });
  const kpis = detectKpis(parsed.rows, profile);
  const charts = selectRuleBasedCharts({
    question: "",
    rows: parsed.rows,
    profile,
    kpis
  }).charts;
  const edaSummary = generateEdaSummary(profile, kpis);
  const duckDbSnapshot = await loadRowsIntoDuckDb(parsed.rows);
  const executiveSummary = await generateExecutiveSummary(profile, kpis, {
    mode: "local",
    fileName: parsed.fileName,
    edaSummary
  });

  return {
    analysisId: session.analysisId,
    fileName: parsed.fileName,
    datasetSummary: {
      rowCount: duckDbSnapshot.rowCount,
      columnCount: duckDbSnapshot.columnCount,
      sheetName: parsed.sheetName
    },
    profile,
    kpis,
    charts,
    edaSummary,
    executiveSummary
  };
}
