import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { aggregateSemanticMetric, detectCallDatasetGrain } from "../src/analytics/semanticContract.js";
import { aggregateByDimension } from "../src/services/analytics/chart-selection/chartDataUtils.js";
import type { DatasetCapabilities, DatasetRow, KpiCard } from "../src/analytics/types.js";

const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

const minimalCapabilities: DatasetCapabilities = {
  numericMetrics: [],
  categoricalDimensions: [],
  datetimeFields: [],
  kpiCandidates: [],
  segmentFields: [],
  comparisonFields: [],
  anomalyFields: [],
  derivedMetrics: [],
  defaultMetric: null,
  defaultDimension: null,
  defaultDateDimension: null,
  funnelStageFields: []
};

function cardByLabel(cards: KpiCard[], label: string) {
  const card = cards.find((entry) => entry.label === label);
  assert.ok(card);
  return card;
}

function assertAlmostEqual(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test("aggregated datasets sum qualified calls and compute qualified rate from summed totals", () => {
  const rows: DatasetRow[] = [
    { campaign: "Brand", source_medium: "Google Ads", total_calls: 40, qualified_calls: 10 },
    { campaign: "SEO", source_medium: "SEO Organic", total_calls: 30, qualified_calls: 12 },
    { campaign: "Retargeting", source_medium: "Meta Ads", total_calls: 20, qualified_calls: 4 }
  ];

  const profile = profileDataset(rows);
  const cards = buildKpiCards(rows, profile);
  const qualifiedCallsCard = cardByLabel(cards, "Qualified Calls");
  const qualifiedRateCard = cardByLabel(cards, "Qualified Rate");

  assert.equal(detectCallDatasetGrain(profile), "aggregated_call_summary");
  assert.equal(aggregateSemanticMetric(rows, "calls", profile), 90);
  assert.equal(aggregateSemanticMetric(rows, "qualifiedCall", profile), 26);
  assert.equal(qualifiedCallsCard.value, 26);
  assertAlmostEqual(qualifiedRateCard.value, (26 / 90) * 100);

  const byCampaign = aggregateByDimension(rows, "campaign", "qualifiedCall", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [
    { campaign: "Brand", qualifiedCall: 10 },
    { campaign: "SEO", qualifiedCall: 12 },
    { campaign: "Retargeting", qualifiedCall: 4 }
  ]);

  const qualifiedRateByCampaign = aggregateByDimension(rows, "campaign", "qualified_call_rate", minimalCapabilities, profile);
  assert.deepEqual(qualifiedRateByCampaign, [
    { campaign: "Brand", qualified_call_rate: 25 },
    { campaign: "SEO", qualified_call_rate: 40 },
    { campaign: "Retargeting", qualified_call_rate: 20 }
  ]);
});

test("row-level datasets count qualified outcomes per call and compute qualified rate from total calls", () => {
  const parsed = parseDataset(fs.readFileSync(path.join(fixturesDir, "row_level_call_log.csv")), "row_level_call_log.csv");
  const profile = profileDataset(parsed.rows);
  const cards = buildKpiCards(parsed.rows, profile);
  const qualifiedCallsCard = cardByLabel(cards, "Qualified Calls");
  const qualifiedRateCard = cardByLabel(cards, "Qualified Rate");

  assert.equal(detectCallDatasetGrain(profile), "row_level_call_log");
  assert.equal(aggregateSemanticMetric(parsed.rows, "calls", profile), 3);
  assert.equal(aggregateSemanticMetric(parsed.rows, "qualifiedCall", profile), 2);
  assert.equal(qualifiedCallsCard.value, 2);
  assertAlmostEqual(qualifiedRateCard.value, (2 / 3) * 100);
});

test("alternate aggregated qualified count field names still sum correctly", () => {
  const rows: DatasetRow[] = [
    { campaign: "Brand", source_medium: "Google Ads", total_calls: 12, qualified_leads: 5 },
    { campaign: "SEO", source_medium: "SEO Organic", total_calls: 8, qualified_leads: 3 }
  ];

  const profile = profileDataset(rows);

  assert.equal(detectCallDatasetGrain(profile), "aggregated_call_summary");
  assert.equal(aggregateSemanticMetric(rows, "qualifiedCall", profile), 8);
});

test("qualified outcome-family values map to qualified calls without row counting mistakes", () => {
  const rows: DatasetRow[] = [
    { result_label: "Qualified Lead", campaign: "Brand" },
    { result_label: "Booked Appointment", campaign: "Brand" },
    { result_label: "Closed Won", campaign: "SEO" },
    { result_label: "Converted", campaign: "SEO" },
    { result_label: "Sale", campaign: "Pilot" },
    { result_label: "Quote Sent", campaign: "Pilot" },
    { result_label: "Missed", campaign: "Pilot" }
  ];

  const profile = profileDataset(rows);

  assert.equal(aggregateSemanticMetric(rows, "qualifiedCall", profile), 6);

  const byCampaign = aggregateByDimension(rows, "campaign", "qualifiedCall", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [
    { campaign: "Brand", qualifiedCall: 2 },
    { campaign: "SEO", qualifiedCall: 2 },
    { campaign: "Pilot", qualifiedCall: 2 }
  ]);
});

test("unknown grain preserves safe fallback behavior for qualified calls and rate", () => {
  const rows: DatasetRow[] = [
    { campaign: "Brand", source_medium: "Google Ads", disposition: "Qualified Lead" },
    { campaign: "SEO", source_medium: "SEO Organic", disposition: "Missed" }
  ];

  const profile = profileDataset(rows);

  assert.equal(detectCallDatasetGrain(profile), "unknown");
  assert.equal(aggregateSemanticMetric(rows, "qualifiedCall", profile), 1);

  const byCampaign = aggregateByDimension(rows, "campaign", "qualified_call_rate", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [
    { campaign: "Brand", qualified_call_rate: 100 },
    { campaign: "SEO", qualified_call_rate: 0 }
  ]);
});
