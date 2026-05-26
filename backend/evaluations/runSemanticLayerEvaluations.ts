import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerDatasetQuestion } from "../src/analytics/answerQuestion.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { buildSuggestedQuestionsFromFacts } from "../src/analytics/suggestedQuestions.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { buildAnalyticsFactsFromAnalysis } from "../src/llm/insightService.js";
import type { DatasetRow } from "../src/analytics/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../..");

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail: string) {
  console.log(`FAIL ${label} - ${detail}`);
}

function assertCondition(label: string, condition: boolean, detail: string) {
  if (condition) {
    pass(label);
  } else {
    fail(label, detail);
  }
}

function semanticRoles(profile: ReturnType<typeof profileDataset>) {
  return new Set(
    profile.semanticContract?.roleMappings
      ?.filter((mapping) => mapping.semanticRole && mapping.confidence >= 0.5)
      .map((mapping) => mapping.semanticRole as string) ?? []
  );
}

function buildFacts(fileName: string, rows: DatasetRow[], profile: ReturnType<typeof profileDataset>) {
  return buildAnalyticsFactsFromAnalysis({
    fileName,
    profile,
    kpis: [],
    charts: []
  });
}

function runInternalCase(
  name: string,
  rows: DatasetRow[],
  expectedRoles: string[],
  expectedDomain: string,
  forbiddenRoles: string[] = []
) {
  const profile = profileDataset(rows);
  const roles = semanticRoles(profile);

  assertCondition(
    `${name} domain`,
    profile.semanticContract?.detectedDomain?.domain === expectedDomain,
    `expected ${expectedDomain}, got ${profile.semanticContract?.detectedDomain?.domain ?? "none"}`
  );

  for (const role of expectedRoles) {
    assertCondition(
      `${name} role ${role}`,
      roles.has(role),
      `expected semantic role ${role} to be detected`
    );
  }

  for (const role of forbiddenRoles) {
    assertCondition(
      `${name} excludes ${role}`,
      !roles.has(role),
      `did not expect semantic role ${role}`
    );
  }
}

async function runRealDatasetCase() {
  const preferredPath = path.join(workspaceRoot, "datasets", "realistic_call_tracking_dataset.csv");
  const fallbackPath = path.join(workspaceRoot, "datasets", "semantic_step3_test_100rows_30features_v2.csv");
  const datasetPath = existsSync(preferredPath) ? preferredPath : fallbackPath;
  const fileName = path.basename(datasetPath);
  const buffer = readFileSync(datasetPath);
  const parsed = parseDataset(buffer, fileName);
  const profile = profileDataset(parsed.rows);
  const kpiCards = buildKpiCards(parsed.rows, profile);
  const facts = buildFacts(fileName, parsed.rows, profile);
  const suggestedQuestions = buildSuggestedQuestionsFromFacts(facts, 5);
  const roasAnswer = await answerDatasetQuestion("Which channel has the best ROAS?", {
    fileName,
    rows: parsed.rows,
    profile,
    input: { useAi: false }
  });

  assertCondition(
    "Real dataset domain",
    ["call_tracking", "marketing_attribution", "mixed_call_tracking_attribution"].includes(
      profile.semanticContract?.detectedDomain?.domain ?? "unknown"
    ),
    `unexpected domain ${profile.semanticContract?.detectedDomain?.domain ?? "unknown"}`
  );
  assertCondition("Real dataset produces multiple KPI cards", kpiCards.length > 1, "expected more than one KPI card");
  assertCondition(
    "Real dataset revenue KPI gating",
    !semanticRoles(profile).has("revenue") || kpiCards.some((card) => card.label === "Total Revenue"),
    "expected Total Revenue when revenue exists"
  );
  assertCondition(
    "Real dataset spend KPI gating",
    !semanticRoles(profile).has("spend") || kpiCards.some((card) => card.label === "Total Spend"),
    "expected Total Spend when spend exists"
  );
  assertCondition(
    "Real dataset ROAS gating",
    semanticRoles(profile).has("revenue") && semanticRoles(profile).has("spend")
      ? kpiCards.some((card) => card.label === "ROAS")
      : !kpiCards.some((card) => card.label === "ROAS"),
    "ROAS should only appear when both revenue and spend exist"
  );
  assertCondition(
    "Real dataset qualified KPI gating",
    semanticRoles(profile).has("qualifiedCall")
      ? kpiCards.some((card) => card.label === "Qualified Calls")
      : !kpiCards.some((card) => card.label === "Qualified Calls"),
    "Qualified Calls card did not respect field availability"
  );
  assertCondition(
    "Real dataset conversion KPI gating",
    semanticRoles(profile).has("convertedCall")
      ? kpiCards.some((card) => card.label === "Converted Calls")
      : !kpiCards.some((card) => card.label === "Converted Calls"),
    "Converted Calls card did not respect field availability"
  );
  assertCondition(
    "Real dataset suggested questions are domain specific",
    suggestedQuestions.every((question) =>
      /(call|channel|campaign|source|keyword|roas|revenue|qualified|conversion|spend)/i.test(question)
    ),
    "expected suggested questions to stay in call tracking / attribution language"
  );
  assertCondition(
    "Real dataset Ask uses safe fallback for missing ROAS inputs",
    /cannot be calculated|required/i.test(roasAnswer.answer),
    "expected a deterministic missing-field explanation for unavailable ROAS"
  );

  console.log(`INFO Real dataset used: ${fileName}`);
}

async function main() {
  runInternalCase(
    "Case A",
    [
      {
        phone_call_id: "C-1001",
        caller: "+1 415 555 1200",
        tracking_no: "+1 415 555 9001",
        marketing_channel: "Google Ads",
        campaign_name: "Spring Promo",
        duration_seconds: 240,
        qualified: 1,
        sales_value: 450,
        media_cost: 120
      }
    ],
    ["callId", "callerNumber", "trackingNumber", "channel", "campaign", "callDuration", "qualifiedCall", "revenue", "spend"],
    "mixed_call_tracking_attribution"
  );

  runInternalCase(
    "Case B",
    [
      {
        lead_id: "L-1",
        source: "Google",
        campaign: "Brand Search",
        spend: 300,
        conversions: 4,
        revenue: 1200
      }
    ],
    ["source", "campaign", "spend", "revenue"],
    "marketing_attribution",
    ["callDuration", "missedCall"]
  );

  runInternalCase(
    "Case C",
    [
      {
        date: "2026-01-05",
        region: "APAC",
        product: "Widget A",
        revenue: 900
      }
    ],
    ["callDate", "region", "revenue"],
    "generic_business",
    ["callId", "qualifiedCall", "channel"]
  );

  await runRealDatasetCase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
