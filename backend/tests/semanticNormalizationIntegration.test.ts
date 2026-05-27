import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import {
  buildSemanticDatasetContract,
  detectCallDatasetGrain,
  hasReliablePaidSpend,
  resolveCanonicalMetricKey,
  resolveSemanticMetricSourceColumns
} from "../src/analytics/semanticContract.js";
import type { DatasetProfile, DatasetRow } from "../src/analytics/types.js";

const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

test("canonical spend and revenue names resolve through normalization hints", () => {
  const rows: DatasetRow[] = [
    { ad_spend_: 120, sale_value_: 450, source_medium: "Google Ads" },
    { ad_spend_: 95, sale_value_: 300, source_medium: "Meta Ads" }
  ];

  const profile = profileDataset(rows);

  assert.equal(resolveCanonicalMetricKey(profile, "ad_spend"), "spend");
  assert.equal(resolveCanonicalMetricKey(profile, "sale_value"), "revenue");
  assert.deepEqual(resolveSemanticMetricSourceColumns(profile, "spend"), ["ad_spend_"]);
  assert.deepEqual(resolveSemanticMetricSourceColumns(profile, "revenue"), ["sale_value_"]);
});

test("generic bucket field can map to channel using normalization channel hints", () => {
  const rows: DatasetRow[] = [
    { bucket: "SEO Organic", total_calls: 30 },
    { bucket: "Email", total_calls: 12 },
    { bucket: "Direct", total_calls: 8 }
  ];

  const profile = profileDataset(rows);
  const channelMapping = profile.semanticContract?.roleMappings?.find((mapping) => mapping.rawColumn === "bucket");

  assert.equal(channelMapping?.semanticRole, "channel");
});

test("qualified and missed outcome mappings are derived from outcome-family hints", () => {
  const rows: DatasetRow[] = [
    { result_label: "Booked Appointment" },
    { result_label: "Qualified Lead" },
    { result_label: "No Answer" },
    { result_label: "Missed" }
  ];

  const profile = profileDataset(rows);
  const qualifiedMapping = profile.semanticContract?.roleMappings?.find(
    (mapping) => mapping.rawColumn === "result_label" && mapping.semanticRole === "qualifiedCall"
  );
  const missedMapping = profile.semanticContract?.roleMappings?.find(
    (mapping) => mapping.rawColumn === "result_label" && mapping.semanticRole === "missedCall"
  );

  assert.ok(qualifiedMapping);
  assert.ok(missedMapping);
});

test("paid and unpaid channel semantics still preserve spend reliability behavior", () => {
  const rows: DatasetRow[] = [
    { source_medium: "SEO Organic", ad_spend_: 120 },
    { source_medium: "Google Ads", ad_spend_: 120 }
  ];

  const profile = profileDataset(rows);

  assert.equal(hasReliablePaidSpend(rows[0], profile), false);
  assert.equal(hasReliablePaidSpend(rows[1], profile), true);
});

test("dataset grain consumes normalization structure hints for row-level and aggregated fixtures", () => {
  const rowLevel = parseDataset(fs.readFileSync(path.join(fixturesDir, "row_level_call_log.csv")), "row_level_call_log.csv");
  const aggregated = parseDataset(fs.readFileSync(path.join(fixturesDir, "aggregated_call_summary.csv")), "aggregated_call_summary.csv");

  assert.equal(detectCallDatasetGrain(profileDataset(rowLevel.rows)), "row_level_call_log");
  assert.equal(detectCallDatasetGrain(profileDataset(aggregated.rows)), "aggregated_call_summary");
});

test("fallback semantic behavior remains available without normalization hints", () => {
  const bareProfile: DatasetProfile = {
    rowCount: 2,
    columnCount: 2,
    duplicateRowCount: 0,
    missingCells: 0,
    numericColumns: ["spend"],
    categoricalColumns: ["campaign"],
    datetimeColumns: [],
    columns: [
      {
        name: "spend",
        kind: "numeric",
        missingCount: 0,
        uniqueCount: 2,
        sampleValues: [100, 150],
        min: 100,
        max: 150,
        mean: 125,
        median: 125
      },
      {
        name: "campaign",
        kind: "categorical",
        missingCount: 0,
        uniqueCount: 2,
        sampleValues: ["Brand", "SEO"],
        topCategories: [
          { value: "Brand", count: 1 },
          { value: "SEO", count: 1 }
        ]
      }
    ],
    outliers: [],
    correlations: []
  };

  const contract = buildSemanticDatasetContract(bareProfile);

  assert.equal(contract.metricResolutions.spend?.sourceColumns[0], "spend");
  assert.equal(resolveCanonicalMetricKey(contract, "spend"), "spend");
});
