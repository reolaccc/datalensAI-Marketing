import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeUploadedDataset } from "../src/services/analysisService.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { detectKpis } from "../src/analytics/detectKpis.js";
import { selectRuleBasedCharts } from "../src/services/analytics/chart-selection/selectRuleBasedCharts.js";

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), "..", "..");
const fixturesDir = path.resolve(repoRoot, "backend/tests/fixtures");

test("row-level dataset surfaces concise notes without aggregated warning and keeps KPI/chart outputs aligned", async () => {
  const fileName = "row_level_call_log.csv";
  const buffer = fs.readFileSync(path.join(fixturesDir, fileName));
  const parsed = parseDataset(buffer, fileName);
  const profile = profileDataset(parsed.rows);
  const expectedKpis = buildKpiCards(parsed.rows, profile);
  const expectedCharts = selectRuleBasedCharts({
    question: "",
    rows: parsed.rows,
    profile,
    kpis: detectKpis(parsed.rows, profile)
  }).charts;

  const analysis = await analyzeUploadedDataset(buffer, fileName);
  const notes = analysis.dataSummaryNotes ?? [];

  assert.ok(notes.length >= 3);
  assert.ok(notes.some((note) => /3 rows loaded/i.test(note)));
  assert.ok(notes.some((note) => /Date range: (Apr 30|May 1)–May 1, 2026\./i.test(note)));
  assert.ok(notes.some((note) => /Column coverage:/i.test(note)));
  assert.ok(notes.some((note) => /event-level|aggregated|denominator/i.test(note)));
  assert.ok(notes.some((note) => /Spend coverage: 2\/3 records; efficiency comparisons should depend on spend and revenue coverage\./i.test(note)));
  assert.ok(!(notes).some((note) => /campaigns available|call-count fields/i.test(note)));
  assert.ok(notes.length <= 5);
  assert.ok(notes.every((note) => note.length < 140));
  assert.deepEqual(
    analysis.kpiCards.map((card) => ({ id: card.id, value: card.value, formula: card.formula })),
    expectedKpis.map((card) => ({ id: card.id, value: card.value, formula: card.formula }))
  );
  assert.deepEqual(
    analysis.charts.map((chart) => ({ id: chart.id, title: chart.title, chartType: chart.chartType, metric: chart.metric, dimension: chart.dimension })),
    expectedCharts.map((chart) => ({ id: chart.id, title: chart.title, chartType: chart.chartType, metric: chart.metric, dimension: chart.dimension }))
  );
});

test("aggregated dataset surfaces plain-language summary notes", async () => {
  const fileName = "aggregated_call_summary.csv";
  const buffer = fs.readFileSync(path.join(fixturesDir, fileName));
  const analysis = await analyzeUploadedDataset(buffer, fileName);
  const notes = analysis.dataSummaryNotes ?? [];

  assert.ok(notes.length >= 3);
  assert.ok(notes.some((note) => /3 rows loaded/i.test(note)));
  assert.ok(notes.some((note) => /Column coverage:/i.test(note)));
  assert.ok(notes.some((note) => /aggregated|denominator/i.test(note)));
  assert.ok(notes.some((note) => /Spend-based analysis is partially reliable|efficiency comparisons should depend on spend and revenue coverage/i.test(note)));
  assert.ok(notes.every((note) => !/CleanedDatasetProfile|structureHint|semantic|reliability counter/i.test(note)));
  assert.ok(notes.length <= 5);
  assert.ok(notes.every((note) => note.length < 140));
});

test("anomaly dataset keeps data summary compact and surfaces high-value anomaly notes", async () => {
  const fileName = "anomaly_call_summary.csv";
  const buffer = fs.readFileSync(path.join(fixturesDir, fileName));
  const analysis = await analyzeUploadedDataset(buffer, fileName);
  const notes = analysis.dataSummaryNotes ?? [];

  assert.ok(notes.length >= 3);
  assert.ok(notes.some((note) => /rows loaded/i.test(note)));
  assert.ok(notes.some((note) => /Spend-based analysis is partially reliable/i.test(note)));
  assert.ok(notes.some((note) => /Spend-based analysis is partially reliable|efficiency comparisons should depend on spend and revenue coverage/i.test(note)));
  assert.ok(notes.some((note) => /Column coverage:|aggregated|denominator/i.test(note)));
  assert.ok(notes.length <= 5);
  assert.ok(notes.every((note) => !/IQR|z-score|threshold|confidence|semantic|canonical/i.test(note)));
});
