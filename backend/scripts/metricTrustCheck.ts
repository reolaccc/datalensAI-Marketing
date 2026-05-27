import fs from "node:fs";
import path from "node:path";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { buildKpiCards } from "../src/analytics/kpiCards.js";
import { aggregateSemanticMetric, detectCallDatasetGrain } from "../src/analytics/semanticContract.js";
import { aggregateByDimension } from "../src/services/analytics/chart-selection/chartDataUtils.js";

type Fixture = {
  name: string;
  rows: Array<Record<string, string | number | boolean | null>>;
};

function summarizeFixture(fixture: Fixture) {
  const profile = profileDataset(fixture.rows);
  const kpiCards = buildKpiCards(fixture.rows, profile);
  const calls = aggregateSemanticMetric(fixture.rows, "calls", profile);
  const qualifiedCalls = aggregateSemanticMetric(fixture.rows, "qualifiedCall", profile);
  const cpqc = aggregateSemanticMetric(fixture.rows, "cost_per_qualified_call", profile);
  const dimension = ["source", "channel", "campaign"].find((candidate) => fixture.rows.some((row) => candidate in row)) ?? null;
  const cpqcByDimension =
    dimension === null
      ? []
      : aggregateByDimension(
          fixture.rows,
          dimension,
          "cost_per_qualified_call",
          {
            numericMetrics: [],
            categoricalDimensions: [],
            datetimeFields: [],
            kpiCandidates: [],
            segmentFields: [],
            comparisonFields: [],
            anomalyFields: [],
            derivedMetrics: profile.semanticContract?.derivedMetrics ?? [],
            defaultMetric: null,
            defaultDimension: null,
            funnelStageFields: [],
            semanticContract: profile.semanticContract
          },
          profile
        );

  return {
    name: fixture.name,
    domain: profile.semanticContract?.detectedDomain,
    grain: detectCallDatasetGrain(profile),
    calls,
    qualifiedCalls,
    cpqc,
    cpqcByDimension,
    kpis: kpiCards.map((card) => ({
      label: card.label,
      value: card.formattedValue,
      formula: card.formula
    }))
  };
}

function summarizeRealDataset(fileName: string) {
  const filePath = path.resolve(process.cwd(), "datasets", fileName);
  const buffer = fs.readFileSync(filePath);
  const parsed = parseDataset(buffer, fileName);
  const profile = profileDataset(parsed.rows);
  const kpiCards = buildKpiCards(parsed.rows, profile);
  const cpqcBySource = aggregateByDimension(
    parsed.rows,
    "source__medium",
    "cost_per_qualified_call",
    {
      numericMetrics: [],
      categoricalDimensions: [],
      datetimeFields: [],
      kpiCandidates: [],
      segmentFields: [],
      comparisonFields: [],
      anomalyFields: [],
      derivedMetrics: profile.semanticContract?.derivedMetrics ?? [],
      defaultMetric: null,
      defaultDimension: null,
      funnelStageFields: [],
      semanticContract: profile.semanticContract
    },
    profile
  )
    .sort((left, right) => Number(left.cost_per_qualified_call ?? 0) - Number(right.cost_per_qualified_call ?? 0))
    .slice(0, 6);

  return {
    fileName,
    domain: profile.semanticContract?.detectedDomain,
    grain: detectCallDatasetGrain(profile),
    calls: aggregateSemanticMetric(parsed.rows, "calls", profile),
    qualifiedCalls: aggregateSemanticMetric(parsed.rows, "qualifiedCall", profile),
    missedCalls: aggregateSemanticMetric(parsed.rows, "missedCall", profile),
    revenue: aggregateSemanticMetric(parsed.rows, "revenue", profile),
    spend: aggregateSemanticMetric(parsed.rows, "spend", profile),
    cpqc: aggregateSemanticMetric(parsed.rows, "cost_per_qualified_call", profile),
    kpis: kpiCards.map((card) => ({
      label: card.label,
      value: card.formattedValue,
      formula: card.formula
    })),
    cpqcBySource
  };
}

const fixtures: Fixture[] = [
  {
    name: "row_level_call_log",
    rows: [
      { call_id: "A-1", campaign: "Brand", disposition: "Qualified Lead", ad_spend: 120 },
      { call_id: "A-2", campaign: "Brand", disposition: "Not Qualified", ad_spend: 80 },
      { call_id: "A-3", campaign: "Nonbrand", disposition: "Closed Won", ad_spend: 150 }
    ]
  },
  {
    name: "aggregated_total_calls",
    rows: [
      { campaign: "Brand", total_calls: 40, qualified_calls: 10, ad_spend: 500 },
      { campaign: "Nonbrand", total_calls: 60, qualified_calls: 15, ad_spend: 900 }
    ]
  },
  {
    name: "organic_missing_spend",
    rows: [
      { source: "Organic Search", total_calls: 30, qualified_calls: 9, ad_spend: null },
      { source: "Direct", total_calls: 20, qualified_calls: 5, ad_spend: 0 },
      { source: "Paid Search", total_calls: 15, qualified_calls: 3, ad_spend: 450 }
    ]
  },
  {
    name: "explicit_qualified_calls",
    rows: [
      { channel: "Paid Social", total_calls: 25, qualified_call_count: 6, ad_spend: 300 },
      { channel: "Paid Search", total_calls: 15, qualified_call_count: 3, ad_spend: 180 }
    ]
  }
];

const report = {
  fixtures: fixtures.map(summarizeFixture),
  realDataset: summarizeRealDataset("raw_call_data_blind.csv")
};

console.log(JSON.stringify(report, null, 2));
