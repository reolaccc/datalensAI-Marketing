import type { DatasetProfile, KpiCandidate } from "../analytics/types.js";
import type { LlmProvider } from "../providers/llmProvider.js";
import { buildExecutiveSummaryPrompt, type ExecutiveSummaryPromptOutput } from "./executiveSummaryPrompt.js";

type ExecutiveSummary = {
  overview: string;
  kpiSummary: string;
  anomalySummary: string;
  trendSummary: string;
  suggestedQuestions: string[];
};

interface ExecutiveSummaryOptions {
  fileName?: string;
  edaSummary?: string;
  llmProvider?: LlmProvider;
  mode?: "local" | "llm" | "auto";
}

function findKpi(kpis: KpiCandidate[], ...labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  return kpis.find((kpi) => normalizedLabels.includes(kpi.label.toLowerCase()) || normalizedLabels.includes(kpi.column.toLowerCase()));
}

function formatMetricLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildBusinessInsightSummary(profile: DatasetProfile, kpis: KpiCandidate[]): [string, string, string, string] {
  const topKpi = kpis[0];
  const revenueKpi = findKpi(kpis, "revenue", "sales", "income", "gmv", "conversion_value");
  const roasKpi = findKpi(kpis, "roas");
  const roiKpi = findKpi(kpis, "roi");
  const conversionRateKpi = findKpi(kpis, "conversion_rate", "cvr");
  const clicksKpi = findKpi(kpis, "clicks");
  const impressionsKpi = findKpi(kpis, "impressions");
  const costKpi = findKpi(kpis, "cost");
  const leadKpi = findKpi(kpis, "leads", "calls");
  const strongestCorrelation = profile.correlations[0];
  const strongestOutlier = profile.outliers[0];
  const hasTimeField = profile.datetimeColumns.length > 0;
  const hasSegments = profile.categoricalColumns.length > 0;
  const limitedSample = profile.rowCount < 30;

  const primaryInsight = revenueKpi
    ? `Revenue is the clearest business signal in this dataset, so it should anchor performance reviews and near-term decision making.`
    : topKpi
      ? `${formatMetricLabel(topKpi.label)} stands out as the strongest headline metric, so it is the best starting point for management review.`
      : `This dataset does not expose a single standout commercial KPI, so decisions should stay focused on the strongest available operating metrics.`;

  let efficiencyInsight = `Performance should be reviewed alongside both return and cost so the team does not optimize for volume without checking efficiency.`;
  if (roasKpi) {
    efficiencyInsight = `ROAS looks like a meaningful efficiency signal here, but leadership should confirm whether strong returns are broad-based or driven by a small number of wins.`;
  } else if (roiKpi) {
    efficiencyInsight = `ROI is available for review, so the next management question should be whether profitability is improving consistently or only in selected pockets.`;
  } else if (conversionRateKpi && clicksKpi) {
    efficiencyInsight = `Traffic volume is visible, but conversion remains the real test of performance, so attention should stay on whether demand is turning into business results.`;
  } else if (costKpi && revenueKpi) {
    efficiencyInsight = `Revenue and cost should be reviewed together because headline growth only matters if spend is staying disciplined.`;
  }

  let riskInsight = `The business should review segment-level performance next, because overall totals can hide uneven results across channels, campaigns, or devices.`;
  if (conversionRateKpi && clicksKpi) {
    riskInsight = `Clicks appear to create reach, but the business should verify whether that attention is converting efficiently enough to justify continued spend.`;
  } else if (impressionsKpi && !conversionRateKpi) {
    riskInsight = `Reach is visible in the data, but management should confirm whether awareness is translating into commercial outcomes rather than staying at the top of the funnel.`;
  } else if (leadKpi) {
    riskInsight = `Lead-related activity is visible, so the next decision point is whether lead volume is matched by lead quality and downstream value.`;
  }

  let actionInsight = hasSegments
    ? `The next decision review should focus on which segments deserve more investment and which ones need corrective action, rather than treating overall performance as evenly distributed.`
    : `The next decision review should test whether the strongest signals in this dataset are repeatable, rather than assuming current performance will hold.`;

  if (strongestOutlier) {
    actionInsight = `A small number of unusually strong or weak results may be shaping the headline numbers, so management should test whether current performance is sustainable before scaling decisions.`;
  } else if (strongestCorrelation && revenueKpi && costKpi) {
    actionInsight = `Revenue and spend appear to move together, so the next management question is whether additional spend is creating efficient growth or simply buying volume.`;
  } else if (hasTimeField) {
    actionInsight = `Because the dataset includes a time signal, leaders should review whether the current picture is improving, flattening, or starting to weaken before changing budget allocation.`;
  }

  if (limitedSample) {
    actionInsight = `${actionInsight.replace(/\.$/, "")} This should be treated as directional because the sample is still limited.`;
  }

  return [primaryInsight, efficiencyInsight, riskInsight, actionInsight];
}

