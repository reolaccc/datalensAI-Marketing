import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectKpis } from "../src/analytics/detectKpis.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { selectRuleBasedCharts } from "../src/services/analytics/chart-selection/selectRuleBasedCharts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, "../../..");

async function loadRows(fileName: string) {
  const datasetPath = path.join(rootDirectory, "datasets", fileName);
  const buffer = await readFile(datasetPath);
  const parsed = parseDataset(buffer, fileName);
  const profile = profileDataset(parsed.rows);
  const kpis = detectKpis(parsed.rows, profile);
  return { rows: parsed.rows, profile, kpis };
}

function expectCase(
  label: string,
  result: ReturnType<typeof selectRuleBasedCharts>,
  verify: (result: ReturnType<typeof selectRuleBasedCharts>) => boolean
) {
  const passed = verify(result);
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  console.log(`  intent: ${result.intent.primaryIntent}`);
  console.log(`  charts: ${result.charts.map((chart) => chart.title).join(" | ")}`);
  if (!passed) {
    process.exitCode = 1;
  }
}

async function main() {
  const clean = await loadRows("marketing_clean.csv");
  const anomalies = await loadRows("marketing_anomalies.csv");

  const trendCase = selectRuleBasedCharts({
    question: "Why did ROI decline?",
    ...clean
  });
  expectCase("Trend question", trendCase, (result) => {
    const titles = result.charts.map((chart) => chart.title.toLowerCase());
    return (
      result.charts.length === 4 &&
      result.intent.primaryIntent === "trend_analysis" &&
      titles.some((title) => title.includes("roi trend")) &&
      titles.some((title) => title.includes("channel"))
    );
  });

  const rankingCase = selectRuleBasedCharts({
    question: "Which campaign performs worst?",
    ...clean
  });
  expectCase("Ranking question", rankingCase, (result) => {
    return (
      result.charts.length === 4 &&
      result.intent.primaryIntent === "ranking" &&
      result.charts.some((chart) => chart.chartType === "horizontal_bar") &&
      result.charts.some((chart) => chart.chartType === "scatter")
    );
  });

  const segmentationCase = selectRuleBasedCharts({
    question: "Compare mobile vs desktop conversions.",
    ...clean
  });
  expectCase("Segmentation question", segmentationCase, (result) => {
    return (
      result.charts.length === 4 &&
      ["comparison", "segmentation"].includes(result.intent.primaryIntent) &&
      result.charts.some((chart) => chart.chartType === "bar") &&
      result.charts.some((chart) => chart.chartType === "stacked_bar")
    );
  });

  const anomalyCase = selectRuleBasedCharts({
    question: "Are there any anomalies in ad spend?",
    ...anomalies
  });
  expectCase("Anomaly question", anomalyCase, (result) => {
    return (
      result.charts.length === 4 &&
      result.intent.primaryIntent === "anomaly_detection" &&
      result.charts.some((chart) => chart.chartType === "anomaly_trend") &&
      result.charts.some((chart) => chart.chartType === "histogram")
    );
  });

  const missingDateRows = clean.rows.map(({ date: _date, ...row }) => row);
  const missingDateProfile = profileDataset(missingDateRows);
  const missingDateKpis = detectKpis(missingDateRows, missingDateProfile);
  const missingDateCase = selectRuleBasedCharts({
    question: "Show performance trend over time.",
    rows: missingDateRows,
    profile: missingDateProfile,
    kpis: missingDateKpis
  });
  expectCase("Missing date field", missingDateCase, (result) => {
    return (
      result.charts.length === 4 &&
      !result.charts.some((chart) => chart.chartType === "line" || chart.chartType === "anomaly_trend") &&
      (result.warnings[0] ?? "").toLowerCase().includes("no date field")
    );
  });

  const missingRoiRows = clean.rows.map(({ roas: _roas, ...row }) => row);
  const missingRoiProfile = profileDataset(missingRoiRows);
  const missingRoiKpis = detectKpis(missingRoiRows, missingRoiProfile);
  const missingRoiCase = selectRuleBasedCharts({
    question: "Why did ROI decline?",
    rows: missingRoiRows,
    profile: missingRoiProfile,
    kpis: missingRoiKpis
  });
  expectCase("Missing ROI field", missingRoiCase, (result) => {
    return (
      result.charts.length === 4 &&
      result.charts.some((chart) => chart.metric === "roi") &&
      result.warnings.some((warning) => warning.toLowerCase().includes("roi was not present"))
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
