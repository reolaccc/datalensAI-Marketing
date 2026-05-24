import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeUploadedDataset } from "../src/services/analysisService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, "../../..");

async function runCase(fileName: string) {
  const datasetPath = path.join(rootDirectory, "datasets", fileName);
  const expectedPath = path.join(rootDirectory, "evaluations", `${fileName}.json`);
  const [buffer, expectedBuffer] = await Promise.all([
    readFile(datasetPath),
    readFile(expectedPath, "utf8")
  ]);

  const result = await analyzeUploadedDataset(buffer, fileName);
  const expected = JSON.parse(expectedBuffer) as {
    expectedKpis: string[];
    expectedInsightSnippets: string[];
    expectedAnomalyColumns: string[];
  };

  const actualKpis = result.kpis.map((kpi) => kpi.id);
  const actualInsights = [
    result.edaSummary,
    result.executiveSummary.overview,
    result.executiveSummary.kpiSummary,
    result.executiveSummary.anomalySummary,
    result.executiveSummary.trendSummary
  ].join(" ");
  const actualAnomalyColumns = result.profile.outliers.map((entry) => entry.column);

  const passed =
    expected.expectedKpis.every((kpi) => actualKpis.includes(kpi)) &&
    expected.expectedInsightSnippets.every((snippet) => actualInsights.toLowerCase().includes(snippet.toLowerCase())) &&
    expected.expectedAnomalyColumns.every((column) => actualAnomalyColumns.includes(column));

  return {
    fileName,
    passed,
    actualKpis,
    actualAnomalyColumns
  };
}

async function main() {
  const cases = [
    "marketing_clean.csv",
    "marketing_anomalies.csv",
    "marketing_missing_values.csv",
    "marketing_inconsistent_categories.csv",
    "marketing_outliers.csv"
  ];

  const results = await Promise.all(cases.map((fileName) => runCase(fileName)));
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.fileName}`);
    console.log(`  KPIs: ${result.actualKpis.join(", ") || "none"}`);
    console.log(`  Outliers: ${result.actualAnomalyColumns.join(", ") || "none"}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
