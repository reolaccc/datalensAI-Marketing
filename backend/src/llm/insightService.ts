import type {
  ChartConfig,
  DatasetProfile,
  IntentDetectionResult,
  KpiCandidate,
  PrimitiveValue,
  QuestionContextInput
} from "../analytics/types.js";
import { parseDateValue, parseNumber } from "../utils/inference.js";
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

interface ChartSummaryEntry {
  label: string;
  value: number;
}

interface ChartSummary {
  orderedEntries: ChartSummaryEntry[];
  rankedEntries: ChartSummaryEntry[];
  total: number;
  average: number;
  top?: ChartSummaryEntry & { share?: number };
  bottom?: ChartSummaryEntry;
  top3Share?: number;
  trend?: {
    direction: "up" | "down" | "flat" | "mixed";
    absoluteChange: number;
    percentChange?: number;
    periodLabel: string;
  };
}

function isRevenueMetric(value?: string | null) {
  return Boolean(value) && ["revenue", "sales", "income", "gmv", "conversion value"].some((label) => normalizeName(value ?? "").includes(label));
}

function isEfficiencyMetric(value?: string | null) {
  return Boolean(value) && ["roas", "roi", "conversion rate", "cvr", "efficiency"].some((label) => normalizeName(value ?? "").includes(label));
}

function isConversionMetric(value?: string | null) {
  return Boolean(value) && ["conversion rate", "cvr", "conversion_rate"].some((label) => normalizeName(value ?? "").includes(label));
}

function getChartLabel(chart: ChartConfig, row: Record<string, PrimitiveValue>) {
  const preferredKeys = [chart.dimension, chart.xKey, chart.yKey, "date", "bucket"].filter(
    (key): key is string => Boolean(key)
  );
  for (const key of preferredKeys) {
    const rawValue = row[key];
    if (rawValue !== null && rawValue !== undefined && String(rawValue).trim()) {
      return String(rawValue);
    }
  }
  return "";
}

function getChartValue(chart: ChartConfig, row: Record<string, PrimitiveValue>) {
  const preferredKeys = [chart.metric, chart.yKey].filter((key): key is string => Boolean(key));
  for (const key of preferredKeys) {
    const value = parseNumber(row[key]);
    if (value !== null) {
      return value;
    }
  }

  const excludedKeys = new Set([chart.dimension ?? "", chart.xKey ?? "", chart.yKey ?? "", "date", "bucket"].filter(Boolean));
  const numericValues = Object.entries(row)
    .filter(([key]) => !excludedKeys.has(key))
    .map(([, value]) => parseNumber(value))
    .filter((value): value is number => value !== null);

  if (numericValues.length === 0) {
    return null;
  }

  return Number(numericValues.reduce((sum, value) => sum + value, 0).toFixed(2));
}

function buildChartSummary(chart: ChartConfig): ChartSummary | null {
  const orderedEntries = chart.data
    .map((row) => {
      const label = getChartLabel(chart, row);
      const value = getChartValue(chart, row);
      return label && value !== null ? { label, value } : null;
    })
    .filter((entry): entry is ChartSummaryEntry => entry !== null);

  if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
    orderedEntries.sort((left, right) => {
      const leftDate = parseDateValue(left.label);
      const rightDate = parseDateValue(right.label);
      if (leftDate && rightDate) {
        return leftDate.getTime() - rightDate.getTime();
      }
      return left.label.localeCompare(right.label);
    });
  }

  if (orderedEntries.length === 0) {
    return null;
  }

  const rankedEntries = [...orderedEntries].sort((left, right) => right.value - left.value);
  const total = rankedEntries.reduce((sum, entry) => sum + entry.value, 0);
  const average = total / rankedEntries.length;
  const top = rankedEntries[0];
  const bottom = rankedEntries[rankedEntries.length - 1];
  const top3Share =
    total > 0
      ? Number((rankedEntries.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / total).toFixed(3))
      : undefined;

  const trend = chart.chartType === "line" || chart.chartType === "anomaly_trend" ? (() => {
    if (orderedEntries.length < 2) {
      return undefined;
    }

    const first = orderedEntries[0];
    const last = orderedEntries[orderedEntries.length - 1];
    const deltas = orderedEntries.slice(1).map((entry, index) => entry.value - orderedEntries[index].value);
    const allPositive = deltas.every((delta) => delta > 0);
    const allNegative = deltas.every((delta) => delta < 0);
    const flat = deltas.every((delta) => delta === 0);
    const direction: "up" | "down" | "flat" | "mixed" = flat ? "flat" : allPositive ? "up" : allNegative ? "down" : "mixed";
    const absoluteChange = Number((last.value - first.value).toFixed(2));
    const percentChange = first.value !== 0 ? Number((((last.value - first.value) / first.value) * 100).toFixed(1)) : undefined;

    return {
      direction,
      absoluteChange,
      percentChange,
      periodLabel: `${first.label} to ${last.label}`
    };
  })() : undefined;

  return {
    orderedEntries,
    rankedEntries,
    total,
    average,
    top:
      top && total > 0
        ? {
            ...top,
            share: Number((top.value / total).toFixed(3))
          }
        : top,
    bottom,
    top3Share,
    trend
  };
}

