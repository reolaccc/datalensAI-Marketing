import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canonicalizeColumnName, normalizeColumnNames, buildCleanedDatasetProfile, normalizeSampleValue, detectDatasetStructureHint } from "../src/analytics/normalization/index.js";
import { parseDataset } from "../src/profiling/datasetParser.js";

const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

test("canonical column names normalize safely", () => {
  assert.equal(canonicalizeColumnName("Ad Spend ($)"), "ad_spend");
  assert.equal(canonicalizeColumnName("Sale Value_"), "sale_value");
  assert.equal(canonicalizeColumnName("Source / Medium"), "source_medium");
  assert.equal(canonicalizeColumnName("Call Duration (sec)"), "call_duration_sec");
  assert.equal(canonicalizeColumnName("Qualified Calls"), "qualified_calls");
});

test("duplicate canonical names get safe suffixes", () => {
  const mappings = normalizeColumnNames(["Source", "source", "Source /"]);
  assert.deepEqual(mappings.map((entry) => entry.canonicalName), ["source", "source_2", "source_3"]);
});

test("currency values normalize to numbers", () => {
  const normalized = normalizeSampleValue("$1,200", "ad_spend");
  assert.equal(normalized.value, 1200);
});

test("percentage values normalize to decimal form", () => {
  const normalized = normalizeSampleValue("35%", "qualified_rate");
  assert.equal(normalized.value, 0.35);
});

test("phone numbers and ids are not over-parsed", () => {
  assert.equal(normalizeSampleValue("0412345678", "caller_number").value, "0412345678");
  assert.equal(normalizeSampleValue("100234", "call_id").value, "100234");
});

test("row-level grain detection works", () => {
  const hint = detectDatasetStructureHint(["call_id", "call_datetime", "caller_number", "call_duration_sec"]);
  assert.equal(hint.grain, "row_level_call_log");
});

test("aggregated grain detection works", () => {
  const hint = detectDatasetStructureHint(["campaign", "source_medium", "total_calls", "qualified_calls", "ad_spend"]);
  assert.equal(hint.grain, "aggregated_call_summary");
});

test("aggregated grain detection recognizes generalized summary count schemas", () => {
  const hint = detectDatasetStructureHint([
    "traffic_source",
    "campaign_label",
    "total_inbound_calls",
    "qualified_lead_count",
    "media_cost",
    "attributed_revenue"
  ]);
  assert.equal(hint.grain, "aggregated_call_summary");
});

test("row-level fixture produces paid/unpaid and outcome hints", () => {
  const buffer = fs.readFileSync(path.join(fixturesDir, "row_level_call_log.csv"));
  const parsed = parseDataset(buffer, "row_level_call_log.csv");
  const cleaned = buildCleanedDatasetProfile(parsed.rows);

  assert.equal(cleaned.structureHint.grain, "row_level_call_log");
  assert.equal(cleaned.originalToCanonical["source__medium"], "source_medium");
  assert.ok(cleaned.reliability.paidRows > 0);
  assert.ok(cleaned.reliability.unpaidRows > 0);

  const dispositionColumn = cleaned.columns.find((column) => column.canonicalName === "disposition");
  assert.ok(dispositionColumn);
  assert.ok(dispositionColumn.outcomeHints.includes("qualified"));
  assert.ok(dispositionColumn.outcomeHints.includes("missed"));
});

test("aggregated fixture produces aggregated warning and incomplete spend warning", () => {
  const buffer = fs.readFileSync(path.join(fixturesDir, "aggregated_call_summary.csv"));
  const parsed = parseDataset(buffer, "aggregated_call_summary.csv");
  const cleaned = buildCleanedDatasetProfile(parsed.rows);

  assert.equal(cleaned.structureHint.grain, "aggregated_call_summary");
  assert.ok(cleaned.warnings.some((warning) => warning.code === "dataset_appears_aggregated"));
  assert.ok(cleaned.warnings.some((warning) => warning.code === "organic_or_unpaid_channels_detected"));
  assert.ok(cleaned.warnings.some((warning) => warning.code === "spend_appears_incomplete"));
});
