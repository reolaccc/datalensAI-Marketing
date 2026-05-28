import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { answerDatasetQuestion } from "../src/analytics/answerQuestion.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";

function loadQuestionContext(fileName: string) {
  const filePath = path.resolve(process.cwd(), "..", "datasets", "blind-qa", fileName);
  const parsed = parseDataset(fs.readFileSync(filePath), filePath);
  return {
    fileName: filePath,
    rows: parsed.rows,
    profile: profileDataset(parsed.rows),
    input: { useAi: false as const }
  };
}

test("Ask channel fallback resolves aggregated call-volume questions through the best semantic source dimension", async () => {
  const context = loadQuestionContext("blind_test_aggregated_marketing_summary.csv");

  const answer = await answerDatasetQuestion("Which channel drove the most calls?", context);

  assert.match(answer.answer, /Google CPC/i);
  assert.equal(answer.chartSuggestion?.yKey, "calls");
  assert.equal(answer.chartSuggestion?.xKey, "traffic_source__medium");
  assert.ok(answer.chartSuggestion?.data.every((row) => Number.isFinite(Number(row.calls))));
});

test("Ask can rank channel qualified rate without falling back to a broad performance proxy", async () => {
  const context = loadQuestionContext("blind_test_aggregated_marketing_summary.csv");

  const answer = await answerDatasetQuestion("Which channel had the highest qualified rate?", context);

  assert.match(answer.answer, /qualified call rate/i);
  assert.equal(answer.chartSuggestion?.yKey, "qualified_call_rate");
  assert.ok(answer.chartSuggestion?.data.every((row) => Number.isFinite(Number(row.qualified_call_rate))));
});

test("Ask derives qualified rate from qualified leads over lead count instead of formatting counts as percentages", async () => {
  const rows = [
    { source_channel: "Email", lead_count: 300, qualified_leads: 120, revenue: 4800 },
    { source_channel: "Paid Social", lead_count: 200, qualified_leads: 114, revenue: 2600 },
    { source_channel: "Referral", lead_count: 100, qualified_leads: 41, revenue: 1700 }
  ];
  const context = {
    fileName: "semantic_chart_test_100rows_30features.csv",
    rows,
    profile: profileDataset(rows),
    input: { useAi: false as const }
  };

  const answer = await answerDatasetQuestion("Where does qualified call rate vary most across channel?", context);

  assert.match(answer.answer, /qualified call rate varies/i);
  assert.match(answer.answer, /57%|57\.0%|57\.00%/i);
  assert.match(answer.answer, /40%|40\.0%|40\.00%/i);
  assert.doesNotMatch(answer.answer, /33,?350%|12,?000%|11,?400%/i);
  assert.equal(answer.chartSuggestion?.yKey, "qualified_call_rate");
  assert.ok(answer.chartSuggestion?.data.every((row) => Number(row.qualified_call_rate) >= 0 && Number(row.qualified_call_rate) <= 1));
});

test("Ask does not present impossible qualified-rate ratios as valid percentages", async () => {
  const rows = [
    { source_channel: "Email", lead_count: 100, qualified_leads: 120 },
    { source_channel: "Referral", lead_count: 80, qualified_leads: 90 }
  ];
  const context = {
    fileName: "invalid-qualified-rate.csv",
    rows,
    profile: profileDataset(rows),
    input: { useAi: false as const }
  };

  const answer = await answerDatasetQuestion("Where does qualified call rate vary most across channel?", context);

  assert.doesNotMatch(answer.answer, /120%|112\.5%|12,?000%|9,?000%/i);
  assert.ok((answer.chartSuggestion?.data ?? []).every((row) => Number(row.qualified_call_rate) <= 1));
});

test("Ask CPQC answers keep invalid groups out of ranking payloads and respect lower-is-better polarity", async () => {
  const context = loadQuestionContext("blind_test_row_level_call_log.csv");

  const answer = await answerDatasetQuestion("Which campaign has the best CPQC?", context);

  assert.match(answer.answer, /Bathroom Reno Leads/i);
  assert.doesNotMatch(answer.answer, /\$0\b/);
  assert.ok(answer.chartSuggestion?.data.every((row) => Number.isFinite(Number(row.cost_per_qualified_call)) && Number(row.cost_per_qualified_call) > 0));
  assert.match(answer.recommendedCharts?.[0]?.subtitle ?? "", /Bathroom Reno Leads has the lowest/i);
  assert.match(answer.recommendedCharts?.[0]?.description ?? "", /Bathroom Reno Leads/i);
  assert.match(answer.recommendedCharts?.[0]?.description ?? "", /Emergency Plumbing sits highest/i);
});

test("Ask ROAS answers keep invalid groups out of ranking payloads", async () => {
  const context = loadQuestionContext("blind_test_row_level_call_log.csv");

  const answer = await answerDatasetQuestion("Which campaign has the best ROAS?", context);

  assert.doesNotMatch(answer.answer, /No segment-level result/i);
  assert.match(answer.answer, /Mystery Vendor B/i);
  assert.ok(answer.chartSuggestion?.data.every((row) => Number.isFinite(Number(row.roas)) && Number(row.roas) > 0));
});
