import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { answerDatasetQuestion } from "../src/analytics/answerQuestion.js";
import { buildTrustedQuestionFacts } from "../src/analytics/trustedQuestionFacts.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";

const blindQaDir = path.resolve(process.cwd(), "..", "datasets", "blind-qa");

function loadContext(fileName: string) {
  const filePath = path.resolve(blindQaDir, fileName);
  const parsed = parseDataset(fs.readFileSync(filePath), fileName);
  const profile = profileDataset(parsed.rows);

  return {
    fileName,
    rows: parsed.rows,
    profile,
    input: { useAi: false as const }
  };
}

test("TrustedQuestionFacts captures a normal ranking question with aligned chart support", async () => {
  const context = loadContext("blind_test_row_level_call_log.csv");
  const trustedQuestion = buildTrustedQuestionFacts("Which campaign has the best CPQC?", context);
  const answer = await answerDatasetQuestion("Which campaign has the best CPQC?", context);

  assert.equal(trustedQuestion.facts.answerability.status, "answerable");
  assert.equal(trustedQuestion.facts.answer.mode, "ranking");
  assert.equal(trustedQuestion.facts.evidence.primaryMetric, "cost_per_qualified_call");
  assert.equal(trustedQuestion.facts.chartSupportRequest?.kind, "bar");
  assert.equal(trustedQuestion.facts.chartSupportRequest?.metric, "cost_per_qualified_call");
  assert.equal(answer.chartSuggestion?.yKey, trustedQuestion.facts.chartSupportRequest?.metric);
  assert.ok(
    (answer.recommendedCharts ?? []).every(
      (chart) => chart.metric === "cost_per_qualified_call" || chart.yKey === "cost_per_qualified_call"
    )
  );
});

test("TrustedQuestionFacts marks unsupported metric questions without silent substitution", async () => {
  const context = loadContext("blind_test_v4_callcentre_ops.csv");
  const trustedQuestion = buildTrustedQuestionFacts("Which queue has the best ROAS?", context);
  const answer = await answerDatasetQuestion("Which queue has the best ROAS?", context);

  assert.equal(trustedQuestion.facts.answerability.status, "unsupported");
  assert.match(trustedQuestion.facts.answer.directAnswer, /ROAS cannot be calculated/i);
  assert.equal(trustedQuestion.facts.chartSupportRequest?.kind, "none");
  assert.match(answer.answer, /ROAS cannot be calculated/i);
  assert.equal(answer.recommendedCharts?.length ?? 0, 0);
});

test("TrustedQuestionFacts marks weak fallback questions explicitly", () => {
  const context = loadContext("blind_test_v4_callcentre_ops.csv");
  const trustedQuestion = buildTrustedQuestionFacts("Summarize the business performance.", context);

  assert.equal(trustedQuestion.facts.answerability.status, "weak");
  assert.match(trustedQuestion.facts.answer.directAnswer, /Performance is too broad/i);
  assert.doesNotMatch(trustedQuestion.facts.answer.directAnswer, /segment comparison|choose a winner/i);
  assert.equal(trustedQuestion.facts.chartSupportRequest?.kind, "none");
});

test("TrustedQuestionFacts keeps missed-call reliability grounded on missed call rate", async () => {
  const context = loadContext("blind_test_v4_callcentre_ops.csv");
  const trustedQuestion = buildTrustedQuestionFacts("Can missed call rate be compared reliably by service line?", context);
  const answer = await answerDatasetQuestion("Can missed call rate be compared reliably by service line?", context);

  assert.equal(trustedQuestion.facts.routing.mode, "trust");
  assert.deepEqual(trustedQuestion.facts.semanticAlignment.requestedMetrics, ["missed_call_rate"]);
  assert.equal(trustedQuestion.facts.semanticAlignment.answeredMetric, "missed_call_rate");
  assert.match(answer.answer, /missed call rate can be compared/i);
  assert.doesNotMatch(answer.answer, /^calls can be compared/i);
});

test("TrustedQuestionFacts gives dataset-level reliability wording when no metric is named", async () => {
  const context = loadContext("blind_test_v4_callcentre_ops.csv");
  const trustedQuestion = buildTrustedQuestionFacts("What reliability limitations affect decision confidence?", context);
  const answer = await answerDatasetQuestion("What reliability limitations affect decision confidence?", context);

  assert.equal(trustedQuestion.facts.routing.mode, "trust");
  assert.equal(trustedQuestion.facts.answerability.status, "weak");
  assert.match(answer.answer, /Main reliability limitations/i);
  assert.match(answer.answer, /missing values|semantic|coverage|ratio|directional/i);
  assert.doesNotMatch(answer.answer, /not a ranking|does not name one metric|choose a winner/i);
  assert.doesNotMatch(answer.answer, /changing the metric being answered/i);
});

test("Ask chart support stays aligned to TrustedQuestionFacts for chart-supported questions", async () => {
  const context = loadContext("blind_test_aggregated_marketing_summary.csv");
  const trustedQuestion = buildTrustedQuestionFacts("Which channel had the highest qualified rate?", context);
  const answer = await answerDatasetQuestion("Which channel had the highest qualified rate?", context);

  assert.equal(trustedQuestion.facts.answerability.status, "answerable");
  assert.equal(trustedQuestion.facts.chartSupportRequest?.metric, "qualified_call_rate");
  assert.equal(answer.chartSuggestion?.yKey, "qualified_call_rate");
  assert.ok(
    (answer.recommendedCharts ?? []).every(
      (chart) => chart.metric === "qualified_call_rate" || chart.yKey === "qualified_call_rate"
    )
  );
});

test("Ask skips extra chart support when TrustedQuestionFacts says it is unnecessary", async () => {
  const context = loadContext("blind_test_v4_callcentre_ops.csv");
  const trustedQuestion = buildTrustedQuestionFacts("Summarize the business performance.", context);
  const answer = await answerDatasetQuestion("Summarize the business performance.", context);

  assert.equal(trustedQuestion.facts.chartSupportRequest?.kind, "none");
  assert.equal(answer.recommendedCharts?.length ?? 0, 0);
  assert.equal("trustedQuestionFacts" in (answer as Record<string, unknown>), false);
});
