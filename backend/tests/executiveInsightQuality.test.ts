import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeUploadedDataset } from "../src/services/analysisService.js";

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), "..", "..");

function resolveFixture(filePath: string) {
  return path.resolve(repoRoot, filePath);
}

async function analyzeFile(filePath: string) {
  const absolutePath = resolveFixture(filePath);
  const buffer = fs.readFileSync(absolutePath);
  return analyzeUploadedDataset(buffer, path.basename(absolutePath));
}

async function analyzeInlineCsv(fileName: string, csv: string) {
  const tempPath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(tempPath, csv);
  const buffer = fs.readFileSync(tempPath);
  return analyzeUploadedDataset(buffer, fileName);
}

function assertInsightQuality(datasetLabel: string, bullets: string[]) {
  assert.ok(bullets.length >= 2, `${datasetLabel} should produce at least two strong insights`);
  assert.ok(bullets.length <= 5, `${datasetLabel} should stay within the 2-5 insight target`);

  for (const bullet of bullets) {
    assert.match(bullet, /[.!?]$/, `${datasetLabel} insight should end cleanly: ${bullet}`);
    assert.doesNotMatch(
      bullet,
      /grounded signal|partially grounded|semantic signal|conclusions should stay tied|should be interpreted alongside|should be read as an operational usage signal/i,
      `${datasetLabel} insight leaked internal trust wording: ${bullet}`
    );
    assert.doesNotMatch(
      bullet,
      /^(ROAS|Load|Solar|Total Revenue|Revenue from Calls|Estimated Value|Marketing Cost Est)( is | totals )/i,
      `${datasetLabel} insight regressed into a KPI restatement: ${bullet}`
    );
    assert.doesNotMatch(
      bullet,
      /increase budget|shift budget|cut spend|double down|scale aggressively|optimize toward/i,
      `${datasetLabel} insight introduced unsupported optimization advice: ${bullet}`
    );
    assert.doesNotMatch(
      bullet,
      /convertedcall|talktime|callvolume|fulfilledorders|source channel account\b/i,
      `${datasetLabel} insight leaked internal label wording: ${bullet}`
    );
  }
}

function countMatches(bullets: string[], pattern: RegExp) {
  return bullets.reduce((count, bullet) => count + (pattern.test(bullet) ? 1 : 0), 0);
}

function extractLeadAnchor(bullet: string) {
  return bullet.match(/^([^,.]+?)\s+(is|contributes|leads|drives|carries|sits)\b/i)?.[1]?.toLowerCase().trim();
}

test("executive insights stay analytical across call-tracking, ops, retail, energy, and generic datasets", async () => {
  const analyses = await Promise.all([
    analyzeFile("datasets/datalens_chart_blindtest_call_tracking_320rows.csv"),
    analyzeFile("datasets/semantic_regression_pack_v1/ops_support_blindqa.csv"),
    analyzeFile("datasets/semantic_regression_pack_v1/retail_inventory_blindqa.csv"),
    analyzeFile("datasets/semantic_regression_pack_v1/energy_solar_blindqa.csv"),
    analyzeFile("datasets/semantic_regression_pack_v1/generic_unknown_blindqa.csv")
  ]);

  const [callTracking, operations, retail, energy, generic] = analyses;

  assertInsightQuality("call_tracking", callTracking.executiveSummary.bullets);
  assertInsightQuality("operations", operations.executiveSummary.bullets);
  assertInsightQuality("retail", retail.executiveSummary.bullets);
  assertInsightQuality("energy", energy.executiveSummary.bullets);
  assertInsightQuality("generic", generic.executiveSummary.bullets);

  assert.ok(
    callTracking.executiveSummary.bullets.some((bullet) => /traffic source|missed call|call quality|channel/i.test(bullet)),
    "call-tracking insights should stay framed around channel and call quality signals"
  );
  assert.ok(
    callTracking.executiveSummary.bullets.some((bullet) => /revenue/i.test(bullet) && /missed call/i.test(bullet)),
    "call-tracking should surface at least one grounded relationship between revenue and call-quality pressure"
  );
  assert.ok(
    countMatches(callTracking.executiveSummary.bullets, /top 3 .* (account for|contribute)/i) <= 1,
    `call-tracking should not repeat top-3 concentration scaffolding across multiple bullets: ${callTracking.executiveSummary.bullets.join(" | ")}`
  );
  assert.ok(
    callTracking.executiveSummary.bullets.length >= 4,
    `call-tracking should normally retain at least four grounded executive insight bullets: ${callTracking.executiveSummary.bullets.join(" | ")}`
  );
  assert.ok(
    operations.executiveSummary.bullets.some((bullet) => /service|queue|team|operational|capacity/i.test(bullet)),
    "operations insights should stay framed around service pressure"
  );
  assert.ok(
    operations.executiveSummary.bullets.some((bullet) => /service pressure|operational load|bottleneck|capacity review/i.test(bullet)),
    "operations should surface at least one grounded service-pressure or bottleneck insight"
  );
  assert.ok(
    retail.executiveSummary.bullets.some((bullet) => /inventory|fulfillment|warehouse|category|margin/i.test(bullet)),
    "retail insights should stay framed around commercial operations"
  );
  assert.ok(
    retail.executiveSummary.bullets.some((bullet) => /fulfillment cost/i.test(bullet) && /fulfilled orders/i.test(bullet)),
    "retail should surface at least one grounded relationship between cost and throughput"
  );
  assert.ok(
    countMatches(retail.executiveSummary.bullets, /top 3 .* (account for|contribute)/i) <= 1,
    `retail should avoid repeated top-3 concentration scaffolding: ${retail.executiveSummary.bullets.join(" | ")}`
  );
  assert.ok(
    energy.executiveSummary.bullets.some((bullet) => /solar|load|grid|site/i.test(bullet)),
    "energy insights should stay framed around operational usage"
  );
  assert.ok(
    energy.executiveSummary.bullets.some((bullet) => /solar/i.test(bullet) && /load/i.test(bullet)),
    "energy should surface at least one grounded relationship between generation and load"
  );
  assert.ok(
    generic.executiveSummary.bullets.every((bullet) => !/budget allocation|campaign performance|ROAS/i.test(bullet)),
    "generic insights should avoid marketing overreach"
  );
  assert.ok(
    generic.executiveSummary.bullets.every((bullet) => !/pipeline review|journey mix|follow-up dependency|stage progression/i.test(bullet)),
    `generic insights should avoid CRM overfit: ${generic.executiveSummary.bullets.join(" | ")}`
  );
  assert.ok(
    generic.executiveSummary.bullets.some(
      (bullet) =>
        (/largest observed revenue share|top 3|contributes/i.test(bullet) && /observed period|fluctuated/i.test(bullet)) ||
        /segment|observed value|value is unevenly distributed/i.test(bullet)
    ),
    "generic datasets should surface grounded concentration or trend signals without borrowing CRM framing"
  );
  assert.ok(
    countMatches(generic.executiveSummary.bullets, /top 3 .* (account for|contribute)/i) <= 1,
    `generic insights should not repeat the same top-3 anchor structure: ${generic.executiveSummary.bullets.join(" | ")}`
  );
});

