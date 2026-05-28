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
import { buildSemanticDatasetContract } from "../src/analytics/semanticContract.js";
import {
  CORE_SEMANTIC_CAPABILITIES,
  CURRENT_SEMANTIC_RULE_AUDIT,
  DOMAIN_PACKS,
  PATCH_LAYER_POLICY,
  evaluateOntologyBudget,
  mapExecutiveInsightDomainToPack,
  mapSemanticContractDomainToPack
} from "../src/analytics/semantic-governance/index.js";

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), "..", "..");

function readFixture(relativePath: string) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath));
}

function analyzeDomains(relativePath: string) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const buffer = fs.readFileSync(absolutePath);
  const parsed = parseDataset(buffer, path.basename(absolutePath));
  const profile = profileDataset(parsed.rows);
  const contract = profile.semanticContract ?? buildSemanticDatasetContract(profile);
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
  const executiveFacts = buildExecutiveInsightFacts(facts);

  return {
    contractDomain: contract.domain,
    contractPack: mapSemanticContractDomainToPack(contract.domain),
    executiveDomain: executiveFacts.domain,
    executivePack: mapExecutiveInsightDomainToPack(executiveFacts.domain)
  };
}

test("ontology budget keeps reusable trust primitives in core", () => {
  const decision = evaluateOntologyBudget({
    ruleId: "core-trend-safety",
    summary: "Allow reusable trend summaries only when temporal grounding is present.",
    proposedTier: "core_capability",
    reuseScope: "broad",
    contaminationRisk: "low",
    explainabilityImpact: "positive",
    introducesSilentSubstitution: false,
    dependsOnExactDatasetShape: false
  });

  assert.equal(decision.approved, true);
  assert.equal(decision.decision, "keep_in_core");
  assert.match(decision.reasons.join(" "), /reusable|core semantic layer/i);
});

test("ontology budget pushes domain-specific behavior into isolated domain packs", () => {
  const decision = evaluateOntologyBudget({
    ruleId: "crm-stage-wording",
    summary: "Use journey stage and pipeline wording when CRM evidence is strong.",
    proposedTier: "core_capability",
    reuseScope: "domain",
    contaminationRisk: "medium",
    explainabilityImpact: "positive",
    introducesSilentSubstitution: false,
    dependsOnExactDatasetShape: false
  });

  assert.equal(decision.approved, false);
  assert.equal(decision.decision, "move_to_domain_pack");
  assert.match(decision.reasons.join(" "), /isolated domain pack|domain reuse/i);
});

test("ontology budget rejects silent substitution and quarantines dataset-shaped fixes", () => {
  const substitutionDecision = evaluateOntologyBudget({
    ruleId: "swap-estimated-for-realized",
    summary: "Use realized revenue whenever estimated pipeline value is missing.",
    proposedTier: "core_capability",
    reuseScope: "broad",
    contaminationRisk: "high",
    explainabilityImpact: "negative",
    introducesSilentSubstitution: true,
    dependsOnExactDatasetShape: false
  });

  const patchDecision = evaluateOntologyBudget({
    ruleId: "customer-export-v17-alias",
    summary: "Handle a malformed export with a one-off stage alias.",
    proposedTier: "temporary_patch",
    reuseScope: "dataset",
    contaminationRisk: "medium",
    explainabilityImpact: "neutral",
    introducesSilentSubstitution: false,
    dependsOnExactDatasetShape: true
  });

  assert.equal(substitutionDecision.approved, false);
  assert.equal(substitutionDecision.decision, "reject");
  assert.match(substitutionDecision.reasons.join(" "), /silent metric substitution/i);

  assert.equal(patchDecision.approved, true);
  assert.equal(patchDecision.decision, "mark_as_patch");
  assert.match(patchDecision.reasons.join(" "), /temporary patch|exact-schema dependence|patch layer/i);
});

test("governance registries document the allowed semantic surface area", () => {
  assert.deepEqual(Object.keys(DOMAIN_PACKS).sort(), [
    "call_tracking",
    "crm_pipeline",
    "energy_solar",
    "generic",
    "ops_support",
    "retail_inventory"
  ]);
  assert.ok(CORE_SEMANTIC_CAPABILITIES.length >= 5);
  assert.ok(CORE_SEMANTIC_CAPABILITIES.some((capability) => capability.key === "ratio_safety"));
  assert.ok(CURRENT_SEMANTIC_RULE_AUDIT.some((rule) => rule.tier === "core_capability"));
  assert.ok(CURRENT_SEMANTIC_RULE_AUDIT.some((rule) => rule.tier === "domain_pack"));
  assert.ok(CURRENT_SEMANTIC_RULE_AUDIT.some((rule) => rule.tier === "temporary_patch"));
  assert.ok(PATCH_LAYER_POLICY.requiredFields.includes("planned removal condition"));
  assert.ok(PATCH_LAYER_POLICY.bannedBehaviors.includes("temporary fixes that override deterministic trust gates"));
});

test("blind QA datasets route through governed packs without collapsing back into call-tracking", () => {
  const callTracking = analyzeDomains("datasets/semantic_regression_pack_v1/call_tracking_attribution_blindqa.csv");
  const crm = analyzeDomains("datasets/semantic_regression_pack_v1/crm_pipeline_blindqa.csv");
  const retail = analyzeDomains("datasets/semantic_regression_pack_v1/retail_inventory_blindqa.csv");
  const operations = analyzeDomains("datasets/semantic_regression_pack_v1/ops_support_blindqa.csv");
  const energy = analyzeDomains("datasets/semantic_regression_pack_v1/energy_solar_blindqa.csv");
  const generic = analyzeDomains("datasets/semantic_regression_pack_v1/generic_unknown_blindqa.csv");

  assert.equal(callTracking.executivePack, "call_tracking");

  assert.equal(crm.executiveDomain, "crm");
  assert.equal(crm.executivePack, "crm_pipeline");
  assert.notEqual(crm.executivePack, "call_tracking");

  assert.equal(retail.executiveDomain, "retail");
  assert.equal(retail.executivePack, "retail_inventory");
  assert.notEqual(retail.executivePack, "call_tracking");

  assert.equal(operations.executiveDomain, "operations");
  assert.equal(operations.executivePack, "ops_support");

  assert.equal(energy.executiveDomain, "energy");
  assert.equal(energy.executivePack, "energy_solar");
  assert.notEqual(energy.executivePack, "call_tracking");

  assert.equal(generic.contractPack, "generic");
  assert.equal(generic.executiveDomain, "generic");
  assert.equal(generic.executivePack, "generic");
  assert.notEqual(generic.executivePack, "call_tracking");

  if (callTracking.contractDomain) {
    assert.equal(callTracking.contractPack, "call_tracking");
  }

  if (operations.contractDomain === "call_operations") {
    assert.equal(operations.contractPack, "ops_support");
  }
});

test("blind QA CRM output preserves pipeline-safe wording instead of call-tracking leakage", async () => {
  const buffer = readFixture("datasets/semantic_regression_pack_v1/crm_pipeline_blindqa.csv");
  const analysis = await analyzeUploadedDataset(buffer, "crm_pipeline_blindqa.csv");
  const text = [...(analysis.dataSummaryNotes ?? []), ...analysis.executiveSummary.bullets].join(" | ");

  assert.ok(analysis.executiveSummary.bullets.length >= 3);
  assert.match(text, /lead|pipeline|journey|follow-up|closed-won|estimated value|realized revenue/i);
  assert.doesNotMatch(text, /\bcampaign\b|\bacquisition\b|\bmissed calls?\b|\bROAS\b|\bbudget\b/i);
});