function pickChartSummary(charts: ChartConfig[], labels: string[], options?: { preferUngrouped?: boolean }) {
  const wanted = labels.map(normalizeName);
  const matches = charts.filter((chart) => wanted.some((label) => normalizeName(chart.metric ?? chart.title).includes(label)));
  if (matches.length === 0) {
    return null;
  }

  if (options?.preferUngrouped) {
    return matches.find((chart) => !chart.groupBy) ?? matches[0];
  }

  return matches[0];
}

function buildChartObservation(
  chart: ChartConfig,
  summary: ChartSummary,
  facts?: { topRevenueSegment?: { name: string; share: number }; bestRoasSegment?: { name: string } }
) {
  const metricLabel = chart.metric ?? chart.title;
  const dimensionLabel = chart.dimension ?? chart.xAxis ?? "segment";

  if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
    if (summary.trend) {
      const change = summary.trend.percentChange !== undefined ? ` (${summary.trend.percentChange >= 0 ? "+" : ""}${summary.trend.percentChange}%)` : "";
      return `${metricLabel} moved ${summary.trend.direction} across ${summary.trend.periodLabel}${change}.`;
    }
  }

  if (isRevenueMetric(chart.metric)) {
    const shareText = summary.top?.share !== undefined ? `, contributing ${formatPercent(summary.top.share)} of the displayed total` : "";
    const concentrationText = summary.top3Share !== undefined ? ` The top 3 segments account for ${formatPercent(summary.top3Share)} of the displayed total.` : "";
    const tradeoffText =
      facts?.topRevenueSegment && facts?.bestRoasSegment && facts.topRevenueSegment.name !== facts.bestRoasSegment.name
        ? ` Revenue and efficiency point in different directions, so ${facts.topRevenueSegment.name} should be judged against ${facts.bestRoasSegment.name}.`
        : "";
    return `${summary.top?.label ?? "The leading segment"} leads ${metricLabel} by ${dimensionLabel}${shareText}.${concentrationText}${tradeoffText}`;
  }

  if (isEfficiencyMetric(chart.metric)) {
    const averageText = summary.average ? `, above the average of ${formatNumber(summary.average)}` : "";
    return `${summary.top?.label ?? "The leading segment"} has the strongest ${metricLabel}${averageText}, so efficiency should be weighed against scale.`;
  }

  if (isConversionMetric(chart.metric)) {
    return `${summary.top?.label ?? "The leading segment"} has the strongest ${metricLabel}, which should be checked against revenue before changing budget.`;
  }

  if ((chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "stacked_bar") && summary.top3Share !== undefined) {
    return `The top 3 ${dimensionLabel} segments account for ${formatPercent(summary.top3Share)} of the displayed ${metricLabel}, so the result is concentrated.`;
  }

  return `This chart compares ${metricLabel} by ${dimensionLabel} to answer which segment is driving the result.`;
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

