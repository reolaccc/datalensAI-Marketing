import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { selectRuleBasedCharts } from "../src/services/analytics/chart-selection/selectRuleBasedCharts.js";
import { detectKpis } from "../src/analytics/detectKpis.js";

const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");
const forbiddenNeutralPhrases = /most related business metric|growth or noise|strongest signal|business impact|performance driver|optimization opportunity/i;

function descriptionRepeatsDisplayedValue(card: { description?: string; formattedValue: string }) {
  return Boolean(card.description && card.description.includes(card.formattedValue));
}

test("call-tracking KPI explanations keep existing domain-aware copy and values", () => {
  const parsed = parseDataset(fs.readFileSync(path.join(fixturesDir, "row_level_call_log.csv")), "row_level_call_log.csv");
  const profile = profileDataset(parsed.rows);
  const cards = buildKpiCards(parsed.rows, profile);

  assert.equal(cards.find((card) => card.id === "total_calls")?.value, 3);
  assert.equal(cards.find((card) => card.id === "total_calls")?.description, "Total tracked calls across marketing channels.");
  assert.equal(cards.find((card) => card.id === "qualified_calls")?.description, "Calls identified as qualified sales opportunities.");
  assert.equal(cards.find((card) => card.id === "cost_per_qualified_call")?.description, "Average spend required to generate a qualified call.");
});

test("unknown-domain KPI explanations use neutral descriptive copy", () => {
  const rows = [
    { date: "2026-01-01", solar: 12000, load: 9800, grid_export: 2400, grid_import: 300 },
    { date: "2026-01-02", solar: 34400, load: 27700, grid_export: 17600, grid_import: 7640 }
  ];
  const profile = profileDataset(rows);
  const cards = buildKpiCards(rows, profile);

  assert.equal(cards.find((card) => card.label === "Solar")?.value, 46400);
  assert.equal(cards.find((card) => card.label === "Solar")?.description, "Generation or production captured in the dataset.");
  assert.equal(cards.find((card) => card.label === "Load")?.description, "Demand or consumption captured in the dataset.");
  assert.equal(cards.find((card) => card.label === "Grid Export")?.description, "Energy or volume sent back to an external destination.");
  assert.equal(cards.find((card) => card.label === "Grid Import")?.description, "Energy or volume drawn from an external source.");
  assert.ok(cards.every((card) => !forbiddenNeutralPhrases.test(card.description)));
  assert.ok(cards.every((card) => !descriptionRepeatsDisplayedValue(card)));
});

test("non-marketing KPI explanation copy stays neutral without changing chart selection", () => {
  const rows = [
    { warehouse: "North", gross_margin_pct: 0.28, inventory_units: 120, return_rate: 0.06 },
    { warehouse: "South", gross_margin_pct: 0.18, inventory_units: 220, return_rate: 0.11 },
    { warehouse: "West", gross_margin_pct: 0.31, inventory_units: 95, return_rate: 0.04 }
  ];
  const profile = profileDataset(rows);
  const chartsBefore = selectRuleBasedCharts({
    question: "",
    rows,
    profile,
    kpis: detectKpis(rows, profile)
  }).charts.map((chart) => ({ id: chart.id, title: chart.title, chartType: chart.chartType, metric: chart.metric, dimension: chart.dimension }));

  const cards = buildKpiCards(rows, profile);
  const chartsAfter = selectRuleBasedCharts({
    question: "",
    rows,
    profile,
    kpis: detectKpis(rows, profile)
  }).charts.map((chart) => ({ id: chart.id, title: chart.title, chartType: chart.chartType, metric: chart.metric, dimension: chart.dimension }));

  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => !/marketing|attribution|campaign|ROAS/i.test(card.description)));
  assert.ok(cards.every((card) => !forbiddenNeutralPhrases.test(card.description)));
  assert.ok(cards.every((card) => !descriptionRepeatsDisplayedValue(card)));
  assert.deepEqual(chartsAfter, chartsBefore);
});

test("unknown generic metrics leave KPI descriptions blank when no reliable meaning is inferred", () => {
  const rows = [
    { segment: "A", alpha_score: 12, beta_index: 4 },
    { segment: "B", alpha_score: 19, beta_index: 7 }
  ];
  const profile = profileDataset(rows);
  const cards = buildKpiCards(rows, profile);

  assert.ok(cards.length > 0);
  assert.ok(cards.some((card) => card.description === ""));
  assert.ok(cards.every((card) => !descriptionRepeatsDisplayedValue(card)));
  assert.ok(cards.every((card) => !forbiddenNeutralPhrases.test(card.description)));
});
