import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { aggregateSemanticMetric, detectCallDatasetGrain } from "../src/analytics/semanticContract.js";
import { aggregateByDate, aggregateByDimension } from "../src/services/analytics/chart-selection/chartDataUtils.js";
import type { DatasetCapabilities, DatasetRow } from "../src/analytics/types.js";

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

function findTotalCallsCard(rows: DatasetRow[]) {
  const profile = profileDataset(rows);
  const card = buildKpiCards(rows, profile).find((entry) => entry.label === "Total Calls");
  assert.ok(card);
  return { profile, card };
}

test("row-level datasets keep total calls tied to row-level call counting", () => {
  const parsed = parseDataset(fs.readFileSync(path.join(fixturesDir, "row_level_call_log.csv")), "row_level_call_log.csv");
  const { profile, card } = findTotalCallsCard(parsed.rows);

  assert.equal(detectCallDatasetGrain(profile), "row_level_call_log");
  assert.equal(aggregateSemanticMetric(parsed.rows, "calls", profile), 3);
  assert.equal(card.value, 3);
  assert.equal(card.formula, "count(call_id)");

  const trend = aggregateByDate(parsed.rows, "call_datetime", "calls", minimalCapabilities, profile);
  assert.equal(
    trend.reduce((sum, entry) => sum + Number(entry.calls ?? 0), 0),
    3
  );
});

test("aggregated datasets use summed call-count fields instead of row count", () => {
  const parsed = parseDataset(fs.readFileSync(path.join(fixturesDir, "aggregated_call_summary.csv")), "aggregated_call_summary.csv");
  const { profile, card } = findTotalCallsCard(parsed.rows);

  assert.equal(detectCallDatasetGrain(profile), "aggregated_call_summary");
  assert.equal(aggregateSemanticMetric(parsed.rows, "calls", profile), 90);
  assert.equal(card.value, 90);
  assert.equal(card.formula, "sum(total_calls)");

  const byCampaign = aggregateByDimension(parsed.rows, "campaign", "calls", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [
    { campaign: "Brand", calls: 40 },
    { campaign: "SEO", calls: 30 },
    { campaign: "Retargeting", calls: 20 }
  ]);
});

test("alternate call-count field names still drive total calls when the dataset is aggregated", () => {
  const scenarios: Array<{ field: string; expected: number }> = [
    { field: "calls", expected: 11 },
    { field: "call_volume", expected: 17 },
    { field: "inbound_calls", expected: 23 }
  ];

  for (const scenario of scenarios) {
    const rows: DatasetRow[] = [
      { campaign: "Brand", source_medium: "Google Ads", [scenario.field]: scenario.expected - 7 },
      { campaign: "SEO", source_medium: "SEO Organic", [scenario.field]: 7 }
    ];
    const profile = profileDataset(rows);
    assert.equal(detectCallDatasetGrain(profile), "aggregated_call_summary");
    assert.equal(aggregateSemanticMetric(rows, "calls", profile), scenario.expected);
  }
});

test("unclear structure keeps the existing safe total-calls fallback", () => {
  const rows: DatasetRow[] = [
    { campaign: "Brand", source_medium: "Google Ads", disposition: "Qualified Lead", ad_spend_: 120 },
    { campaign: "SEO", source_medium: "SEO Organic", disposition: "Missed", ad_spend_: null }
  ];
  const profile = profileDataset(rows);

  assert.equal(detectCallDatasetGrain(profile), "unknown");
  assert.equal(aggregateSemanticMetric(rows, "calls", profile), null);

  const byCampaign = aggregateByDimension(rows, "campaign", "calls", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [
    { campaign: "Brand", calls: 1 },
    { campaign: "SEO", calls: 1 }
  ]);
});
