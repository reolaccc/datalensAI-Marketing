import test from "node:test";
import assert from "node:assert/strict";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { aggregateSemanticMetric, getCpqcRowReliability } from "../src/analytics/semanticContract.js";
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

const neutralSemanticProfile: SemanticBusinessIntentAnalysis = {
  businessIntent: "neutral",
  matchedPhrases: [],
  metricSignals: [{ metric: "cost_per_qualified_call", direction: "low", weight: 1 }],
  dimensionHints: [],
  confidence: 0.5,
  summary: "CPQC ranking"
};

function buildCpqcQuery(dimension: string): PlannedQuery {
  return {
    intent: "summary",
    metric: "cost_per_qualified_call",
    metrics: ["cost_per_qualified_call"],
    dimension,
    datetimeColumn: null,
    aggregateOperation: "sum",
    sortDirection: "asc",
    limit: 5,
    filters: [],
    comparisonValues: [],
    semanticProfile: neutralSemanticProfile
  };
}

test("grouped CPQC with zero qualified calls returns null instead of 0", () => {
  const rows: DatasetRow[] = [{ channel: "Meta Ads", spend: 500, qualified_calls: 0 }];
  const profile = profileDataset(rows);

  const byChannel = aggregateByDimension(rows, "channel", "cost_per_qualified_call", minimalCapabilities, profile);

  assert.deepEqual(byChannel, [{ channel: "Paid Social", cost_per_qualified_call: null }]);
  assert.equal(aggregateSemanticMetric(rows, "cost_per_qualified_call", profile), null);
});

test("missing spend does not produce CPQC zero and does not rank as best", () => {
  const rows: DatasetRow[] = [
    { channel: "Google Ads", spend: 100, qualified_calls: 2 },
    { channel: "Unknown Source", spend: "", qualified_calls: 10 }
  ];
  const profile = profileDataset(rows);

  const byChannel = aggregateByDimension(rows, "channel", "cost_per_qualified_call", minimalCapabilities, profile);
  assert.deepEqual(byChannel, [{ channel: "Google Ads", cost_per_qualified_call: 50 }]);

  const answer = executePlannedQuery("Which channel has the best CPQC?", buildCpqcQuery("channel"), { rows, profile });
  assert.match(answer.answer, /Google Ads/i);
  assert.doesNotMatch(answer.answer, /Unknown Source/i);
});

test("valid grouped CPQC aggregate remains spend sum divided by qualified-call sum", () => {
  const rows: DatasetRow[] = [
    { channel: "Google Ads", spend: 100, qualified_calls: 2 },
    { channel: "Google Ads", spend: 200, qualified_calls: 3 }
  ];
  const profile = profileDataset(rows);

  assert.equal(aggregateSemanticMetric(rows, "cost_per_qualified_call", profile), 60);
  const byChannel = aggregateByDimension(rows, "channel", "cost_per_qualified_call", minimalCapabilities, profile);
  assert.deepEqual(byChannel, [{ channel: "Google Ads", cost_per_qualified_call: 60 }]);
});

test("unknown channels keep trust logic lightweight without forced taxonomy assumptions", () => {
  const rows: DatasetRow[] = [
    { channel: "Mystery A", spend: 100, qualified_calls: 5 },
    { channel: "Mystery B", spend: 50, qualified_calls: 10 }
  ];
  const profile = profileDataset(rows);

  const reliability = rows.map((row) => getCpqcRowReliability(row, profile));
  assert.deepEqual(
    reliability.map((entry) => ({
      spendStatus: entry.spendStatus,
      qualifiedStatus: entry.qualifiedStatus,
      isRankableCpqcRow: entry.isRankableCpqcRow
    })),
    [
      { spendStatus: "positive", qualifiedStatus: "positive", isRankableCpqcRow: true },
      { spendStatus: "positive", qualifiedStatus: "positive", isRankableCpqcRow: true }
    ]
  );

  const answer = executePlannedQuery("Which channel has the best CPQC?", buildCpqcQuery("channel"), { rows, profile });
  assert.match(answer.answer, /Mystery B/i);
});

test("zero-qualified groups do not rank as cheapest CPQC", () => {
  const rows: DatasetRow[] = [
    { channel: "Google Ads", spend: 1000, qualified_calls: 20 },
    { channel: "Meta Ads", spend: 500, qualified_calls: 0 }
  ];
  const profile = profileDataset(rows);

  const answer = executePlannedQuery("Which channel has the best CPQC?", buildCpqcQuery("channel"), { rows, profile });
  assert.match(answer.answer, /Google Ads/i);
  assert.doesNotMatch(answer.answer, /Meta Ads has the lowest cost per qualified call/i);
});
