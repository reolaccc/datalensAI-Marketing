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

function contextFromRows(rows: Record<string, string | number | boolean | null>[]) {
  const profile = profileDataset(rows);
  return {
    fileName: "inline-fixture.csv",
    rows,
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
  assert.match(answer.answer, /requested relationship is only partially supported/i);
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
  assert.match(answer.answer, /requested relationship is only partially supported/i);
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

test("broad investigation questions do not expose inferred commercial metrics", async () => {
  const context = loadContext("datasets/blind-qa/blind_test_v4_weird_crm_export.csv");
  const question = "Where does efficiency look uneven?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /too broad|multiple possible signals|name the metric/i);
  assert.doesNotMatch(
    answer.answer,
    /\bROAS\b|\broas\b|\brevenue\b|\bspend\b|commercial performance|business score|semantic score|strongest score|strongest signal|anchored signal/i
  );
});

test("explicit commercial trust questions can still name the requested metric", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const question = "Can ROAS be compared reliably by channel?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /ROAS/i);
  assert.match(answer.answer, /revenue divided by spend|revenue and spend/i);
  assert.doesNotMatch(answer.answer, /semantic score|anchored signal|business score/i);
});

test("qualified call rate inconsistency answers stay on the requested metric", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const question = "Where does qualified call rate look inconsistent across channel?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /qualified call rate/i);
  assert.doesNotMatch(
    answer.answer,
    /\bROAS\b|\broas\b|\brevenue\b|\bspend\b|commercial performance|business score|semantic score|strongest score|strongest signal|anchored signal|combines/i
  );
});

test("missed-call pressure uses grouped missed-rate ratios instead of filtering to missed rows", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const question = "Where might missed call pressure affect opportunity capture across channel?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /missed-call pressure|missed call rate/i);
  assert.match(answer.answer, /24%/i);
  assert.doesNotMatch(answer.answer, /0%|100%|ahead of .* by 0%/i);
  assert.equal(answer.chartSuggestion?.yKey, "missed_call_rate");
  assert.ok((answer.chartSuggestion?.data ?? []).every((row) => Number(row.missed_call_rate) >= 0 && Number(row.missed_call_rate) <= 1));
});

test("qualified call rate variation uses grouped numerator over denominator ratios", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const question = "Where does qualified call rate vary most across channel?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /qualified call rate varies/i);
  assert.match(answer.answer, /49%/i);
  assert.doesNotMatch(answer.answer, /100%|semantic score|anchored signal/i);
  assert.equal(answer.chartSuggestion?.yKey, "qualified_call_rate");
  assert.ok((answer.chartSuggestion?.data ?? []).every((row) => Number(row.qualified_call_rate) >= 0 && Number(row.qualified_call_rate) <= 1));
});

test("call duration answers use public labels and trend routing", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");

  const segmentAnswer = await answerDatasetQuestion("Where does call duration look inconsistent across channel?", context);
  assert.match(segmentAnswer.answer, /call duration/i);
  assert.match(segmentAnswer.answer, /seconds/i);
  assert.doesNotMatch(segmentAnswer.answer, /callduration/i);

  const trendAnswer = await answerDatasetQuestion("How does call duration change over time?", context);
  assert.match(trendAnswer.answer, /Average call duration shows/i);
  assert.match(trendAnswer.answer, /seconds/i);
  assert.doesNotMatch(trendAnswer.answer, /segment comparison|call_uid|callDuration|ask about .* by/i);

  const frontendContext = {
    ...context,
    input: {
      ...context.input,
      selectedMetric: "callDuration",
      selectedDimension: "call_uid"
    }
  };
  const frontendTrendAnswer = await answerDatasetQuestion("How does call duration change over time?", frontendContext);
  assert.match(frontendTrendAnswer.answer, /Average call duration shows/i);
  assert.match(frontendTrendAnswer.answer, /seconds/i);
  assert.doesNotMatch(frontendTrendAnswer.answer, /segment comparison|call_uid|callDuration|ask about .* by/i);
  assert.deepEqual(frontendTrendAnswer.detectedIntent?.targetDimensions ?? [], []);

  const callsTrendAnswer = await answerDatasetQuestion("How do calls change over time?", frontendContext);
  assert.match(callsTrendAnswer.answer, /trend/i);
  assert.doesNotMatch(callsTrendAnswer.answer, /segment comparison|call_uid|ask about .* by/i);

  const qualifiedRateTrendAnswer = await answerDatasetQuestion("How does qualified call rate change over time?", frontendContext);
  assert.match(qualifiedRateTrendAnswer.answer, /qualified call rate.*trend/i);
  assert.doesNotMatch(
    qualifiedRateTrendAnswer.answer,
    /segment comparison|call_uid|callDuration|sales_stage=Qualified|ask about .* by/i
  );
});

test("malformed fragment questions get concise clarification instead of ranking fallback", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const answer = await answerDatasetQuestion("would name the metric and the segment you want to compare.", context);

  assert.match(answer.answer, /incomplete question/i);
  assert.match(answer.answer, /specific metric and segment/i);
  assert.doesNotMatch(answer.answer, /choose a winner|reliable segment comparison|inferred signals alone|too broad for a reliable ranking/i);
  assert.equal(answer.chartSuggestion, undefined);
});

test("year performance questions without matching records answer the time coverage limit", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const answer = await answerDatasetQuestion("2026 performace", context);

  assert.match(answer.answer, /does not appear to contain records for 2026/i);
  assert.doesNotMatch(answer.answer, /segment comparison|choose a winner|metric and the segment/i);
  assert.equal(answer.chartSuggestion, undefined);
});

