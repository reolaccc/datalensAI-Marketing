import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { detectKpis } from "../src/analytics/detectKpis.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { selectRuleBasedCharts } from "../src/services/analytics/chart-selection/selectRuleBasedCharts.js";
import type { DatasetRow } from "../src/analytics/types.js";

function chartSummaryForFile(fileName: string) {
  const filePath = fileName.startsWith("tests/")
    ? path.resolve(process.cwd(), fileName)
    : path.resolve(process.cwd(), "..", fileName);
  const parsed = parseDataset(fs.readFileSync(filePath), filePath);
  return chartSummaryForRows(parsed.rows);
}

function chartSummaryForRows(rows: DatasetRow[]) {
  const profile = profileDataset(rows);
  const kpis = detectKpis(rows, profile);
  return selectRuleBasedCharts({
    question: "",
    rows,
    profile,
    kpis
  }).charts.map((chart) => ({
    title: chart.title,
    chartType: chart.chartType,
    metric: chart.metric,
    dimension: chart.dimension,
    businessArea: chart.businessArea
  }));
}

test("upload overview uses safe operations fallback when support data has grounded operational fields", () => {
  const charts = chartSummaryForFile("datasets/blind-qa/blind_test_v4_callcentre_ops.csv");
  const text = charts.map((chart) => `${chart.title} ${chart.metric ?? ""} ${chart.dimension ?? ""}`).join(" ");

  assert.ok(charts.length > 0);
  assert.ok(charts.some((chart) => chart.metric === "row_count" && chart.dimension === "service_line"));
  assert.ok(charts.some((chart) => chart.metric === "missedCall" || chart.metric === "talkTime"));
  assert.ok(!/\b(roas|cpqc|campaign|qualified)\b/i.test(text));
});

test("operations fallback does not change attribution dashboard coverage", () => {
  const charts = chartSummaryForFile("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const text = charts.map((chart) => `${chart.title} ${chart.metric ?? ""}`).join(" ");

  assert.ok(charts.length >= 3);
  assert.ok(charts.every((chart) => chart.metric !== "row_count"));
  assert.ok(/\bqualified|cost per qualified|calls\b/i.test(text));
});

test("operations fallback does not trigger for retail or neutral energy-style datasets", () => {
  const retailCharts = chartSummaryForFile("tests/fixtures/retail_inventory_blind.csv");
  const energyCharts = chartSummaryForRows([
    { site: "North", solar_kwh: 1200, load_kwh: 980, grid_import_kwh: 140, grid_export_kwh: 360 },
    { site: "South", solar_kwh: 820, load_kwh: 1120, grid_import_kwh: 420, grid_export_kwh: 90 },
    { site: "West", solar_kwh: 1040, load_kwh: 1005, grid_import_kwh: 210, grid_export_kwh: 245 }
  ]);

  assert.ok(retailCharts.every((chart) => chart.metric !== "row_count"));
  assert.ok(energyCharts.every((chart) => chart.metric !== "row_count"));
});
