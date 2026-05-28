import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeUploadedDataset } from "../src/services/analysisService.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { detectKpis } from "../src/analytics/detectKpis.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { selectRuleBasedCharts } from "../src/services/analytics/chart-selection/selectRuleBasedCharts.js";
import { buildAnalyticsFactsFromAnalysis } from "../src/llm/insightService.js";
import { buildExecutiveInsightFacts } from "../src/llm/executiveInsightFacts.js";

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), "..", "..");

async function analyzeFixture(filePath: string) {
  const absolutePath = path.resolve(repoRoot, filePath);
  const buffer = fs.readFileSync(absolutePath);
  return analyzeUploadedDataset(buffer, path.basename(absolutePath));
}

async function analyzeInlineCsv(fileName: string, csv: string) {
  return analyzeUploadedDataset(Buffer.from(csv), fileName);
}

async function detectExecutiveDomain(buffer: Buffer, fileName: string) {
  const parsed = parseDataset(buffer, fileName);
  const profile = profileDataset(parsed.rows);
  const kpis = detectKpis(parsed.rows, profile);
  const kpiCards = buildKpiCards(parsed.rows, profile);
  const charts = selectRuleBasedCharts({
    question: "",
    rows: parsed.rows,
    profile,
    kpis
  }).charts;
  const facts = buildAnalyticsFactsFromAnalysis({
    fileName: parsed.fileName,
    profile,
    kpis,
    kpiCards,
    charts
  });

  return buildExecutiveInsightFacts(facts).domain;
}

test("post-upload summaries stay domain-aware across call-tracking, CRM, retail, energy, ops, and generic datasets", async () => {
  const callTrackingPath = "datasets/semantic_regression_pack_v1/call_tracking_attribution_blindqa.csv";
  const crmPath = "datasets/semantic_regression_pack_v1/crm_pipeline_blindqa.csv";
  const retailPath = "datasets/semantic_regression_pack_v1/retail_inventory_blindqa.csv";
  const opsPath = "datasets/semantic_regression_pack_v1/ops_support_blindqa.csv";
  const energyPath = "datasets/semantic_regression_pack_v1/energy_solar_blindqa.csv";
  const genericPath = "datasets/semantic_regression_pack_v1/generic_unknown_blindqa.csv";

  const callTrackingBuffer = fs.readFileSync(path.resolve(repoRoot, callTrackingPath));
  const crmBuffer = fs.readFileSync(path.resolve(repoRoot, crmPath));
  const retailBuffer = fs.readFileSync(path.resolve(repoRoot, retailPath));
  const opsBuffer = fs.readFileSync(path.resolve(repoRoot, opsPath));
  const energyBuffer = fs.readFileSync(path.resolve(repoRoot, energyPath));
  const genericBuffer = fs.readFileSync(path.resolve(repoRoot, genericPath));

  const [
    callTracking,
    crm,
    retail,
    ops,
    energy,
    generic,
    callTrackingDomain,
    crmDomain,
    retailDomain,
    opsDomain,
    energyDomain,
    genericDomain
  ] = await Promise.all([
    analyzeFixture(callTrackingPath),
    analyzeFixture(crmPath),
    analyzeFixture(retailPath),
    analyzeFixture(opsPath),
    analyzeFixture(energyPath),
    analyzeFixture(genericPath),
    detectExecutiveDomain(callTrackingBuffer, path.basename(callTrackingPath)),
    detectExecutiveDomain(crmBuffer, path.basename(crmPath)),
    detectExecutiveDomain(retailBuffer, path.basename(retailPath)),
    detectExecutiveDomain(opsBuffer, path.basename(opsPath)),
    detectExecutiveDomain(energyBuffer, path.basename(energyPath)),
    detectExecutiveDomain(genericBuffer, path.basename(genericPath))
  ]);

  assert.equal(callTrackingDomain, "call_tracking");
  assert.equal(crmDomain, "crm");
  assert.equal(retailDomain, "retail");
  assert.equal(opsDomain, "operations");
  assert.equal(energyDomain, "energy");
  assert.equal(genericDomain, "generic");

  assert.ok(callTracking.dataSummaryNotes && callTracking.dataSummaryNotes.length >= 3);
  assert.ok(crm.dataSummaryNotes && crm.dataSummaryNotes.length >= 3);
  assert.ok(retail.dataSummaryNotes && retail.dataSummaryNotes.length >= 3);
  assert.ok(ops.dataSummaryNotes && ops.dataSummaryNotes.length >= 3);
  assert.ok(energy.dataSummaryNotes && energy.dataSummaryNotes.length >= 3);
  assert.ok(generic.dataSummaryNotes && generic.dataSummaryNotes.length >= 3);

  assert.ok(callTracking.executiveSummary.bullets.length >= 4);
  assert.ok(callTracking.executiveSummary.bullets.some((bullet) => /fluctuat|observed period/i.test(bullet)));
  assert.ok(callTracking.executiveSummary.bullets.some((bullet) => /qualified|quality|converted/i.test(bullet)));
  assert.ok(callTracking.executiveSummary.bullets.some((bullet) => /revenue|traffic source/i.test(bullet)));

  const crmText = [...(crm.dataSummaryNotes ?? []), ...crm.executiveSummary.bullets].join(" | ");
  assert.match(crmText, /CRM\/pipeline fields detected|journey|pipeline|follow-up|estimated value|realized revenue/i);
  assert.doesNotMatch(crmText, /\bcampaigns available\b|\bacquisition\b|\bbudget\b|\bROAS\b|\bcall quality\b|\badditional investment\b|\bchannel mix\b/i);
  assert.ok(crm.executiveSummary.bullets.length >= 3);

  const retailText = [...(retail.dataSummaryNotes ?? []), ...retail.executiveSummary.bullets].join(" | ");
  assert.match(retailText, /warehouse|category|fulfillment|margin|stock/i);
  assert.doesNotMatch(retailText, /\bcampaign\b|\bROAS\b|\bacquisition\b/i);

  const energyText = [...(energy.dataSummaryNotes ?? []), ...energy.executiveSummary.bullets].join(" | ");
  assert.match(energyText, /solar|load|grid|site/i);
  assert.doesNotMatch(energyText, /\bcampaign\b|\bROAS\b|\bbudget\b|\bacquisition\b/i);

  const opsText = [...(ops.dataSummaryNotes ?? []), ...ops.executiveSummary.bullets].join(" | ");
  assert.match(opsText, /service|queue|talk time|callback|missed/i);
  assert.doesNotMatch(opsText, /\bcampaigns available\b|\bchannel mix\b/i);

  const genericText = [...(generic.dataSummaryNotes ?? []), ...generic.executiveSummary.bullets].join(" | ");
  assert.match(genericText, /segment|value|records available|domain grounding/i);
  assert.doesNotMatch(genericText, /\bROAS\b|\bcampaign\b|\bpipeline review\b|\bstage progression\b|\bfollow-up dependency\b/i);
});