test("year performance questions with matching records ask for a metric, not a segment fallback", async () => {
  const context = contextFromRows([
    { date: "2026-01-01", channel: "Paid Search", calls: 12, revenue: 500 },
    { date: "2026-01-02", channel: "Email", calls: 8, revenue: 320 },
    { date: "2025-12-31", channel: "Paid Search", calls: 6, revenue: 120 }
  ]);
  const answer = await answerDatasetQuestion("How about 2026?", context);

  assert.match(answer.answer, /contains 2026 records/i);
  assert.match(answer.answer, /choose a metric/i);
  assert.doesNotMatch(answer.answer, /segment comparison|choose a winner|metric and the segment/i);
});

test("broad performance questions get short domain-aware metric guidance", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const answer = await answerDatasetQuestion("How did we perform?", context);

  assert.match(answer.answer, /strongest next investigations|grounded risk signals|biggest problem/i);
  assert.match(answer.answer, /missed-call|qualified-call|call volume|ROAS|revenue/i);
  assert.doesNotMatch(answer.answer, /segment comparison|choose a winner|inferred signals alone|semantic|grounding/i);
});

test("broad call-tracking investigation questions provide grounded directions", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const questions = [
    "Where is the biggest problem?",
    "Where should we optimize?",
    "What areas deserve further investigation?",
    "What should I look at first?"
  ];

  for (const question of questions) {
    const answer = await answerDatasetQuestion(question, context);
    assert.match(answer.answer, /missed-call|qualified-call|call volume|ROAS|revenue|CPQC|call duration/i);
    assert.doesNotMatch(answer.answer, /reliable segment comparison|metric and the segment|choose a winner|semantic score|grounding confidence/i);
    assert.doesNotMatch(answer.answer, /\b(best|highest|lowest|winner)\b/i);
  }
});

test("broad investigation guidance stays domain appropriate outside call tracking", async () => {
  const opsContext = loadContext("datasets/blind-qa/blind_test_v4_callcentre_ops.csv");
  const retailContext = loadContext("tests/fixtures/retail_inventory_blind.csv");
  const energyContext = contextFromRows([
    { date: "2026-01-01", site: "North", channel: "north meter", solar_kwh: 1200, load_kwh: 980, grid_import_kwh: 140, grid_export_kwh: 360 },
    { date: "2026-01-02", site: "South", channel: "south meter", solar_kwh: 820, load_kwh: 1120, grid_import_kwh: 420, grid_export_kwh: 90 },
    { date: "2026-02-01", site: "West", channel: "west meter", solar_kwh: 1040, load_kwh: 1005, grid_import_kwh: 210, grid_export_kwh: 245 }
  ]);

  const opsAnswer = await answerDatasetQuestion("Where should we optimize?", opsContext);
  assert.match(opsAnswer.answer, /response|resolution|workload|queue|service|escalation|missed|failed/i);
  assert.doesNotMatch(opsAnswer.answer, /\bROAS\b|campaign|qualified-call|attribution/i);

  const retailAnswer = await answerDatasetQuestion("Where is the biggest problem?", retailContext);
  assert.match(retailAnswer.answer, /stock|backorder|inventory|fulfillment|return|margin|warehouse|supplier|category|product/i);
  assert.doesNotMatch(retailAnswer.answer, /\bROAS\b|campaign|qualified-call|attribution/i);

  const energyAnswer = await answerDatasetQuestion("What areas deserve further investigation?", energyContext);
  assert.match(energyAnswer.answer, /solar|load|grid|usage|time-period|coverage/i);
  assert.doesNotMatch(energyAnswer.answer, /\bROAS\b|campaign|qualified-call|missed-call|attribution/i);
});

test("dataset-level reliability questions answer with concrete limitations", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const question = "What reliability limitations affect decision confidence?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /Main reliability limitations/i);
  assert.match(answer.answer, /missing values|semantic|ratio|coverage|directional/i);
  assert.match(answer.answer, /safer|cautiously/i);
  assert.doesNotMatch(answer.answer, /not a ranking|does not name one metric|metric-specific trust question|choose a winner/i);
});

test("generic caveat questions explain caveats without meta refusal", async () => {
  const context = loadContext("tests/fixtures/retail_inventory_blind.csv");
  const question = "What caveats should we consider before trusting this analysis?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /Main reliability limitations|coverage|semantic|directional/i);
  assert.doesNotMatch(answer.answer, /not a ranking|does not name one metric|choose a winner/i);
  assert.doesNotMatch(answer.answer, /\bROAS\b|\bcampaign\b|attribution|marketing/i);
});

test("ROAS trust questions explain revenue and spend coverage limits", async () => {
  const context = loadContext("datasets/blind-qa/blind_test_v4_weird_crm_export.csv");
  const question = "Can ROAS be trusted for this dataset?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /ROAS/i);
  assert.match(answer.answer, /revenue and spend fields|partial coverage|directional/i);
  assert.doesNotMatch(answer.answer, /highest|winner|semantic score|anchored signal/i);
});

test("non-marketing reliability questions avoid marketing attribution language", async () => {
  const context = loadContext("tests/fixtures/retail_inventory_blind.csv");
  const question = "What reliability limitations affect decision confidence?";
  const answer = await answerDatasetQuestion(question, context);

  assert.match(answer.answer, /Main reliability limitations|coverage|semantic|directional/i);
  assert.doesNotMatch(answer.answer, /\bROAS\b|\bcampaign\b|attribution|marketing/i);
});