export function buildAnalyticsFactsFromAnalysis(params: {
  fileName: string;
  profile: DatasetProfile;
  kpis: KpiCandidate[];
  charts: ChartConfig[];
}): AnalyticsFacts {
  const warnings = buildWarnings(params.profile, params.kpis);
  const chartSummaries = new Map(
    params.charts
      .map((chart) => [chart.id, buildChartSummary(chart)] as const)
      .filter((entry): entry is readonly [string, ChartSummary] => entry[1] !== null)
  );

  const revenueChart = pickChartSummary(params.charts, ["revenue", "sales", "income", "gmv", "conversion value"]);
  const roasChart = pickChartSummary(params.charts, ["roas", "return on ad spend", "roi"], { preferUngrouped: true });
  const conversionChart = pickChartSummary(params.charts, ["conversion rate", "cvr", "conversion_rate"], { preferUngrouped: true });

  const revenueSummary = revenueChart ? chartSummaries.get(revenueChart.id) : undefined;
  const roasSummary = roasChart ? chartSummaries.get(roasChart.id) : undefined;
  const conversionSummary = conversionChart ? chartSummaries.get(conversionChart.id) : undefined;

  const topRevenueSegment =
    revenueChart && revenueSummary?.top && revenueChart.dimension
      ? {
          dimension: revenueChart.dimension,
          name: revenueSummary.top.label,
          revenue: Number(revenueSummary.top.value.toFixed(2)),
          share: Number((revenueSummary.top.share ?? 0).toFixed(3))
        }
      : undefined;

  const bestRoasSegment =
    roasChart && roasSummary?.top && roasChart.dimension
      ? {
          dimension: roasChart.dimension,
          name: roasSummary.top.label,
          roas: Number(roasSummary.top.value.toFixed(2))
        }
      : undefined;

  const bestConversionSegment =
    conversionChart && conversionSummary?.top && conversionChart.dimension
      ? {
          dimension: conversionChart.dimension,
          name: conversionSummary.top.label,
          conversionRate: Number(conversionSummary.top.value.toFixed(2))
        }
      : undefined;

  const weakestRevenueSegment =
    revenueChart && revenueSummary?.bottom && revenueChart.dimension
      ? {
          dimension: revenueChart.dimension,
          name: revenueSummary.bottom.label,
          revenue: Number(revenueSummary.bottom.value.toFixed(2))
        }
      : undefined;

  const weakestRoasSegment =
    roasChart && roasSummary?.bottom && roasChart.dimension
      ? {
          dimension: roasChart.dimension,
          name: roasSummary.bottom.label,
          roas: Number(roasSummary.bottom.value.toFixed(2))
        }
      : undefined;

  const concentration = {
    top1RevenueShare: revenueSummary?.top?.share,
    top3RevenueShare: revenueSummary?.top3Share,
    top1RevenueEntity: topRevenueSegment,
    top3RevenueEntities:
      revenueChart && revenueSummary
        ? revenueSummary.rankedEntries.slice(0, 3).map((entry) => ({
            dimension: revenueChart.dimension ?? "segment",
            name: entry.label,
            revenue: Number(entry.value.toFixed(2)),
            share: revenueSummary.total > 0 ? Number((entry.value / revenueSummary.total).toFixed(3)) : 0
          }))
        : undefined
  };

  const rankings = {
    topRevenueEntities:
      revenueChart && revenueSummary
        ? revenueSummary.rankedEntries.slice(0, 5).map((entry) => ({
            dimension: revenueChart.dimension ?? "segment",
            name: entry.label,
            revenue: Number(entry.value.toFixed(2)),
            share: revenueSummary.total > 0 ? Number((entry.value / revenueSummary.total).toFixed(3)) : undefined
          }))
        : [],
    topRoasEntities:
      roasChart && roasSummary
        ? roasSummary.rankedEntries.slice(0, 5).map((entry) => ({
            dimension: roasChart.dimension ?? "segment",
            name: entry.label,
            roas: Number(entry.value.toFixed(2)),
            deltaFromAverage: Number((entry.value - roasSummary.average).toFixed(2))
          }))
        : [],
    topConversionEntities:
      conversionChart && conversionSummary
        ? conversionSummary.rankedEntries.slice(0, 5).map((entry) => ({
            dimension: conversionChart.dimension ?? "segment",
            name: entry.label,
            conversionRate: Number(entry.value.toFixed(2))
          }))
        : [],
    bottomRevenueEntities:
      revenueChart && revenueSummary
        ? revenueSummary.rankedEntries.slice(-3).reverse().map((entry) => ({
            dimension: revenueChart.dimension ?? "segment",
            name: entry.label,
            revenue: Number(entry.value.toFixed(2)),
            share: revenueSummary.total > 0 ? Number((entry.value / revenueSummary.total).toFixed(3)) : undefined
          }))
        : [],
    bottomRoasEntities:
      roasChart && roasSummary
        ? roasSummary.rankedEntries.slice(-3).reverse().map((entry) => ({
            dimension: roasChart.dimension ?? "segment",
            name: entry.label,
            roas: Number(entry.value.toFixed(2))
          }))
        : []
  };

  const comparisons = {
    revenueVsEfficiencyMismatches:
      revenueSummary && roasSummary && topRevenueSegment && bestRoasSegment && topRevenueSegment.name !== bestRoasSegment.name
        ? [
            {
              highRevenueName: topRevenueSegment.name,
              highRevenueValue: topRevenueSegment.revenue,
              highRevenueShare: topRevenueSegment.share,
              lowerEfficiencyName: bestRoasSegment.name,
              lowerEfficiencyValue: bestRoasSegment.roas,
              note: `${topRevenueSegment.name} leads revenue, but ${bestRoasSegment.name} leads ROAS, so scale and efficiency are pointing in different directions.`
            }
          ]
        : [],
    benchmarkComparison: [
      ...((revenueSummary && revenueChart
        ? revenueSummary.rankedEntries.slice(0, 3).map((entry) => ({
            dimension: revenueChart.dimension ?? "segment",
            name: entry.label,
            revenue: Number(entry.value.toFixed(2)),
            vsAverage:
              revenueSummary.average > 0
                ? `${entry.value >= revenueSummary.average ? "above" : "below"} the average revenue by ${formatPercent(Math.abs((entry.value - revenueSummary.average) / revenueSummary.average))}`
                : undefined
          }))
        : []) as Array<{
          dimension: string;
          name: string;
          revenue?: number;
          roas?: number;
          conversionRate?: number;
          vsAverage?: string;
        }>),
      ...((roasSummary && roasChart
        ? roasSummary.rankedEntries.slice(0, 3).map((entry) => ({
            dimension: roasChart.dimension ?? "segment",
            name: entry.label,
            roas: Number(entry.value.toFixed(2)),
            vsAverage:
              roasSummary.average > 0
                ? `${entry.value >= roasSummary.average ? "above" : "below"} the average ROAS by ${formatPercent(Math.abs((entry.value - roasSummary.average) / roasSummary.average))}`
                : undefined
          }))
        : []) as Array<{
          dimension: string;
          name: string;
          revenue?: number;
          roas?: number;
          conversionRate?: number;
          vsAverage?: string;
        }>)
    ]
  };

  const trends: AnalyticsFacts["trends"] =
    params.profile.datetimeColumns.length > 0
      ? (() => {
          const trendChart = params.charts.find(
            (chart) => (chart.chartType === "line" || chart.chartType === "anomaly_trend") && chartSummaries.get(chart.id)?.trend
          );
          const summary = trendChart ? chartSummaries.get(trendChart.id) : undefined;
          return {
            hasDateField: true,
            recentDirection: summary?.trend?.direction,
            recentChange: summary?.trend
              ? {
                  metric: trendChart?.metric ?? trendChart?.title ?? "metric",
                  absoluteChange: summary.trend.absoluteChange,
                  percentChange: summary.trend.percentChange,
                  periodLabel: summary.trend.periodLabel
                }
              : undefined
          };
        })()
      : {
          hasDateField: false
        };

  const qualitySignals = {
    hasMissingData: params.profile.missingCells > 0,
    hasDuplicates: params.profile.duplicateRowCount > 0,
    otherWarnings: warnings
  };

  const strongestSegment = topRevenueSegment
    ? {
        dimension: topRevenueSegment.dimension,
        name: topRevenueSegment.name,
        metric: "revenue",
        value: topRevenueSegment.revenue
      }
    : bestRoasSegment
      ? {
          dimension: bestRoasSegment.dimension,
          name: bestRoasSegment.name,
          metric: "roas",
          value: bestRoasSegment.roas
        }
      : undefined;

  const weakestSegment = weakestRevenueSegment
    ? {
        dimension: weakestRevenueSegment.dimension,
        name: weakestRevenueSegment.name,
        metric: "revenue",
        value: weakestRevenueSegment.revenue
      }
    : weakestRoasSegment
      ? {
          dimension: weakestRoasSegment.dimension,
          name: weakestRoasSegment.name,
          metric: "roas",
          value: weakestRoasSegment.roas
        }
      : undefined;

  const segmentSpread =
    revenueSummary && revenueSummary.top && revenueSummary.bottom
      ? {
          metric: revenueChart?.metric ?? "revenue",
          maxValue: Number(revenueSummary.top.value.toFixed(2)),
          minValue: Number(revenueSummary.bottom.value.toFixed(2)),
          ratio:
            revenueSummary.bottom.value > 0
              ? Number((revenueSummary.top.value / revenueSummary.bottom.value).toFixed(2))
              : undefined
        }
      : undefined;

  const recommendedActions: string[] = [];
  if (qualitySignals.hasMissingData || qualitySignals.hasDuplicates || params.profile.outliers.length > 0) {
    recommendedActions.push("Fix the highlighted data quality issues before scaling decisions, because missing cells, duplicates, or outliers can distort the ranking.");
  }
  if (topRevenueSegment && bestRoasSegment && topRevenueSegment.name !== bestRoasSegment.name) {
    recommendedActions.push(`Treat ${topRevenueSegment.name} as the scale leader and ${bestRoasSegment.name} as the efficiency leader before adjusting budget.`);
  }
  if (concentration.top1RevenueShare !== undefined && concentration.top1RevenueShare > 0.5 && topRevenueSegment) {
    recommendedActions.push(`Stress-test whether the ${topRevenueSegment.name} concentration is sustainable before leaning too heavily on one segment.`);
  }
  if (weakestSegment) {
    recommendedActions.push(`Review ${weakestSegment.name} to decide whether it needs cleanup, budget reduction, or a different campaign message.`);
  }
  if (trends.recentChange) {
    const direction = trends.recentDirection === "down" ? "declining" : trends.recentDirection === "up" ? "improving" : "changing";
    recommendedActions.push(`Investigate the ${direction} ${trends.recentChange.metric} trend across ${trends.recentChange.periodLabel} before making a broader recommendation.`);
  }

  const chartContext = params.charts.map((chart) => {
    const summary = chartSummaries.get(chart.id);
    return {
      title: chart.title,
      chartType: chart.chartType,
      metric: chart.metric ?? "",
      dimension: chart.dimension,
      reasonCode: chart.reason,
      keyObservation: summary ? buildChartObservation(chart, summary, { topRevenueSegment, bestRoasSegment }) : undefined
    };
  });

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
    concentration,
    rankings,
    comparisons,
    segments: {
      strongestSegment,
      weakestSegment,
      segmentSpread
    },
    trends,
    qualitySignals,
    topFindings: {
      topRevenueSegment,
      bestRoasSegment,
      bestConversionSegment,
      weakestSegment: weakestSegment
        ? {
            dimension: weakestSegment.dimension,
            name: weakestSegment.name,
            reason: `lowest ${weakestSegment.metric} among the displayed segments`,
            metric: weakestSegment.metric,
            value: weakestSegment.value
          }
        : undefined
    },
    chartContext,
    charts: params.charts.map((chart) => ({
      id: chart.id,
      title: chart.title,
      chartType: chart.chartType,
      intent: chart.intent,
      metric: chart.metric,
      dimension: chart.dimension,
      reasonCode: chart.reason,
      reason: chart.reason,
      dataPreview: chart.data.slice(0, 3),
      keyObservation: chartSummaries.get(chart.id) ? buildChartObservation(chart, chartSummaries.get(chart.id)!, { topRevenueSegment, bestRoasSegment }) : undefined
    })),
    profile: {
      numericColumns: params.profile.numericColumns,
      categoricalColumns: params.profile.categoricalColumns,
      datetimeColumns: params.profile.datetimeColumns,
      outliers: params.profile.outliers.slice(0, 5),
      correlations: params.profile.correlations.slice(0, 5)
    },
    recommendedActions: recommendedActions.slice(0, 5)
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
  if (facts.comparisons.revenueVsEfficiencyMismatches.length > 0) {
    bullets.push(facts.comparisons.revenueVsEfficiencyMismatches[0].note);
  } else if (facts.concentration.top3RevenueShare !== undefined) {
    bullets.push(
      `The top 3 segments contribute ${formatPercent(facts.concentration.top3RevenueShare)}, which suggests the result is concentrated rather than evenly spread.`
    );
  }
  if (facts.kpis.overallRoas !== undefined || facts.kpis.totalRevenue !== undefined || facts.kpis.totalCost !== undefined) {
    bullets.push(
      `Revenue ${facts.kpis.totalRevenue !== undefined ? `totals ${formatNumber(facts.kpis.totalRevenue)}` : "is available"}, while ${facts.kpis.totalCost !== undefined ? `cost totals ${formatNumber(facts.kpis.totalCost)}` : "cost is not fully available"}, so budget decisions should stay tied to efficiency.`
    );
  }
  if (facts.qualitySignals.otherWarnings.length > 0) {
    bullets.push(`Data quality needs a quick check: ${facts.qualitySignals.otherWarnings.slice(0, 2).join(" ")}`);
  }
  if (facts.recommendedActions.length > 0) {
    bullets.push(facts.recommendedActions[0]);
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
      facts.concentration.top3RevenueShare !== undefined
        ? `Why do the top 3 segments contribute ${formatPercent(facts.concentration.top3RevenueShare)} of revenue?`
        : "Where is performance concentrated across the strongest segments?",
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