test("crm-style datasets use pipeline-aware insights without marketing overreach", async () => {
  const crmStageCsv = [
    "date,customer_journey,lifecycle_stage,estimated_value,follow_up_count,closed_won,revenue",
    "2025-01-01,Callback,New,12000,6,0,0",
    "2025-01-08,Callback,Qualified,18000,5,0,0",
    "2025-01-15,Web Form,New,9000,2,0,0",
    "2025-01-22,Web Form,Proposal,11000,1,0,0",
    "2025-02-01,Inbound Call,Qualified,14000,2,0,0",
    "2025-02-10,Inbound Call,Closed Won,16000,1,1,16000",
    "2025-02-18,Referral,Proposal,7000,1,0,0",
    "2025-02-25,Referral,Closed Won,8000,1,1,8000"
  ].join("\n");

  const crm = await analyzeInlineCsv("executive_insight_crm.csv", crmStageCsv);
  const bullets = crm.executiveSummary.bullets;

  assertInsightQuality("crm", bullets);
  assert.ok(
    bullets.some((bullet) => /pipeline|customer journeys?|follow-up|callback|estimated value/i.test(bullet)),
    `crm insights should use pipeline-aware language: ${bullets.join(" | ")}`
  );
  assert.ok(
    bullets.length >= 3,
    `crm insights should keep at least three grounded bullets when pipeline signals exist: ${bullets.join(" | ")}`
  );
  assert.ok(
    bullets.some((bullet) => /lifecycle stages?|stage progression|closed outcomes?/i.test(bullet)),
    `crm insights should surface lifecycle-stage imbalance when stage fields exist: ${bullets.join(" | ")}`
  );
  assert.ok(
    bullets.every((bullet) => !/budget|roas|campaign performance|ad group/i.test(bullet)),
    `crm insights should avoid attribution-style optimization framing: ${bullets.join(" | ")}`
  );
});

test("executive insight dedupe preserves the third analytical bullet without repeating CRM anchors", async () => {
  const [callTracking, generic] = await Promise.all([
    analyzeFile("datasets/datalens_chart_blindtest_call_tracking_320rows.csv"),
    analyzeFile("datasets/semantic_regression_pack_v1/generic_unknown_blindqa.csv")
  ]);

  const callBullets = callTracking.executiveSummary.bullets;
  const genericBullets = generic.executiveSummary.bullets;

  assert.ok(
    callBullets.length >= 3,
    `call-tracking regression should keep a third analytical bullet instead of collapsing to two: ${callBullets.join(" | ")}`
  );
  assert.ok(
    callBullets.some((bullet) => /observed period|fluctuat/i.test(bullet)),
    `call-tracking should retain a grounded trend bullet after dedupe: ${callBullets.join(" | ")}`
  );
  assert.ok(
    callBullets.some((bullet) => /qualified calls?|qualified leads?|lead quality/i.test(bullet)),
    `call-tracking should retain a qualification-focused bullet after dedupe: ${callBullets.join(" | ")}`
  );

  assert.ok(
    genericBullets.every((bullet) => !/callback|customer journey|pipeline/i.test(bullet)),
    `generic insights should not repeat CRM-style anchors after dedupe: ${genericBullets.join(" | ")}`
  );
});