function buildLocalExecutiveSummary(profile: DatasetProfile, kpis: KpiCandidate[]): ExecutiveSummary {
  const [overview, kpiSummary, anomalySummary, trendSummary] = buildBusinessInsightSummary(profile, kpis);
  const dimensions = profile.semanticContract?.availableDimensions ?? [];
  const hasChannel = dimensions.includes("channel");
  const hasCampaign = dimensions.includes("campaign");
  const hasRegion = dimensions.includes("region");
  const hasDate = dimensions.includes("date") || profile.datetimeColumns.length > 0;

  return {
    overview,
    kpiSummary,
    anomalySummary,
    trendSummary,
    suggestedQuestions: [
      hasChannel
        ? "Which channel generated the most revenue?"
        : hasCampaign
          ? "Which campaign generated the most revenue?"
          : hasRegion
            ? "Which region generated the most revenue?"
            : "Which segment generated the most revenue?",
      hasCampaign
        ? "Which campaigns should receive more budget?"
        : hasChannel
          ? "Which channels should be reviewed for low return?"
          : "Which segment deserves more budget or closer review?",
      hasDate
        ? "Where did performance change the most over time?"
        : "Is revenue too concentrated in one segment?"
    ]
  };
}

function parseExecutiveSummaryFromLlm(text: string): ExecutiveSummary | null {
  try {
    const parsed = JSON.parse(text) as Partial<ExecutiveSummary>;
    if (
      typeof parsed.overview === "string" &&
      typeof parsed.kpiSummary === "string" &&
      typeof parsed.anomalySummary === "string" &&
      typeof parsed.trendSummary === "string" &&
      Array.isArray(parsed.suggestedQuestions) &&
      parsed.suggestedQuestions.every((entry) => typeof entry === "string")
    ) {
      return {
        overview: parsed.overview,
        kpiSummary: parsed.kpiSummary,
        anomalySummary: parsed.anomalySummary,
        trendSummary: parsed.trendSummary,
        suggestedQuestions: parsed.suggestedQuestions
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function buildLlmExecutiveSummary(
  profile: DatasetProfile,
  kpis: KpiCandidate[],
  options: ExecutiveSummaryOptions
): Promise<ExecutiveSummary | null> {
  const provider = options.llmProvider;
  if (!provider) {
    return null;
  }

  const prompt = buildExecutiveSummaryPrompt({
    fileName: options.fileName ?? "dataset",
    edaSummary: options.edaSummary ?? "",
    profile,
    kpis
  });

  const result = await provider.generateText(prompt);
  return parseExecutiveSummaryFromLlm(result.text);
}

export async function generateExecutiveSummary(
  profile: DatasetProfile,
  kpis: KpiCandidate[],
  options: ExecutiveSummaryOptions = {}
): Promise<ExecutiveSummary> {
  if (options.mode === "local") {
    return buildLocalExecutiveSummary(profile, kpis);
  }

  if (options.mode === "llm" || options.mode === "auto") {
    const llmSummary = await buildLlmExecutiveSummary(profile, kpis, options);
    if (llmSummary) {
      return llmSummary;
    }
  }

  return buildLocalExecutiveSummary(profile, kpis);
}

export function generateEdaSummary(profile: DatasetProfile, kpis: KpiCandidate[]): string {
  const parts = [
    `Profiled ${profile.rowCount} rows across ${profile.columnCount} columns.`,
    `${profile.numericColumns.length} numeric, ${profile.categoricalColumns.length} categorical, and ${profile.datetimeColumns.length} datetime columns detected.`,
    profile.missingCells > 0
      ? `${profile.missingCells} missing cells were found.`
      : "No missing cells were detected.",
    profile.duplicateRowCount > 0
      ? `${profile.duplicateRowCount} duplicate rows were identified.`
      : "No duplicate rows were detected.",
    kpis.length > 0
      ? `Top KPI candidates: ${kpis
          .slice(0, 3)
          .map((kpi) => kpi.label)
          .join(", ")}.`
      : "No strong KPI candidates were inferred."
  ];

  return parts.join(" ");
}
