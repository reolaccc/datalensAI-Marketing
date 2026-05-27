import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { analyzeUploadedDataset } from "../src/services/analysisService.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { detectKpis } from "../src/analytics/detectKpis.js";
import { selectRuleBasedCharts } from "../src/services/analytics/chart-selection/selectRuleBasedCharts.js";

const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

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

  assert.ok(notes.length > 0);
  assert.ok(notes.some((note) => /3 calls across 3 channels\./i.test(note)));
  assert.ok(notes.some((note) => /Date range: (Apr 30|May 1)–May 1, 2026\./i.test(note)));
  assert.ok(notes.some((note) => /Spend coverage: 2\/3 records\./i.test(note)));
  assert.ok(notes.some((note) => /Outcomes: 3\/3 records available\./i.test(note)));
  assert.ok(!(notes).some((note) => /aggregated|call-count fields/i.test(note)));
  assert.ok(notes.length <= 5);
  assert.ok(notes.every((note) => note.length < 100));
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

  assert.ok(notes.some((note) => /3 campaigns across 3 channels\./i.test(note)));
  assert.ok(notes.some((note) => /Spend coverage: 1\/3 campaigns\./i.test(note)));
  assert.ok(notes.some((note) => /Outcomes: 3\/3 campaigns available\./i.test(note)));
  assert.ok(notes.some((note) => /Total Calls field found; call volume uses that field\./i.test(note)));
  assert.ok(notes.every((note) => !/CleanedDatasetProfile|structureHint|semantic|reliability counter/i.test(note)));
  assert.ok(notes.length <= 5);
  assert.ok(notes.every((note) => note.length < 100));
});

test("anomaly dataset keeps data summary compact and surfaces high-value anomaly notes", async () => {
  const fileName = "anomaly_call_summary.csv";
  const buffer = fs.readFileSync(path.join(fixturesDir, fileName));
  const analysis = await analyzeUploadedDataset(buffer, fileName);
  const notes = analysis.dataSummaryNotes ?? [];

  assert.ok(notes.some((note) => /5 campaigns across 4 channels\./i.test(note)));
  assert.ok(notes.some((note) => /Spend coverage: 3\/5 campaigns\./i.test(note)));
  assert.ok(notes.some((note) => /Revenue coverage: 3\/5 campaigns\./i.test(note)));
  assert.ok(notes.some((note) => /1 campaign has spend but no qualified calls\./i.test(note)));
  assert.ok(notes.some((note) => /Total Calls field found; call volume uses that field\./i.test(note)));
  assert.ok(notes.length <= 5);
  assert.ok(notes.every((note) => !/IQR|z-score|threshold|confidence|semantic|canonical/i.test(note)));
});
