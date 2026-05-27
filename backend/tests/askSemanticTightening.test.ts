import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { answerDatasetQuestion } from "../src/analytics/answerQuestion.js";
import { buildTrustedQuestionFacts } from "../src/analytics/trustedQuestionFacts.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";

function loadContext(fileName: string) {
  const filePath = path.isAbsolute(fileName)
    ? fileName
    : fileName.startsWith("tests/")
      ? path.resolve(process.cwd(), fileName)
      : path.resolve(process.cwd(), "..", fileName);
  const parsed = parseDataset(fs.readFileSync(filePath), filePath);
  const profile = profileDataset(parsed.rows);

  return {
    fileName: filePath,
    rows: parsed.rows,
    profile,
    input: { useAi: false as const }
  };
}

test("qualified efficiency questions do not silently substitute to ROAS", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const question = "If we care about qualified efficiency rather than top-line revenue, where should we look first?";
  const trustedQuestion = buildTrustedQuestionFacts(question, context);
  const answer = await answerDatasetQuestion(question, context);

  assert.equal(trustedQuestion.facts.semanticAlignment.status, "partial");
  assert.equal(trustedQuestion.facts.answerability.status, "weak");
  assert.match(answer.answer, /relationship across multiple metrics/i);
  assert.doesNotMatch(answer.answer, /highest ROAS/i);
  assert.equal(answer.chartSuggestion, undefined);
  assert.equal(answer.recommendedCharts?.length ?? 0, 0);
});

test("trust questions route to caveat answers instead of rankings", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const question = "Summarize the main reliability caveat before we compare campaign efficiency.";
  const trustedQuestion = buildTrustedQuestionFacts(question, context);
  const answer = await answerDatasetQuestion(question, context);

  assert.equal(trustedQuestion.facts.routing.mode, "trust");
  assert.match(answer.answer, /can be compared/i);
  assert.match(answer.answer, /derived|grounded/i);
  assert.doesNotMatch(answer.answer, /highest ROAS|strongest|winner/i);
  assert.equal(answer.chartSuggestion, undefined);
  assert.equal(answer.recommendedCharts?.length ?? 0, 0);
});

test("unsupported ROAS questions still refuse cleanly in operations datasets", async () => {
  const context = loadContext("datasets/blind-qa/blind_test_v4_callcentre_ops.csv");
  const question = "Do we have enough data to answer anything about ROAS by queue?";
  const trustedQuestion = buildTrustedQuestionFacts(question, context);
  const answer = await answerDatasetQuestion(question, context);

  assert.equal(trustedQuestion.facts.answerability.status, "unsupported");
  assert.match(answer.answer, /ROAS cannot be calculated/i);
  assert.equal(answer.chartSuggestion, undefined);
  assert.equal(answer.recommendedCharts?.length ?? 0, 0);
});

test("inventory imbalance questions do not collapse into spend fallbacks", async () => {
  const context = loadContext("tests/fixtures/retail_inventory_blind.csv");
  const question = "Where is markdown rate increasing while sell through rate stays weak?";
  const trustedQuestion = buildTrustedQuestionFacts(question, context);
  const answer = await answerDatasetQuestion(question, context);

  assert.equal(trustedQuestion.facts.semanticAlignment.status, "partial");
  assert.equal(trustedQuestion.facts.answerability.status, "weak");
  assert.match(answer.answer, /relationship across multiple metrics/i);
  assert.doesNotMatch(answer.answer, /spend/i);
  assert.equal(answer.chartSuggestion, undefined);
  assert.equal(answer.recommendedCharts?.length ?? 0, 0);
});

test("trust explanations for generic business metrics stay grounded on the requested metric", async () => {
  const context = loadContext("tests/fixtures/retail_inventory_blind.csv");
  const question = "Can gross margin pct be compared cleanly across warehouses?";
  const trustedQuestion = buildTrustedQuestionFacts(question, context);
  const answer = await answerDatasetQuestion(question, context);

  assert.equal(trustedQuestion.facts.routing.mode, "trust");
  assert.equal(trustedQuestion.facts.semanticAlignment.answeredMetric, "gross_margin_pct");
  assert.match(answer.answer, /gross margin percent/i);
  assert.doesNotMatch(answer.answer, /spend-anchored|highest ROAS/i);
  assert.equal(answer.chartSuggestion, undefined);
  assert.equal(answer.recommendedCharts?.length ?? 0, 0);
});

test("trusted wording routes to trust explanation mode", () => {
  const context = loadContext("datasets/blind-qa/blind_test_v4_weird_crm_export.csv");
  const trustedQuestion = buildTrustedQuestionFacts("Can ROAS be trusted for this dataset?", context);

  assert.equal(trustedQuestion.facts.routing.mode, "trust");
  assert.notEqual(trustedQuestion.facts.answer.mode, "ranking");
});
