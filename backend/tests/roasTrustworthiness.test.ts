import test from "node:test";
import assert from "node:assert/strict";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { aggregateSemanticMetric, getRoasRowReliability } from "../src/analytics/semanticContract.js";
import { aggregateByDimension } from "../src/services/analytics/chart-selection/chartDataUtils.js";
import { executePlannedQuery } from "../src/analytics/queryEngine.js";
import type {
  DatasetCapabilities,
  DatasetRow,
  PlannedQuery,
  SemanticBusinessIntentAnalysis
} from "../src/analytics/types.js";

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

const roasSemanticProfile: SemanticBusinessIntentAnalysis = {
  businessIntent: "efficient",
  matchedPhrases: [],
  metricSignals: [{ metric: "roas", direction: "high", weight: 1 }],
  dimensionHints: [],
  confidence: 0.6,
  summary: "ROAS ranking"
};

function buildRoasQuery(dimension: string): PlannedQuery {
  return {
    intent: "summary",
    metric: "roas",
    metrics: ["roas"],
    dimension,
    datetimeColumn: null,
    aggregateOperation: "sum",
    sortDirection: "desc",
    limit: 5,
    filters: [],
    comparisonValues: [],
    semanticProfile: roasSemanticProfile
  };
}

test("valid ROAS remains revenue divided by spend", () => {
  const rows: DatasetRow[] = [{ campaign: "Campaign A", revenue: 5000, spend: 1000 }];
  const profile = profileDataset(rows);

  assert.equal(aggregateSemanticMetric(rows, "roas", profile), 5);
  const byCampaign = aggregateByDimension(rows, "campaign", "roas", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [{ campaign: "Campaign A", roas: 5 }]);
});

test("missing revenue returns null and does not rank as 0", () => {
  const rows: DatasetRow[] = [
    { campaign: "Campaign A", revenue: 5000, spend: 1000 },
    { campaign: "Campaign B", revenue: "", spend: 1000 }
  ];
  const profile = profileDataset(rows);

  assert.equal(aggregateSemanticMetric([{ campaign: "Campaign B", revenue: "", spend: 1000 }], "roas", profileDataset([{ campaign: "Campaign B", revenue: "", spend: 1000 }])), null);
  const byCampaign = aggregateByDimension(rows, "campaign", "roas", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [{ campaign: "Campaign A", roas: 5 }]);

  const answer = executePlannedQuery("Which campaign has the highest ROAS?", buildRoasQuery("campaign"), { rows, profile });
  assert.match(answer.answer, /Campaign A/i);
  assert.doesNotMatch(answer.answer, /Campaign B/i);
});

test("missing spend returns null and zero spend returns null", () => {
  const rows: DatasetRow[] = [
    { campaign: "Campaign C", revenue: 2000, spend: "" },
    { campaign: "Campaign D", revenue: 2000, spend: 0 }
  ];
  const profile = profileDataset(rows);

  assert.equal(aggregateSemanticMetric([rows[0]], "roas", profileDataset([rows[0]])), null);
  assert.equal(aggregateSemanticMetric([rows[1]], "roas", profileDataset([rows[1]])), null);
  const byCampaign = aggregateByDimension(rows, "campaign", "roas", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, []);
});

test("grouped ROAS uses summed revenue divided by summed spend", () => {
  const rows: DatasetRow[] = [
    { campaign: "Campaign A", revenue: 3000, spend: 600 },
    { campaign: "Campaign A", revenue: 2000, spend: 400 }
  ];
  const profile = profileDataset(rows);

  assert.equal(aggregateSemanticMetric(rows, "roas", profile), 5);
  const byCampaign = aggregateByDimension(rows, "campaign", "roas", minimalCapabilities, profile);
  assert.deepEqual(byCampaign, [{ campaign: "Campaign A", roas: 5 }]);
});

test("invalid ROAS groups do not rank as best", () => {
  const rows: DatasetRow[] = [
    { campaign: "Campaign A", revenue: 5000, spend: 1000 },
    { campaign: "Campaign B", revenue: 2000, spend: 0 },
    { campaign: "Campaign C", revenue: "", spend: 1000 }
  ];
  const profile = profileDataset(rows);

  const answer = executePlannedQuery("Which campaign has the highest ROAS?", buildRoasQuery("campaign"), { rows, profile });
  assert.match(answer.answer, /Campaign A/i);
  assert.doesNotMatch(answer.answer, /Campaign B/i);
  assert.doesNotMatch(answer.answer, /Campaign C/i);
});

test("ROAS reliability distinguishes missing spend from zero spend", () => {
  const rows: DatasetRow[] = [
    { campaign: "Campaign C", revenue: 2000, spend: "" },
    { campaign: "Campaign D", revenue: 2000, spend: 0 }
  ];
  const reliability = rows.map((row) => getRoasRowReliability(row, profileDataset([row])));

  assert.deepEqual(
    reliability.map((entry) => ({
      revenueStatus: entry.revenueStatus,
      spendStatus: entry.spendStatus,
      isRankableRoasRow: entry.isRankableRoasRow
    })),
    [
      { revenueStatus: "present", spendStatus: "missing", isRankableRoasRow: false },
      { revenueStatus: "present", spendStatus: "zero", isRankableRoasRow: false }
    ]
  );
});
