import type {
  ChartConfig,
  DatasetProfile,
  IntentDetectionResult,
  KpiCandidate,
  PrimitiveValue,
  QuestionContextInput
} from "../analytics/types.js";
import { parseDateValue, parseNumber } from "../utils/inference.js";
import {
  buildExecutiveInsightFacts,
  executiveSignalToBullet,
  isExecutiveInsightBulletSupported
} from "./executiveInsightFacts.js";
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

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatMetricValue(metricLabel: string, value: number) {
  const normalized = normalizeName(metricLabel);
  if (normalized.includes("roas")) {
    return `${formatNumber(value)}x`;
  }
  if (normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("conversion rate") || normalized.includes("rate")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${formatNumber(percentValue)}%`;
  }
  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income") || normalized.includes("gmv") || normalized.includes("cost") || normalized.includes("spend") || normalized.includes("profit") || normalized.includes("value") || normalized.includes("amount")) {
    return `$${formatCompactNumber(value)}`;
  }
  if (normalized.includes("impression")) {
    return `${formatCompactNumber(value)} impressions`;
  }
  if (normalized.includes("click")) {
    return `${formatCompactNumber(value)} clicks`;
  }
  return `${formatCompactNumber(value)} ${humanizeLabel(metricLabel).toLowerCase()}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "";
  }

  const stopWords = new Set(["and", "or", "of", "the", "by", "to", "for", "with", "in", "on", "at", "per"]);
  const acronyms = new Set(["roas", "roi", "ctr", "cvr", "cpc", "cpa", "aov", "gmv", "ltv", "kpi"]);
  return value
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (lower === "vs") {
        return "vs";
      }
      if (acronyms.has(lower)) {
        return lower.toUpperCase();
      }
      if (index > 0 && stopWords.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function pluralizeLabel(value: string) {
  const lower = value.toLowerCase();
  if (/(s|x|z|ch|sh)$/i.test(lower)) {
    return `${value}es`;
  }
  if (/[^aeiou]y$/i.test(lower)) {
    return `${value.slice(0, -1)}ies`;
  }
  return `${value}s`;
}

function isCommercialInsightText(value: string) {
  return !/(data quality|missing cell|missing cells|duplicate row|duplicate rows|outlier|outliers|eda|profiling|dirty data|warning)/i.test(value);
}

function isLowValueExecutiveMetadataText(value: string) {
  const normalized = normalizeInsightText(value);
  return (
    /\b(dataset|data set|file|profiled)\b.*\b(rows?|columns?|fields?)\b/.test(normalized) ||
    /\b\d+\s+rows?\b/.test(normalized) ||
    /\b\d+\s+columns?\b/.test(normalized) ||
    /\b(row count|column count|number of fields|date range)\b/.test(normalized) ||
    /\bvalidate whether the strongest signals hold across\b/.test(normalized) ||
    /\binvestigate the (changing|improving|declining) .+ trend across .+ before making a broader recommendation\b/.test(normalized) ||
    /\bthe (changing|improving|declining) .+ trend across .+ should be watched before committing budget\b/.test(normalized)
  );
}

function isExecutiveInsightText(value: string) {
  return isCommercialInsightText(value) && !isLowValueExecutiveMetadataText(value);
}

type ExecutiveInsightTheme =
  | "revenue"
  | "relationship"
  | "concentration"
  | "efficiency"
  | "conversion"
  | "trend"
  | "variance"
  | "budget"
  | "scale"
  | "quality"
  | "action"
  | "strong_segment"
  | "weak_segment"
  | "general";

interface ExecutiveInsightCandidate {
  text: string;
  theme: ExecutiveInsightTheme;
}

function normalizeInsightText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9%$.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyInsightSubject(value: string) {
  const normalized = normalizeInsightText(value);
  if (/\bqualified rate\b/.test(normalized)) {
    return "qualified_rate";
  }
  if (/\bqualified\b/.test(normalized)) {
    return "qualified";
  }
  if (/\bconverted\b/.test(normalized)) {
    return "converted";
  }
  if (/\bmissed\b/.test(normalized)) {
    return "missed";
  }
  if (/\brevenue|value\b/.test(normalized)) {
    return "value";
  }
  if (/\bcalls?\b/.test(normalized)) {
    return "calls";
  }
  if (/\bstage|lifecycle|journey|pipeline\b/.test(normalized)) {
    return "pipeline";
  }
  return "";
}

function classifyInsightTheme(value: string): ExecutiveInsightTheme {
  const normalized = normalizeInsightText(value);
  if (/(relationship|versus|while)/i.test(normalized)) {
    return "relationship";
  }
  if (/(data quality|missing|duplicate|outlier|profiling)/i.test(normalized)) {
    return "quality";
  }
  if (/(weakest|underperform|worst|lagging|lowest|tail)/i.test(normalized)) {
    return "weak_segment";
  }
  if (/(strongest|best|top|leading|winner|winning)/i.test(normalized) && /(segment|channel|campaign|audience|device|ad set)/i.test(normalized)) {
    return "strong_segment";
  }
  if (/(roas|roi|efficien|cost|spend|cpa|cpc)/i.test(normalized)) {
    return "efficiency";
  }
  if (/(conversion|cvr|convert|qualified)/i.test(normalized)) {
    return "conversion";
  }
  if (/(variance|volatil|stability|stable|uneven|spread|strongest|weakest|across)/i.test(normalized)) {
    return "variance";
  }
  if (/(trend|growth|declin|increas|decreas|momentum|change)/i.test(normalized)) {
    return "trend";
  }
  if (/(budget|overspend|waste|reallocat|invest|cut)/i.test(normalized)) {
    return "budget";
  }
  if (/(scale|scalab|expand|upside|opportunity|potential)/i.test(normalized)) {
    return "scale";
  }
  if (/(top 3|concentrat|share|domin|largest)/i.test(normalized)) {
    return "concentration";
  }
  if (/(segment|channel|campaign|audience|device|ad set)/i.test(normalized)) {
    return "general";
  }
  if (/(recommend|should|next step|review|benchmark|watch)/i.test(normalized)) {
    return "action";
  }
  return "general";
}

function themeForSignalType(signalType: string): ExecutiveInsightTheme {
  if (signalType === "relationship") {
    return "relationship";
  }
  if (signalType === "trend") {
    return "trend";
  }
  if (signalType === "concentration" || signalType === "risk") {
    return "concentration";
  }
  if (signalType === "variance") {
    return "variance";
  }
  if (signalType === "efficiency") {
    return "efficiency";
  }
  if (signalType === "reliability") {
    return "quality";
  }
  return "general";
}

function addDistinctExecutiveInsight(
  bullets: string[],
  usedThemes: Map<ExecutiveInsightTheme, number>,
  candidate: ExecutiveInsightCandidate
) {
  const normalized = normalizeInsightText(candidate.text);
  const themeCount = usedThemes.get(candidate.theme) ?? 0;
  const maxPerTheme =
    candidate.theme === "relationship" ||
    candidate.theme === "conversion" ||
    candidate.theme === "variance" ||
    candidate.theme === "concentration"
      ? 2
      : 1;

  if (!candidate.text.trim() || themeCount >= maxPerTheme) {
    return;
  }

  if (bullets.some((bullet) => normalizeInsightText(bullet) === normalized)) {
    return;
  }

  const detailedScaffoldPattern = /top 3 .* (account for|contribute)/i;
  const anchorPattern = /^([^,.]+?)\s+(is|contributes|leads|drives|carries|sits)\b/i;
  const candidateAnchor = candidate.text.match(anchorPattern)?.[1]?.toLowerCase().trim();
  const candidateHasDetailedScaffold = detailedScaffoldPattern.test(candidate.text);

  if (
    candidateHasDetailedScaffold &&
    bullets.some((bullet) => detailedScaffoldPattern.test(bullet))
  ) {
    return;
  }

  if (
    candidateAnchor &&
    bullets.some((bullet) => {
      const bulletAnchor = bullet.match(anchorPattern)?.[1]?.toLowerCase().trim();
      return (
        bulletAnchor === candidateAnchor &&
        classifyInsightTheme(bullet) === candidate.theme &&
        classifyInsightSubject(bullet) === classifyInsightSubject(candidate.text)
      );
    })
  ) {
    return;
  }

  usedThemes.set(candidate.theme, themeCount + 1);
  bullets.push(candidate.text);
}

function distinctInsightBullets(candidates: ExecutiveInsightCandidate[], limit = 6) {
  const bullets: string[] = [];
  const usedThemes = new Map<ExecutiveInsightTheme, number>();

  for (const candidate of candidates) {
    if (bullets.length >= limit) {
      break;
    }
    addDistinctExecutiveInsight(bullets, usedThemes, candidate);
  }

  return bullets;
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
  return Boolean(value) && ["roas", "spend", "efficiency", "cost per", "cost_per", "cpqc", "cpa", "cpc"].some((label) => normalizeName(value ?? "").includes(label));
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

function formatObservationValue(metricLabel: string, value: number) {
  const normalized = normalizeName(metricLabel);
  if (normalized.includes("roas") || normalized.includes("roi")) {
    return `${formatCompactNumber(value)}x`;
  }
  if (normalized.includes("ctr") || normalized.includes("cvr") || normalized.includes("conversion rate") || normalized.includes("rate")) {
    const percentValue = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${formatNumber(percentValue)}%`;
  }
  return formatCompactNumber(value);
}

function estimateCorrelation(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) {
    return 0;
  }

  const meanX = points.reduce((sum, entry) => sum + entry.x, 0) / points.length;
  const meanY = points.reduce((sum, entry) => sum + entry.y, 0) / points.length;
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominatorX += (point.x - meanX) ** 2;
    denominatorY += (point.y - meanY) ** 2;
  }

  return numerator / Math.sqrt(denominatorX * denominatorY || 1);
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
  const metricLabel = humanizeLabel(chart.metric ?? chart.title) || "Metric";
  const dimensionLabel = humanizeLabel(chart.dimension ?? chart.xAxis ?? "segment") || "segment";

  if (chart.chartType === "line" || chart.chartType === "anomaly_trend") {
    if (summary.orderedEntries.length >= 2) {
      const first = summary.orderedEntries[0];
      const last = summary.orderedEntries[summary.orderedEntries.length - 1];
      const peak = summary.rankedEntries[0];
      const pieces =
        summary.trend?.direction === "mixed"
          ? [
              `${metricLabel} fluctuated across the observed period, starting at ${formatObservationValue(metricLabel, first.value)} on ${first.label} and ending at ${formatObservationValue(metricLabel, last.value)} on ${last.label}`
            ]
          : [
              `${metricLabel} ${
                summary.trend?.direction === "down"
                  ? "declined"
                  : summary.trend?.direction === "flat"
                    ? "held broadly steady"
                    : "increased"
              } from ${formatObservationValue(metricLabel, first.value)} on ${first.label} to ${formatObservationValue(metricLabel, last.value)} on ${last.label}`
            ];
      if (peak && peak.label !== first.label && peak.label !== last.label) {
        pieces.push(`with a peak at ${formatObservationValue(metricLabel, peak.value)} on ${peak.label}`);
      }
      return `${pieces.join(", ")}.`;
    }
  }

  if (chart.chartType === "scatter" || chart.chartType === "heatmap") {
    const xLabel = humanizeLabel(chart.xAxis ?? chart.xKey) || "the x metric";
    const yLabel = humanizeLabel(chart.yAxis ?? chart.yKey) || "the y metric";
    const pairs = chart.data
      .map((row) => ({
        x: parseNumber(row[chart.xKey]),
        y: parseNumber(row[chart.yKey ?? ""])
      }))
      .filter((entry): entry is { x: number; y: number } => entry.x !== null && entry.y !== null) as Array<{ x: number; y: number }>;
    const correlation = estimateCorrelation(pairs);
    if (correlation >= 0.55) {
      return `${xLabel} and ${yLabel} move together across the main cluster, with a few segments standing above the pack.`;
    }
    if (correlation <= -0.55) {
      return `${xLabel} and ${yLabel} move in opposite directions, so scale and efficiency are pulling apart.`;
    }
    return `The relationship between ${xLabel} and ${yLabel} is loose, so the main signal sits in the outliers rather than the overall cluster.`;
  }

  if (chart.chartType === "histogram" || chart.chartType === "box_plot") {
    const topBucket = summary.rankedEntries[0];
    const shareText = summary.top3Share !== undefined ? `, with the top 3 buckets holding ${formatPercent(summary.top3Share)} of the displayed values` : "";
    if (topBucket) {
      return `${metricLabel} is concentrated around ${topBucket.label}${shareText}.`;
    }
    return `${metricLabel} is spread across several ranges, so the key signal is concentration rather than a single peak.`;
  }

  if (chart.chartType === "funnel") {
    if (summary.orderedEntries.length >= 2) {
      const first = summary.rankedEntries[0];
      const last = summary.rankedEntries[summary.rankedEntries.length - 1];
      return `The funnel narrows quickly from ${first?.label ?? "the first stage"} to ${last?.label ?? "the final stage"}, so the biggest leak is early in the journey.`;
    }
    return `The funnel shows where the journey tightens, which helps isolate the biggest drop-off point.`;
  }

  if (isRevenueMetric(chart.metric)) {
    const top = summary.top;
    const topName = facts?.topRevenueSegment?.name ?? top?.label ?? "the leading segment";
    const topShare = facts?.topRevenueSegment?.share ?? top?.share;
    const efficiencyLeader = facts?.bestRoasSegment?.name;
    const dimensionLower = pluralizeLabel(dimensionLabel.toLowerCase());
    const leadText = top
      ? `${topName} leads revenue with ${formatObservationValue(metricLabel, top.value)}${
          topShare !== undefined ? `, accounting for ${formatPercent(topShare)} of total revenue` : ""
        }`
      : `${metricLabel} is concentrated in a small set of segments`;
    const alignmentText =
      efficiencyLeader && efficiencyLeader !== topName
        ? ` Efficiency is stronger in ${efficiencyLeader}, so scale and return are not aligned.`
        : summary.top3Share !== undefined
          ? ` The top 3 ${dimensionLower} contribute ${formatPercent(summary.top3Share)} of total revenue.`
          : "";
    return `${leadText}.${alignmentText}`;
  }

  if (isEfficiencyMetric(chart.metric)) {
    const top = summary.top;
    const bottom = summary.bottom;
    const lowerIsBetter = /cost per|cpc|cpa/i.test(metricLabel.toLowerCase());
    const leader = lowerIsBetter ? bottom : top;
    const laggard = lowerIsBetter ? top : bottom;
    const leaderLabel = leader?.label ?? "the leading segment";
    const leaderValue = leader ? formatObservationValue(metricLabel, leader.value) : null;
    const laggardText =
      laggard && laggard.label !== leader?.label
        ? ` ${laggard.label} sits ${lowerIsBetter ? "highest" : "lowest"}, which is where the budget pressure is highest.`
        : "";
    return leaderValue
      ? `${metricLabel} is strongest in ${leaderLabel} at ${leaderValue}, so efficiency should be judged against scale rather than volume alone.${laggardText}`
      : `${metricLabel} varies across segments, so the budget story depends on which channel or campaign leads.`;
  }

  if (isConversionMetric(chart.metric)) {
    const top = summary.top;
    const bottom = summary.bottom;
    const topLabel = top?.label ?? "the leading segment";
    const topValue = top ? formatObservationValue(metricLabel, top.value) : null;
    const bottomText = bottom && bottom.label !== top?.label ? ` ${bottom.label} converts least efficiently.` : "";
    return topValue
      ? `${metricLabel} peaks in ${topLabel} at ${topValue}, so traffic quality is uneven across segments.${bottomText}`
      : `${metricLabel} helps separate high-traffic segments from the ones that actually convert.`;
  }

  if (chart.chartType === "bar" || chart.chartType === "horizontal_bar" || chart.chartType === "stacked_bar" || chart.chartType === "donut") {
    const top = summary.top;
    const metricLower = metricLabel.toLowerCase();
    const dimensionLower = pluralizeLabel(dimensionLabel.toLowerCase());
    const topText = top
      ? `${top.label} leads ${metricLower} with ${formatObservationValue(metricLabel, top.value)}${top.share !== undefined ? `, accounting for ${formatPercent(top.share)} of total ${metricLower}` : ""}`
      : `${metricLabel} is concentrated in a small number of segments`;
    const concentrationText =
      summary.top3Share !== undefined
        ? `The top 3 ${dimensionLower} contribute ${formatPercent(summary.top3Share)} of total ${metricLower}.`
        : "";
    return concentrationText ? `${topText}. ${concentrationText}` : `${topText}.`;
  }

  return `${metricLabel} stands out across ${dimensionLabel}, so the main decision is whether to scale the leader or fix the lagging segments.`;
}

function buildFallbackAskAnalysisSummary(input: QuestionNarrativeInput) {
  const question = normalizeInsightText(input.question);
  const topRevenueSegment = input.facts.topFindings.topRevenueSegment;
  const bestRoasSegment = input.facts.topFindings.bestRoasSegment;
  const bestConversionSegment = input.facts.topFindings.bestConversionSegment;
  const strongestSegment = input.facts.segments.strongestSegment;
  const topRevenueShare = input.facts.concentration.top1RevenueShare;
  const recentDirection = input.facts.trends.recentDirection;

  if (/(concentrat|concentration|share|dominant|too much in one)/i.test(question) && topRevenueSegment) {
    return `${topRevenueSegment.name} carries ${formatPercent(topRevenueSegment.share)}, so concentration is a meaningful risk and a lever for growth.`;
  }

  if (/(more budget|receive more budget|allocate budget|budget allocation|budget to|scale|scalable)/i.test(question)) {
    if (bestRoasSegment) {
      return `${bestRoasSegment.name} looks like the strongest scale candidate, which matters because budget should go where return can absorb more spend without losing efficiency.`;
    }
    if (strongestSegment) {
      return `${strongestSegment.name} is the clearest scale candidate, which matters because budget allocation should favor the segment with the strongest commercial signal.`;
    }
    return "This is a budget allocation question, so the key is to find the segment that can absorb more spend without weakening efficiency.";
  }

  if (/(high spend|wasting budget|budget waste|burning spend|overspend|underperform|lagging|poor|weak|lowest|bottom)/i.test(question)) {
    if (bestRoasSegment) {
      return `${bestRoasSegment.name} is the clearest efficiency reference, which matters because the weak segment should be reviewed against the strongest return signal before more budget is committed.`;
    }
    if (strongestSegment) {
      return `${strongestSegment.name} is the clearest signal to review, which matters because weak performance needs attention before budget is reallocated.`;
    }
    return "This result matters because the question is pointing to a segment that needs review before additional budget is committed.";
  }

  if (/(roas|roi|efficient|efficiency|return|scale|budget|spend|high spend|weak return)/i.test(question)) {
    if (bestRoasSegment) {
      return `${bestRoasSegment.name} is the clearest efficiency leader, which matters because budget should scale where return stays strongest.`;
    }
    return "Efficiency is the right lens here because spend only creates value when return remains strong enough to justify scaling.";
  }

  if (/(convert|conversion|cvr|clicks most efficiently|funnel)/i.test(question)) {
    if (bestConversionSegment) {
      return `${bestConversionSegment.name} converts best, which matters because traffic quality is uneven and not every segment turns attention into outcomes.`;
    }
    return "Conversion efficiency matters here because traffic volume is only valuable when it turns into business outcomes.";
  }

  if (/(trend|over time|increase|drop|change|momentum|where did|anomaly|volatile)/i.test(question) && input.facts.trends.hasDateField) {
    if (recentDirection === "up") {
      return "The recent trend is improving, which matters because the current direction can support a confident scaling decision if it holds.";
    }
    if (recentDirection === "down") {
      return "The recent trend is weakening, which matters because leadership should confirm whether the decline is temporary or structural.";
    }
    if (recentDirection === "mixed") {
      return "The trend is uneven, which matters because volatility can hide whether performance is truly strengthening or just oscillating.";
    }
    return "The time pattern matters because direction over time shows whether performance is building momentum or losing it.";
  }

  if (strongestSegment) {
    return `${strongestSegment.name} is the strongest signal in this answer, which matters because it points to where leadership should focus scale or corrective action.`;
  }

  if (topRevenueShare !== undefined && topRevenueSegment) {
    return `Revenue concentration is still relevant here because ${topRevenueSegment.name} accounts for ${formatPercent(topRevenueShare)}, which affects how scalable the result really is.`;
  }

  return "This result matters because it identifies the strongest commercial signal in the current dataset and points to the next decision to investigate.";
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
  kpiCards?: AnalyticsFacts["kpiCards"];
  charts: ChartConfig[];
  dataSummaryNotes?: string[];
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
      analysisRole: chart.analysisRole,
      semanticSignature: chart.semanticSignature,
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
      warnings,
      dataSummaryNotes: params.dataSummaryNotes
    },
    kpis: buildCoreKpiFacts(params.kpis),
    kpiCards: params.kpiCards ?? [],
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
    semanticContract: params.profile.semanticContract,
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
      analysisRole: chart.analysisRole,
      businessArea: chart.businessArea,
      semanticSignature: chart.semanticSignature,
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
  const executiveFacts = buildExecutiveInsightFacts(facts);
  const candidates = executiveFacts.signals.map((signal) => ({
    text: executiveSignalToBullet(signal),
    theme: themeForSignalType(signal.type)
  }));
  const bullets = distinctInsightBullets(
    candidates.filter((candidate) => isExecutiveInsightText(candidate.text)),
    5
  );

  return {
    bullets,
    suggestedQuestions: [],
    warning: undefined,
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
    !parsed.bullets.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return {
    bullets: parsed.bullets.slice(0, 6),
    suggestedQuestions:
      Array.isArray(parsed.suggestedQuestions) && parsed.suggestedQuestions.every((entry) => typeof entry === "string")
        ? parsed.suggestedQuestions.slice(0, 5)
        : [],
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
    confidenceNote?: unknown;
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
    confidenceNote: typeof parsed.confidenceNote === "string" && parsed.confidenceNote.trim() ? parsed.confidenceNote : undefined,
    warning: typeof parsed.warning === "string" && parsed.warning.trim() ? parsed.warning : undefined,
    source: "llm"
  };
}

function isReadableAskDirectAnswer(value: string) {
  const text = value.trim();
  if (!text) {
    return false;
  }

  if (text.length > 220) {
    return false;
  }

  const metricMentions = text.match(/\b(revenue|roas|roi|conversion rate|conversion_rate|ctr|cvr|clicks|impressions|spend|cost|profit|cpa|cpc)\b/gi)?.length ?? 0;
  if (metricMentions > 4) {
    return false;
  }

  if ((text.match(/,/g) ?? []).length > 2) {
    return false;
  }

  if (/\b\w+_\w+\b/.test(text)) {
    return false;
  }

  return true;
}

export function buildFallbackChartExplanations(
  facts: AnalyticsFacts,
  charts: ChartConfig[]
): ChartExplanationNarrative[] {
  return charts.map((chart) => {
    const summary = buildChartSummary(chart);
    const observation = summary ? buildChartObservation(chart, summary, { topRevenueSegment: facts.topFindings.topRevenueSegment, bestRoasSegment: facts.topFindings.bestRoasSegment }) : "";
    const metricLabel = humanizeLabel(chart.metric ?? chart.title) || "This metric";

    return {
      id: chart.id,
      explanation: observation
        ? observation
        : `${metricLabel} should be read as a decision signal, so the main task is to understand what is driving the shape of the chart.`
    };
  });
}

export function buildFallbackAskAnswerNarrative(input: QuestionNarrativeInput): AskAnswerNarrative {
  if (input.trustedQuestionFacts && (
    input.trustedQuestionFacts.routing.mode === "trust" ||
    input.trustedQuestionFacts.answerability.status !== "answerable"
  )) {
    const trustedFacts = input.trustedQuestionFacts;
    const evidence = trustedFacts.answerability.reasons.length > 0
      ? trustedFacts.answerability.reasons.map((reason, index) => `${index === 0 ? "reason" : `reason ${index + 1}`}: ${reason}`)
      : trustedFacts.answer.supportingData.map((entry) => `${entry.label}: ${String(entry.value)}`);

    return {
      directAnswer: trustedFacts.answer.directAnswer,
      evidence: evidence.length > 0 ? evidence : ["No supporting aggregates were available."],
      caution: trustedFacts.answerability.caution,
      suggestedNextQuestion: input.suggestedFollowUps[0],
      analysisSummary: buildFallbackAskAnalysisSummary(input),
      chartSelectionSummary: input.chartSelectionSummary,
      confidenceNote:
        trustedFacts.routing.mode === "trust"
          ? "Confidence is intentionally conservative because this answer is explaining trust limits rather than ranking performance."
          : trustedFacts.answerability.status === "unsupported"
          ? "Confidence is limited because the requested metric is not supported by the current dataset."
          : "Confidence is limited because the current answer relies on a weak fallback rather than a strong deterministic signal.",
      warning: undefined,
      source: "fallback"
    };
  }

  const summaryMatch = input.answer.match(/^(.+?) totals ([\d.]+) with an average of ([\d.]+) across (\d+) populated records\.$/i);
  const topRevenueSegment = input.facts.topFindings.topRevenueSegment;
  const bestRoasSegment = input.facts.topFindings.bestRoasSegment;
  const rewrittenDirectAnswer = (() => {
    if (!summaryMatch) {
      if (/could not identify a numeric metric|ai explanation unavailable/i.test(input.answer)) {
        if (input.semanticProfile && input.semanticProfile.businessIntent !== "neutral") {
          const preferredSegment =
            input.semanticProfile.businessIntent === "underperforming" ||
            input.semanticProfile.businessIntent === "wasting_budget"
              ? input.facts.topFindings.weakestSegment?.name
              : input.facts.topFindings.topRevenueSegment?.name ??
                input.facts.topFindings.bestRoasSegment?.name ??
                input.facts.topFindings.bestConversionSegment?.name ??
                input.supportingData[0]?.label;

          if (preferredSegment) {
            return `${preferredSegment} is the clearest match for ${input.semanticProfile.summary}, based on the supporting metrics in the current dataset.`;
          }
        }

        return "The current dataset does not expose a single clear metric, so the safest answer is to ask for a specific metric and segment.";
      }

      return input.answer;
    }

    const metricLabel = humanizeLabel(summaryMatch[1]) || "This metric";
    const total = Number(summaryMatch[2]);
    const average = Number(summaryMatch[3]);
    const recordCount = Number(summaryMatch[4]);

    if (topRevenueSegment && normalizeName(metricLabel).includes("revenue")) {
      return `${topRevenueSegment.name} is the strongest ${topRevenueSegment.dimension} for ${metricLabel.toLowerCase()}, and the current selection totals ${formatMetricValue(metricLabel, total)}.`;
    }

    if (bestRoasSegment && isEfficiencyMetric(metricLabel)) {
      return `${bestRoasSegment.name} is the strongest ${bestRoasSegment.dimension} on efficiency, and the current selection sits at ${formatMetricValue(metricLabel, total)} overall.`;
    }

    return `${metricLabel} totals ${formatMetricValue(metricLabel, total)} across the current selection, with an average of ${formatMetricValue(metricLabel, average)} across ${recordCount} matching records.`;
  })();
  const evidence = input.supportingData.map((entry) => `${entry.label}: ${String(entry.value)}`);
  const confidenceNote =
    input.semanticProfile && input.semanticProfile.businessIntent !== "neutral"
      ? `Confidence is ${input.semanticProfile.confidence >= 0.75 ? "high" : input.semanticProfile.confidence >= 0.55 ? "medium" : "lower"} because the question matches ${input.semanticProfile.summary}.`
      : input.supportingData.length > 0
        ? `Confidence is medium because the answer is based on ${input.supportingData.length} supporting metric signal${input.supportingData.length === 1 ? "" : "s"}.`
        : undefined;
  return {
    directAnswer: rewrittenDirectAnswer,
    evidence: evidence.length > 0 ? evidence : ["No supporting aggregates were available."],
    caution: input.chartSelectionWarnings.length > 0 ? input.chartSelectionWarnings.join(" ") : undefined,
    suggestedNextQuestion: input.suggestedFollowUps[0],
    analysisSummary: buildFallbackAskAnalysisSummary(input),
    chartSelectionSummary: input.chartSelectionSummary,
    confidenceNote,
    warning: undefined,
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
  const executiveFacts = buildExecutiveInsightFacts(facts);
  const provider = createConfiguredLlmProvider();
  if (provider.name !== "disabled") {
    try {
      const result = await provider.generateText(buildExecutiveInsightPrompt(executiveFacts));
      const parsed = parseExecutiveInsightNarrative(result.text);
      if (parsed) {
        const fallback = buildFallbackExecutiveInsightNarrative(facts);
        const parsedCandidates = parsed.bullets
          .filter(isExecutiveInsightText)
          .filter((text) => isExecutiveInsightBulletSupported(text, executiveFacts))
          .map((text) => ({
            text,
            theme: classifyInsightTheme(text)
          }));
        const fallbackCandidates = fallback.bullets.map((text) => ({
          text,
          theme: classifyInsightTheme(text)
        }));
        const mergedBullets = distinctInsightBullets([...parsedCandidates, ...fallbackCandidates], 5);

        return {
          bullets: mergedBullets,
          suggestedQuestions: [],
          warning: undefined,
          source: "llm"
        };
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
      if (parsed && isReadableAskDirectAnswer(parsed.directAnswer)) {
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
  trustedQuestionFacts?: QuestionNarrativeInput["trustedQuestionFacts"];
  detectedIntent?: IntentDetectionResult;
  semanticProfile?: QuestionNarrativeInput["semanticProfile"];
  semanticContract?: QuestionNarrativeInput["semanticContract"];
  conversationHistory?: QuestionNarrativeInput["conversationHistory"];
  supportingData: Array<{ label: string; value: string | number }>;
  resultTable?: {
    columns: string[];
    rows: Record<string, PrimitiveValue>[];
  };
  datasetSchema: QuestionNarrativeInput["datasetSchema"];
  sampleRows: QuestionNarrativeInput["sampleRows"];
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
  const bullets = narrative.bullets.slice(0, 6);
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
