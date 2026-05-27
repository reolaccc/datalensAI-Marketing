import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildNativeSuggestedQuestions,
  filterValidatedSuggestedQuestionTexts
} from "../src/analytics/suggestedQuestionsNative.js";
import { answerDatasetQuestion } from "../src/analytics/answerQuestion.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import type { DatasetRow } from "../src/analytics/types.js";

function loadContext(fileName: string) {
  const filePath = fileName.startsWith("tests/")
    ? path.resolve(process.cwd(), fileName)
    : path.resolve(process.cwd(), "..", fileName);
  const parsed = parseDataset(fs.readFileSync(filePath), filePath);
  const profile = profileDataset(parsed.rows);

  return {
    rows: parsed.rows,
    profile,
    input: { useAi: false as const }
  };
}

function keptQuestions(fileName: string) {
  const result = buildNativeSuggestedQuestions(loadContext(fileName), 5);
  return {
    ...result,
    text: result.questions.join(" \n")
  };
}

function keptQuestionsForRows(rows: DatasetRow[]) {
  const result = buildNativeSuggestedQuestions({ rows, profile: profileDataset(rows), input: { useAi: false } }, 5);
  return {
    ...result,
    text: result.questions.join(" \n")
  };
}

test("native suggested questions are grounded for call-tracking datasets without visual lookups", () => {
  const result = keptQuestions("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");

  assert.ok(result.questions.length >= 3);
  assert.ok(result.questions.some((question) => /qualified call rate|missed call rate|ROAS/i.test(question)));
  assert.ok(result.questions.some((question) => /reliably|reliability/i.test(question)));
  assert.ok(!/\bWhich\b.+\b(highest|most|best|lowest)\b/i.test(result.text));
  assert.ok(result.decisions.filter((decision) => decision.kept).every((decision) => decision.facts?.answerability.status !== "unsupported"));
});

test("native suggested questions prefer operations language for support datasets", () => {
  const result = keptQuestions("datasets/blind-qa/blind_test_v4_callcentre_ops.csv");

  assert.ok(result.questions.length >= 3);
  assert.ok(result.questions.some((question) => /missed call rate|talk time|service|queue|team/i.test(question)));
  assert.ok(!/\b(roas|campaign|qualified|marketing attribution)\b/i.test(result.text));
  assert.ok(result.decisions.filter((decision) => decision.kept).every((decision) => decision.facts?.answerability.status !== "unsupported"));
});

test("native suggested questions keep retail and inventory prompts away from spend fallbacks", () => {
  const result = keptQuestions("tests/fixtures/retail_inventory_blind.csv");

  assert.ok(result.questions.length >= 3);
  assert.ok(result.questions.some((question) => /margin|stockout|backorder|fulfillment|warehouse/i.test(question)));
  assert.ok(!/\b(roas|campaign|qualified|marketing attribution)\b/i.test(result.text));
  assert.ok(result.decisions.filter((decision) => decision.kept).every((decision) => decision.facts?.answerability.status !== "unsupported"));
});

test("native suggested questions stay conservative for generic weak-CRM datasets", () => {
  const result = keptQuestions("datasets/blind-qa/blind_test_v4_weird_crm_export.csv");

  assert.ok(result.questions.length >= 1);
  assert.ok(result.questions.some((question) => /reliability|reliably|inconsistent/i.test(question)));
  assert.ok(!/\b(campaign efficiency|marketing attribution|qualified calls?|qualified efficiency|cost per qualified)\b/i.test(result.text));
  assert.ok(result.decisions.filter((decision) => decision.kept).every((decision) => decision.facts?.answerability.status !== "unsupported"));
});

test("native suggested questions use neutral language for energy-style datasets", () => {
  const result = keptQuestionsForRows([
    { site: "North", solar_kwh: 1200, load_kwh: 980, grid_import_kwh: 140, grid_export_kwh: 360 },
    { site: "South", solar_kwh: 820, load_kwh: 1120, grid_import_kwh: 420, grid_export_kwh: 90 },
    { site: "West", solar_kwh: 1040, load_kwh: 1005, grid_import_kwh: 210, grid_export_kwh: 245 }
  ]);

  assert.ok(result.questions.length >= 1);
  assert.ok(result.questions.some((question) => /solar|load|grid|reliability|inconsistent|imbalanced/i.test(question)));
  assert.ok(!/\b(roas|campaign|qualified|marketing attribution)\b/i.test(result.text));
  assert.ok(result.decisions.filter((decision) => decision.kept).every((decision) => decision.facts?.answerability.status !== "unsupported"));
});

test("Ask follow-up validation removes unsafe marketing questions from operations data", () => {
  const context = loadContext("datasets/blind-qa/blind_test_v4_callcentre_ops.csv");
  const result = filterValidatedSuggestedQuestionTexts(
    [
      "Which campaigns have the highest ROAS?",
      "Which channel has the biggest revenue?",
      "Can missed call rate be compared reliably by service line?"
    ],
    context,
    4
  );

  assert.deepEqual(result.questions, ["Can missed call rate be compared reliably by service line?"]);
  assert.ok(result.decisions.some((decision) => !decision.kept && /marketing|chart-reading|unsupported|spend/i.test(decision.reason)));
});

test("Ask follow-up validation removes weak non-caveat retail substitutions", () => {
  const context = loadContext("tests/fixtures/retail_inventory_blind.csv");
  const result = filterValidatedSuggestedQuestionTexts(
    [
      "Which campaigns should receive more budget?",
      "Where did spend increase or drop the most?",
      "Can stockout pressure be compared reliably by warehouse?"
    ],
    context,
    4
  );

  assert.deepEqual(result.questions, ["Can stockout pressure be compared reliably by warehouse?"]);
  assert.ok(result.decisions.filter((decision) => decision.kept).every((decision) => decision.facts?.routing.mode === "trust"));
});

test("Ask answers return only validated follow-up suggestions", async () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const answer = await answerDatasetQuestion("Where does qualified call rate look inconsistent across channel?", {
    fileName: "call-tracking.csv",
    ...context
  });

  assert.ok((answer.suggestedFollowUps ?? []).every((question) => !/\bWhich\b.+\b(highest|most|best|lowest|biggest)\b/i.test(question)));
  assert.ok((answer.suggestedFollowUps ?? []).every((question) => !/\bunsupported|debug|grounding\b/i.test(question)));
});
