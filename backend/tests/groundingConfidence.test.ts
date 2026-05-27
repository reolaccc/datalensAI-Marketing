import test from "node:test";
import assert from "node:assert/strict";
import { buildTrustedQuestionFacts } from "../src/analytics/trustedQuestionFacts.js";
import { profileDataset } from "../src/profiling/profileDataset.js";

function factsFor(question: string, rows: Record<string, unknown>[]) {
  const profile = profileDataset(rows);
  return buildTrustedQuestionFacts(question, {
    rows,
    profile,
    input: { useAi: false }
  }).facts;
}

test("grounding confidence prefers requested business segments over binary proxy fields", () => {
  const rows = [
    { queue_name: "Billing", callback_required: "Y", call_answered: "N", missed_reason: "busy", talk_time_sec: 310 },
    { queue_name: "Billing", callback_required: "N", call_answered: "Y", missed_reason: "", talk_time_sec: 280 },
    { queue_name: "Support", callback_required: "Y", call_answered: "Y", missed_reason: "", talk_time_sec: 520 },
    { queue_name: "Support", callback_required: "N", call_answered: "N", missed_reason: "timeout", talk_time_sec: 410 }
  ];

  const facts = factsFor("Which queues are operating most efficiently?", rows);

  assert.equal(facts.groundingConfidence.dimensionGrounding.groundedDimensions[0], "queue_name");
  assert.notEqual(facts.evidence.primaryDimension, "callback_required");
  assert.notEqual(facts.answerability.status, "answerable");
  assert.equal(facts.chartSupportRequest?.kind, "none");
});

test("grounding confidence allows binary fields when the user explicitly asks about that flag", () => {
  const rows = [
    { service_line: "Repairs", callback_required: "Y", call_answered: "N", missed_reason: "busy" },
    { service_line: "Repairs", callback_required: "N", call_answered: "Y", missed_reason: "" },
    { service_line: "Install", callback_required: "Y", call_answered: "Y", missed_reason: "" }
  ];

  const facts = factsFor("What should we investigate about callback_required concentration?", rows);

  assert.equal(facts.groundingConfidence.relationshipGrounding.relationshipType, "concentration");
  assert.equal(facts.groundingConfidence.dimensionGrounding.groundedDimensions[0], "callback_required");
  assert.deepEqual(facts.groundingConfidence.dimensionGrounding.weakDimensions, []);
});

test("relationship grounding keeps retail cost and margin questions from becoming spend rankings", () => {
  const rows = [
    { warehouse: "North", fulfillment_cost: 1200, gross_margin_pct: 0.22, markdown_rate: 0.08, sell_through_rate: 0.61 },
    { warehouse: "South", fulfillment_cost: 1800, gross_margin_pct: 0.11, markdown_rate: 0.18, sell_through_rate: 0.42 },
    { warehouse: "West", fulfillment_cost: 900, gross_margin_pct: 0.28, markdown_rate: 0.06, sell_through_rate: 0.69 }
  ];

  const facts = factsFor("Where does fulfillment cost rise without margin support?", rows);

  assert.equal(facts.groundingConfidence.relationshipGrounding.relationshipType, "without_matching");
  assert.ok(facts.groundingConfidence.metricGrounding.groundedMetrics.includes("fulfillment_cost"));
  assert.ok(facts.groundingConfidence.metricGrounding.groundedMetrics.includes("gross_margin_pct"));
  assert.ok(!facts.evidence.metricsUsed.includes("spend"));
  assert.equal(facts.chartSupportRequest?.kind, "none");
});

test("relationship grounding keeps both sides of volume and value questions", () => {
  const rows = [
    { campaign: "A", call_id: "c1", booked_revenue: 1000 },
    { campaign: "A", call_id: "c2", booked_revenue: 0 },
    { campaign: "B", call_id: "c3", booked_revenue: 2500 }
  ];

  const facts = factsFor("Where does call volume look concentrated without matching booked revenue quality?", rows);

  assert.equal(facts.groundingConfidence.relationshipGrounding.relationshipType, "without_matching");
  assert.ok(facts.groundingConfidence.metricGrounding.groundedMetrics.includes("calls"));
  assert.ok(
    facts.groundingConfidence.metricGrounding.groundedMetrics.some((metric) =>
      metric === "revenue" || metric === "booked_revenue"
    )
  );
  assert.notEqual(facts.groundingConfidence.metricGrounding.status, "unsupported");
  assert.equal(facts.chartSupportRequest?.kind, "none");
});

test("relationship grounding recognizes fulfilled order versus backorder imbalance", () => {
  const rows = [
    { warehouse: "North", fulfilled_orders: 90, backorder_count: 8 },
    { warehouse: "South", fulfilled_orders: 40, backorder_count: 27 },
    { warehouse: "West", fulfilled_orders: 110, backorder_count: 5 }
  ];

  const facts = factsFor("Where do fulfilled orders fail to keep up with backorders?", rows);

  assert.equal(facts.groundingConfidence.relationshipGrounding.relationshipType, "without_matching");
  assert.ok(facts.groundingConfidence.metricGrounding.groundedMetrics.includes("fulfilled_orders"));
  assert.ok(facts.groundingConfidence.metricGrounding.groundedMetrics.includes("backorder_count"));
  assert.equal(facts.chartSupportRequest?.kind, "none");
});
