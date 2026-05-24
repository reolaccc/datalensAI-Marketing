import type {
  ChartConfig,
  DatasetProfile,
  IntentDetectionResult,
  KpiCandidate,
  PrimitiveValue,
  QuestionContextInput
} from "../analytics/types.js";
import { createConfiguredLlmProvider } from "./provider.js";
import type {
  AnalyticsFacts,
  AskAnswerNarrative,
  ChartExplanationNarrative,
  ExecutiveInsightNarrative,
  QuestionNarrativeInput
} from "./types.js";
import {
  buildAskAnswerPrompt,
  buildChartExplanationsPrompt,
  buildExecutiveInsightPrompt,
  parseJsonResponse
} from "./prompts.js";

function normalizeName(value: string) {
  return value.toLowerCase().replace(/_/g, " ").trim();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getKpi(kpis: KpiCandidate[], ...labels: string[]) {
  const wanted = labels.map(normalizeName);
  return kpis.find((kpi) => wanted.includes(normalizeName(kpi.label)) || wanted.includes(normalizeName(kpi.column)));
}

function buildWarnings(profile: DatasetProfile, kpis: KpiCandidate[]) {
  const warnings: string[] = [];
  if (profile.missingCells > 0) {
    warnings.push(`${profile.missingCells} missing cell${profile.missingCells === 1 ? "" : "s"} detected.`);
  }
  if (profile.duplicateRowCount > 0) {
    warnings.push(`${profile.duplicateRowCount} duplicate row${profile.duplicateRowCount === 1 ? "" : "s"} detected.`);
  }
  if (profile.outliers.length > 0) {
    warnings.push(`${profile.outliers.length} column${profile.outliers.length === 1 ? "" : "s"} with outlier signals detected.`);
  }
  if (kpis.length === 0) {
    warnings.push("No clear KPI candidates were detected.");
  }
  return warnings;
}

function buildCoreKpiFacts(kpis: KpiCandidate[]) {
  const revenue = getKpi(kpis, "revenue", "sales", "income", "gmv", "conversion value");
  const cost = getKpi(kpis, "cost", "spend", "ad spend", "budget");
  const clicks = getKpi(kpis, "clicks", "click count");
  const impressions = getKpi(kpis, "impressions", "views");
  const conversionRate = getKpi(kpis, "conversion rate", "cvr", "conversion_rate");
  const roas = getKpi(kpis, "roas", "return on ad spend");

  const totalRevenue = revenue?.aggregateValue;
  const totalCost = cost?.aggregateValue;
  const totalClicks = clicks?.aggregateValue;
  const totalImpressions = impressions?.aggregateValue;
  const overallConversionRate = conversionRate?.aggregateValue;
  const overallRoas =
    totalRevenue !== undefined && totalCost !== undefined && totalCost > 0
      ? Number((totalRevenue / totalCost).toFixed(2))
      : roas?.aggregateValue;

  return {
    totalRevenue,
    totalCost,
    totalClicks,
    totalImpressions,
    overallRoas,
    overallConversionRate,
    additionalMetrics: kpis
      .filter((kpi) => ![revenue, cost, clicks, impressions, conversionRate, roas].includes(kpi))
      .slice(0, 5)
      .map((kpi) => ({ name: kpi.label, value: kpi.aggregateValue }))
  };
}

function buildTopFindingFromChart(chart: ChartConfig) {
  if (!chart.dimension || !chart.metric || chart.data.length === 0) {
    return null;
  }

  const rows = chart.data
    .map((row) => ({
      label: String(row[chart.dimension ?? ""]),
      value: Number(row[chart.metric ?? ""] ?? 0)
    }))
    .filter((entry) => entry.label && Number.isFinite(entry.value))
    .sort((left, right) => right.value - left.value);

  if (rows.length === 0) {
    return null;
  }

  const total = rows.reduce((sum, entry) => sum + entry.value, 0);
  const top = rows[0];
  const bottom = rows[rows.length - 1];

  return {
    top: {
      name: top.label,
      value: Number(top.value.toFixed(2)),
      share: total > 0 ? Number((top.value / total).toFixed(3)) : undefined
    },
    bottom: bottom
      ? {
          name: bottom.label,
          value: Number(bottom.value.toFixed(2))
        }
      : undefined
  };
}

function pickTopFinding(charts: ChartConfig[], metrics: string[]) {
  const wanted = metrics.map(normalizeName);
  const matchingChart = charts.find((chart) => wanted.includes(normalizeName(chart.metric ?? chart.title)));
  if (!matchingChart) {
    return null;
  }

  const findings = buildTopFindingFromChart(matchingChart);
  if (!findings) {
    return null;
  }

  return {
    chart: matchingChart,
    ...findings
  };
}

export function buildAnalyticsFactsFromAnalysis(params: {
  fileName: string;
  profile: DatasetProfile;
  kpis: KpiCandidate[];
  charts: ChartConfig[];
}): AnalyticsFacts {
  const warnings = buildWarnings(params.profile, params.kpis);
  const revenueChart = pickTopFinding(params.charts, ["revenue", "sales", "income", "gmv", "conversion value"]);
  const roasChart = pickTopFinding(params.charts, ["roas", "return on ad spend", "roi"]);
  const weakestChart =
    revenueChart?.chart && revenueChart.bottom
      ? {
          dimension: revenueChart.chart.dimension ?? "dimension",
          name: revenueChart.bottom.name,
          reason: `lowest ${normalizeName(revenueChart.chart.metric ?? "metric")} among the displayed segments`
        }
      : roasChart?.chart && roasChart.bottom
        ? {
            dimension: roasChart.chart.dimension ?? "dimension",
            name: roasChart.bottom.name,
            reason: `lowest ${normalizeName(roasChart.chart.metric ?? "metric")} among the displayed segments`
          }
        : undefined;

  return {
    datasetSummary: {
      fileName: params.fileName,
      rowCount: params.profile.rowCount,
      columnCount: params.profile.columnCount,
      missingCells: params.profile.missingCells,
      duplicateRows: params.profile.duplicateRowCount,
      warnings
    },
    kpis: buildCoreKpiFacts(params.kpis),
    topFindings: {
      topRevenueSegment: revenueChart?.top
        ? {
            dimension: revenueChart.chart.dimension ?? "dimension",
            name: revenueChart.top.name,
            revenue: revenueChart.top.value,
            share: revenueChart.top.share ?? 0
          }
        : undefined,
      bestRoasSegment: roasChart?.top
        ? {
            dimension: roasChart.chart.dimension ?? "dimension",
            name: roasChart.top.name,
            roas: roasChart.top.value
          }
        : undefined,
      weakestSegment: weakestChart
    },
    charts: params.charts.map((chart) => ({
      id: chart.id,
      title: chart.title,
      chartType: chart.chartType,
      intent: chart.intent,
      metric: chart.metric,
      dimension: chart.dimension,
      reasonCode: chart.reason,
      reason: chart.reason,
      dataPreview: chart.data.slice(0, 3)
    })),
    profile: {
      numericColumns: params.profile.numericColumns,
      categoricalColumns: params.profile.categoricalColumns,
      datetimeColumns: params.profile.datetimeColumns,
      outliers: params.profile.outliers.slice(0, 5),
      correlations: params.profile.correlations.slice(0, 5)
    }
  };
}

function buildFallbackExecutiveInsightNarrative(facts: AnalyticsFacts): ExecutiveInsightNarrative {
  const bullets: string[] = [];
  if (facts.topFindings.topRevenueSegment) {
    bullets.push(
      `${facts.topFindings.topRevenueSegment.name} generated the strongest revenue result, contributing ${formatPercent(facts.topFindings.topRevenueSegment.share)} of total revenue.`
    );
  }
  if (facts.topFindings.bestRoasSegment) {
    bullets.push(
      `${facts.topFindings.bestRoasSegment.name} has the best ROAS at ${formatNumber(facts.topFindings.bestRoasSegment.roas)}, so efficiency should be weighed against raw revenue.`
    );
  }
  if (facts.kpis.overallRoas !== undefined || facts.kpis.totalRevenue !== undefined || facts.kpis.totalCost !== undefined) {
    bullets.push(
      `Revenue ${facts.kpis.totalRevenue !== undefined ? `totals ${formatNumber(facts.kpis.totalRevenue)}` : "is available"}, while ${facts.kpis.totalCost !== undefined ? `cost totals ${formatNumber(facts.kpis.totalCost)}` : "cost is not fully available"}, so budget decisions should stay tied to efficiency.`
    );
  }
  if (facts.datasetSummary.warnings.length > 0) {
    bullets.push(`Data quality needs a quick check: ${facts.datasetSummary.warnings.slice(0, 2).join(" ")}`);
  }
  if (bullets.length < 3) {
    bullets.push(
      `The dataset spans ${facts.datasetSummary.rowCount} rows and ${facts.datasetSummary.columnCount} columns, so the next step is to validate whether the strongest signals hold across channels, campaigns, or other segments.`
    );
  }

  return {
    bullets: bullets.slice(0, 5),
    suggestedQuestions: [
      facts.topFindings.topRevenueSegment
        ? `How does ${facts.topFindings.topRevenueSegment.name} compare on ROAS and conversion efficiency?`
        : "Which segment is performing best on both revenue and efficiency?",
      facts.topFindings.bestRoasSegment
        ? `What is driving the stronger ROAS in ${facts.topFindings.bestRoasSegment.name}?`
        : "Which segment deserves more budget and which one needs corrective action?",
      "Where do data quality issues affect confidence in the headline results?"
    ],
    warning:
      ["AI explanation unavailable; showing rule-based summary.", ...facts.datasetSummary.warnings]
        .filter(Boolean)
        .join(" "),
    source: "fallback"
  };
}

function parseExecutiveInsightNarrative(text: string): ExecutiveInsightNarrative | null {
  const parsed = parseJsonResponse<{
    bullets?: unknown;
    suggestedQuestions?: unknown;
    warning?: unknown;
  }>(text);

  if (
    !parsed ||
    !Array.isArray(parsed.bullets) ||
    !parsed.bullets.every((entry) => typeof entry === "string") ||
    !Array.isArray(parsed.suggestedQuestions) ||
    !parsed.suggestedQuestions.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return {
    bullets: parsed.bullets.slice(0, 5),
    suggestedQuestions: parsed.suggestedQuestions.slice(0, 5),
    warning: typeof parsed.warning === "string" && parsed.warning.trim() ? parsed.warning : undefined,
    source: "llm"
  };
}

function parseChartExplanations(text: string): ChartExplanationNarrative[] | null {
  const parsed = parseJsonResponse<{ charts?: Array<{ id?: unknown; explanation?: unknown }> }>(text);
  if (!parsed || !Array.isArray(parsed.charts)) {
    return null;
  }

  const charts = parsed.charts
    .filter(
      (entry): entry is { id: string; explanation: string } =>
        typeof entry?.id === "string" && typeof entry.explanation === "string" && entry.explanation.trim().length > 0
    )
    .map((entry) => ({ id: entry.id, explanation: entry.explanation.trim() }));

  return charts.length > 0 ? charts : null;
}

function parseAskAnswerNarrative(text: string): AskAnswerNarrative | null {
  const parsed = parseJsonResponse<{
    directAnswer?: unknown;
    evidence?: unknown;
    caution?: unknown;
    suggestedNextQuestion?: unknown;
    analysisSummary?: unknown;
    chartSelectionSummary?: unknown;
    warning?: unknown;
  }>(text);

  if (
    !parsed ||
    typeof parsed.directAnswer !== "string" ||
    !Array.isArray(parsed.evidence) ||
    !parsed.evidence.every((entry) => typeof entry === "string") ||
    typeof parsed.analysisSummary !== "string" ||
    typeof parsed.chartSelectionSummary !== "string"
  ) {
    return null;
  }

  return {
    directAnswer: parsed.directAnswer,
    evidence: parsed.evidence,
    caution: typeof parsed.caution === "string" && parsed.caution.trim() ? parsed.caution : undefined,
    suggestedNextQuestion:
      typeof parsed.suggestedNextQuestion === "string" && parsed.suggestedNextQuestion.trim()
        ? parsed.suggestedNextQuestion
        : undefined,
    analysisSummary: parsed.analysisSummary,
    chartSelectionSummary: parsed.chartSelectionSummary,
    warning: typeof parsed.warning === "string" && parsed.warning.trim() ? parsed.warning : undefined,
    source: "llm"
  };
}

export function buildFallbackChartExplanations(
  facts: AnalyticsFacts,
  charts: ChartConfig[]
): ChartExplanationNarrative[] {
  return charts.map((chart) => {
    const metricLabel = chart.metric ?? "the selected metric";
    const dimensionLabel = chart.dimension ?? "the selected dimension";
    const topFinding =
      chart.metric && facts.topFindings.topRevenueSegment && normalizeName(chart.metric).includes("revenue")
        ? facts.topFindings.topRevenueSegment
        : chart.metric && facts.topFindings.bestRoasSegment && normalizeName(chart.metric).includes("roas")
          ? facts.topFindings.bestRoasSegment
          : null;

    const nextStep =
      facts.topFindings.bestRoasSegment && !normalizeName(metricLabel).includes("roas")
        ? `compare it with ${facts.topFindings.bestRoasSegment.name}'s efficiency before changing budget`
        : facts.kpis.overallRoas !== undefined
          ? "compare it with ROAS before making a budget decision"
          : "compare it with a complementary segment or time view";

    return {
      id: chart.id,
      explanation: `This ${chart.chartType.replace(/_/g, " ")} chart compares ${metricLabel} by ${dimensionLabel} to answer which ${dimensionLabel} drives the strongest business outcome. ${topFinding ? `${topFinding.name} leads the displayed segment comparison.` : ""} The next check should be to ${nextStep}.`
    };
  });
}

export function buildFallbackAskAnswerNarrative(
  input: QuestionNarrativeInput,
  warning = "AI explanation unavailable; showing rule-based summary."
): AskAnswerNarrative {
  const evidence = input.supportingData.map((entry) => `${entry.label}: ${String(entry.value)}`);
  return {
    directAnswer: input.answer,
    evidence: evidence.length > 0 ? evidence : ["No supporting aggregates were available."],
    caution: input.chartSelectionWarnings.length > 0 ? input.chartSelectionWarnings.join(" ") : undefined,
    suggestedNextQuestion: input.suggestedFollowUps[0],
    analysisSummary: input.chartSelectionSummary,
    chartSelectionSummary: input.chartSelectionExplanation,
    warning,
    source: "fallback"
  };
}

async function runNarrativeRequest<T>(
  requestBuilder: (providerName: string) => ReturnType<typeof buildExecutiveInsightPrompt>,
  parser: (text: string) => T | null
) {
  const provider = createConfiguredLlmProvider();
  if (provider.name === "disabled") {
    return null;
  }

  const request = requestBuilder(provider.name);
  try {
    const result = await provider.generateText(request);
    return parser(result.text);
  } catch {
    return null;
  }
}

export async function generateExecutiveInsights(facts: AnalyticsFacts): Promise<ExecutiveInsightNarrative> {
  const provider = createConfiguredLlmProvider();
  if (provider.name !== "disabled") {
    try {
      const result = await provider.generateText(buildExecutiveInsightPrompt(facts));
      const parsed = parseExecutiveInsightNarrative(result.text);
      if (parsed) {
        return parsed;
      }
    } catch {
      // fall through to deterministic summary
    }
  }

  return buildFallbackExecutiveInsightNarrative(facts);
}

export async function generateChartExplanations(
  facts: AnalyticsFacts,
  charts: ChartConfig[],
  question?: string
): Promise<ChartExplanationNarrative[]> {
  const provider = createConfiguredLlmProvider();
  if (provider.name !== "disabled") {
    try {
      const result = await provider.generateText(buildChartExplanationsPrompt(facts, charts, question));
      const parsed = parseChartExplanations(result.text);
      if (parsed) {
        return charts.map((chart) => parsed.find((entry) => entry.id === chart.id) ?? { id: chart.id, explanation: chart.description || chart.reason });
      }
    } catch {
      // fall through to deterministic summary
    }
  }

  return buildFallbackChartExplanations(facts, charts);
}

export async function generateAskAnswer(input: QuestionNarrativeInput): Promise<AskAnswerNarrative> {
  const provider = createConfiguredLlmProvider();
  if (provider.name !== "disabled") {
    try {
      const result = await provider.generateText(buildAskAnswerPrompt(input));
      const parsed = parseAskAnswerNarrative(result.text);
      if (parsed) {
        return parsed;
      }
    } catch {
      // fall through to deterministic summary
    }
  }

  return buildFallbackAskAnswerNarrative(input);
}

export function buildQuestionNarrativeInput(params: {
  question: string;
  answer: string;
  detectedIntent?: IntentDetectionResult;
  supportingData: Array<{ label: string; value: string | number }>;
  resultTable?: {
    columns: string[];
    rows: Record<string, PrimitiveValue>[];
  };
  chartSelectionSummary: string;
  chartSelectionExplanation: string;
  chartSelectionWarnings: string[];
  suggestedFollowUps: string[];
  recommendedCharts?: ChartConfig[];
  context?: QuestionContextInput;
  facts: AnalyticsFacts;
}): QuestionNarrativeInput {
  return params;
}

export function mapExecutiveInsightToLegacy(narrative: ExecutiveInsightNarrative) {
  const bullets = narrative.bullets.slice(0, 5);
  return {
    overview: bullets[0] ?? "No executive insight available.",
    kpiSummary: bullets[1] ?? bullets[0] ?? "No KPI insight available.",
    anomalySummary: bullets[2] ?? bullets[1] ?? bullets[0] ?? "No anomaly insight available.",
    trendSummary: bullets[3] ?? bullets[2] ?? bullets[1] ?? bullets[0] ?? "No trend insight available.",
    suggestedQuestions: narrative.suggestedQuestions,
    bullets,
    warning: narrative.warning,
    source: narrative.source
  };
}

export function applyChartNarratives(
  charts: ChartConfig[],
  narratives: ChartExplanationNarrative[]
) {
  const narrativeById = new Map(narratives.map((entry) => [entry.id, entry.explanation]));
  return charts.map((chart) => ({
    ...chart,
    description: narrativeById.get(chart.id) ?? chart.description
  }));
}
