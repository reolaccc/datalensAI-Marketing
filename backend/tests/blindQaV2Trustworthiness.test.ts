import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { answerDatasetQuestion } from "../src/analytics/answerQuestion.js";
import { planQuery } from "../src/analytics/queryPlanner.js";
import { aggregateSemanticMetric } from "../src/analytics/semanticContract.js";
import type { DatasetCapabilities } from "../src/analytics/types.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { aggregateByDimension } from "../src/services/analytics/chart-selection/chartDataUtils.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";

const blindQaDir = path.resolve(process.cwd(), "..", "datasets", "blind-qa");

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

test("aggregated blind v2 dataset prefers explicit qualified-count fields over outcome row inference", () => {
  const context = loadContext("blind_test_v2_enterprise_attribution.csv");

  assert.equal(context.profile.normalizedProfile?.structureHint.grain, "aggregated_call_summary");
  assert.equal(aggregateSemanticMetric(context.rows, "calls", context.profile), 570);
  assert.equal(aggregateSemanticMetric(context.rows, "qualifiedCall", context.profile), 142);
  assert.equal(
    Number((buildKpiCards(context.rows, context.profile).find((card) => card.id === "qualified_call_rate")?.value ?? 0).toFixed(2)),
    24.91
  );
});

test("grouped ROAS stays consistent between semantic aggregation, Ask answers, and chart data for the aggregated blind v2 dataset", async () => {
  const context = loadContext("blind_test_v2_enterprise_attribution.csv");
  const grouped = aggregateByDimension(context.rows, "campaign_label", "roas", minimalCapabilities, context.profile);
  const answer = await answerDatasetQuestion("Which campaign has the best ROAS?", context);
  const leader = answer.resultTable?.rows[0] as Record<string, unknown> | undefined;
  const roasChart = answer.recommendedCharts?.find((chart) => chart.metric === "roas");

  assert.ok(leader);
  const leaderCampaign = String(leader?.campaign_label ?? "");
  const leaderRoas = Number(leader?.roas);
  const groupedEntry = grouped.find((row) => String(row.campaign_label) === leaderCampaign);
  const chartEntry = roasChart?.data?.find((row) => String(row.campaign_label) === leaderCampaign);

  assert.ok(groupedEntry);
  assert.ok(chartEntry);
  assert.equal(leaderRoas, groupedEntry?.roas);
  assert.equal(leaderRoas, chartEntry?.roas);
});

test("grouped ROAS stays consistent between semantic aggregation, Ask answers, and chart data for the row-level blind v2 dataset", async () => {
  const context = loadContext("blind_test_v2_rowlevel_crm.csv");
  const grouped = aggregateByDimension(context.rows, "campaign_name", "roas", minimalCapabilities, context.profile);
  const answer = await answerDatasetQuestion("Which campaign has the best ROAS?", context);
  const leader = answer.resultTable?.rows[0] as Record<string, unknown> | undefined;
  const roasChart = answer.recommendedCharts?.find((chart) => chart.metric === "roas");

  assert.ok(leader);
  const leaderCampaign = String(leader?.campaign_name ?? "");
  const leaderRoas = Number(leader?.roas);
  const groupedEntry = grouped.find((row) => String(row.campaign_name) === leaderCampaign);
  const chartEntry = roasChart?.data?.find((row) => String(row.campaign_name) === leaderCampaign);

  assert.ok(groupedEntry);
  assert.ok(chartEntry);
  assert.equal(leaderRoas, groupedEntry?.roas);
  assert.equal(leaderRoas, chartEntry?.roas);
});

test("Ask planning prefers qualified-call efficiency metrics over ROAS for qualified efficiency questions", () => {
  const enterpriseContext = loadContext("blind_test_v2_enterprise_attribution.csv");
  const rowLevelContext = loadContext("blind_test_v2_rowlevel_crm.csv");

  const enterprisePlan = planQuery("Which campaigns are driving qualified calls efficiently?", enterpriseContext.profile);
  const rowLevelPlan = planQuery("Which campaigns are driving qualified calls efficiently?", rowLevelContext.profile);

  assert.equal(enterprisePlan.metrics[0], "cost_per_qualified_call");
  assert.equal(rowLevelPlan.metrics[0], "cost_per_qualified_call");
  assert.ok((enterprisePlan.metrics[1] ?? "") === "qualified_call_rate" || enterprisePlan.metrics.includes("qualified_call_rate"));
  assert.ok((rowLevelPlan.metrics[1] ?? "") === "qualified_call_rate" || rowLevelPlan.metrics.includes("qualified_call_rate"));
});

test("Ask answers use qualified-call efficiency metrics instead of drifting to ROAS for qualified efficiency questions", async () => {
  const enterpriseContext = loadContext("blind_test_v2_enterprise_attribution.csv");
  const rowLevelContext = loadContext("blind_test_v2_rowlevel_crm.csv");

  const enterpriseAnswer = await answerDatasetQuestion("Which campaigns are driving qualified calls efficiently?", enterpriseContext);
  const rowLevelAnswer = await answerDatasetQuestion("Which campaigns are driving qualified calls efficiently?", rowLevelContext);

  assert.match(enterpriseAnswer.answer, /cost per qualified call|qualified call rate/i);
  assert.match(rowLevelAnswer.answer, /cost per qualified call|qualified call rate/i);

  const enterpriseTopRow = enterpriseAnswer.resultTable?.rows[0] as Record<string, unknown> | undefined;
  const rowLevelTopRow = rowLevelAnswer.resultTable?.rows[0] as Record<string, unknown> | undefined;

  assert.ok(enterpriseTopRow && Number.isFinite(Number(enterpriseTopRow.cost_per_qualified_call)));
  assert.ok(rowLevelTopRow && Number.isFinite(Number(rowLevelTopRow.cost_per_qualified_call)));
});
