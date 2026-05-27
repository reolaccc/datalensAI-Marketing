import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSafeSuggestedQuestions } from "../src/analytics/suggestedQuestions.js";
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
    rows: parsed.rows,
    profile,
    input: { useAi: false as const }
  };
}

test("suggested questions reject visual lookups and keep grounded reliability prompts", () => {
  const context = loadContext("datasets/datalens_chart_blindtest_call_tracking_320rows.csv");
  const result = buildSafeSuggestedQuestions(
    [
      "Which channel drives the most calls?",
      "Which campaigns have the highest ROAS?",
      "Can ROAS be compared reliably by campaign?",
      "Can missed call rate be compared reliably by channel?"
    ],
    context,
    5
  );

  assert.ok(result.questions.includes("Can ROAS be compared reliably by campaign?"));
  assert.ok(result.questions.includes("Can missed call rate be compared reliably by channel?"));
  assert.ok(!result.questions.includes("Which channel drives the most calls?"));
  assert.ok(!result.questions.includes("Which campaigns have the highest ROAS?"));
});

test("suggested questions avoid marketing language for operations data", () => {
  const context = loadContext("datasets/blind-qa/blind_test_v4_callcentre_ops.csv");
  const result = buildSafeSuggestedQuestions(
    [
      "Which campaigns have the highest ROAS?",
      "Which segment is driving the strongest performance?",
      "Which source has the lowest cost per qualified call?"
    ],
    context,
    5
  );

  assert.ok(result.questions.every((question) => !/roas|campaign|qualified/i.test(question)));
  assert.ok(result.questions.some((question) => /missed call rate|answered call rate|talk time/i.test(question)));
});

test("suggested questions avoid spend fallback on inventory-style data", () => {
  const context = loadContext("tests/fixtures/retail_inventory_blind.csv");
  const result = buildSafeSuggestedQuestions(
    [
      "Which warehouse generated the most revenue?",
      "Where did spend increase or drop the most?",
      "Which segments show the clearest trade-off between scale and efficiency?"
    ],
    context,
    5
  );

  assert.ok(result.questions.every((question) => !/spend|revenue|scale and efficiency/i.test(question)));
  assert.ok(result.questions.some((question) => /backordered|stockout/i.test(question)));
});
