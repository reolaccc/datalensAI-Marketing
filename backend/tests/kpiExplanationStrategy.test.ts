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
  assert.equal(cards.find((card) => card.id === "qualified_calls")?.description, "Tracked calls marked as sales-qualified.");
  assert.equal(cards.find((card) => card.id === "cost_per_qualified_call")?.description, "Average spend required to generate one qualified call.");
});

test("call-attribution CPQC explains paid spend scope when unpaid calls are excluded", () => {
  const rows = [
    { phone_call_id: "c1", marketing_channel: "Paid Search", media_cost_aud: 120, is_sales_qualified: 1 },
    { phone_call_id: "c2", marketing_channel: "Paid Search", media_cost_aud: 80, is_sales_qualified: 1 },
    { phone_call_id: "c3", marketing_channel: "Organic Search", media_cost_aud: 0, is_sales_qualified: 1 },
    { phone_call_id: "c4", marketing_channel: "Referral", media_cost_aud: 0, is_sales_qualified: 1 }
  ];
  const cards = buildKpiCards(rows, profileDataset(rows));
  const cpqc = cards.find((card) => card.id === "cost_per_qualified_call");

  assert.equal(cpqc?.value, 100);
  assert.equal(
    cpqc?.formula,
    "sum(media_cost_aud on paid, spend-covered calls) / sum(is_sales_qualified on paid, spend-covered calls)"
  );
  assert.equal(cpqc?.description, "Average media spend per qualified call where paid spend is available.");
});

test("call-attribution KPI descriptions use lead wording when lead count is the denominator", () => {
  const rows = [
    { source_channel: "Email", lead_count: 300, qualified_leads: 120, closed_won_count: 20, sales_value: 4800 },
    { source_channel: "Paid Social", lead_count: 200, qualified_leads: 114, closed_won_count: 30, sales_value: 2600 },
    { source_channel: "Referral", lead_count: 100, qualified_leads: 41, closed_won_count: 5, sales_value: 1700 }
  ];
  const profile = profileDataset(rows);
  const cards = buildKpiCards(rows, profile);

  const totalLeads = cards.find((card) => card.id === "total_calls");
  const qualifiedLeads = cards.find((card) => card.id === "qualified_calls");
  const qualifiedRate = cards.find((card) => card.id === "qualified_call_rate");
  const conversionRate = cards.find((card) => card.id === "conversion_rate");

  assert.equal(totalLeads?.label, "Total Leads");
  assert.equal(totalLeads?.description, "Total leads captured in the dataset.");
  assert.equal(qualifiedLeads?.label, "Qualified Leads");
  assert.equal(qualifiedRate?.description, "Share of leads that met the qualified threshold.");

  const conversionRows = [
    { source_channel: "Email", lead_count: 300, closed_won_count: 20, sales_value: 4800 },
    { source_channel: "Paid Social", lead_count: 200, closed_won_count: 30, sales_value: 2600 },
    { source_channel: "Referral", lead_count: 100, closed_won_count: 5, sales_value: 1700 }
  ];
  const conversionCards = buildKpiCards(conversionRows, profileDataset(conversionRows));
  const leadConversionRate = conversionCards.find((card) => card.id === "conversion_rate");

  assert.equal(leadConversionRate?.value, (55 / 600) * 100);
  assert.equal(leadConversionRate?.description, "Share of leads that became closed-won conversions.");
  assert.equal(leadConversionRate?.contextLine, "Top Source Channel: Paid Social");
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
