import type { DatasetProfile, DatasetRow, KpiCandidate } from "./types.js";
import { KPI_ALIASES, parseNumber } from "../utils/inference.js";

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatKpiValue(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2
  });
}

function getBusinessKpiExplanation(kpiName: string, value: number) {
  const formattedValue = formatKpiValue(value);
  const normalized = kpiName.toLowerCase();

  if (["revenue", "sales", "income", "gmv", "conversion_value"].some((term) => normalized.includes(term))) {
    return `The selected business activity generated ${formattedValue} in revenue, showing the overall commercial value created.`;
  }

  if (normalized.includes("profit")) {
    return `The business generated ${formattedValue} in profit, showing the amount of value left after costs.`;
  }

  if (normalized.includes("roas")) {
    return `A ROAS of ${formattedValue} means advertising spend is returning about ${formattedValue} in revenue for every 1 spent, indicating strong marketing efficiency.`;
  }

  if (normalized.includes("roi")) {
    return `An ROI of ${formattedValue} shows the return generated compared with the investment made. Higher ROI means the activity is creating stronger financial value.`;
  }

  if (normalized.includes("conversion_rate") || normalized.includes("cvr")) {
    return `A conversion rate of ${formattedValue} shows how effectively traffic becomes valuable actions such as purchases, leads, or sign-ups.`;
  }

  if (normalized.includes("click")) {
    return `The campaign generated ${formattedValue} clicks, showing the level of audience interest. This should be reviewed together with conversion rate and revenue.`;
  }

  if (normalized.includes("impression")) {
    return `The campaign reached ${formattedValue} impressions, showing the scale of visibility. Strong impressions are only useful if they lead to clicks, conversions, or revenue.`;
  }

  if (normalized.includes("ctr")) {
    return `A CTR of ${formattedValue} shows how effectively impressions turned into clicks. Higher CTR usually suggests stronger message relevance or audience targeting.`;
  }

  if (normalized.includes("cpc")) {
    return `A CPC of ${formattedValue} shows the average cost paid for each click. Lower CPC can improve efficiency, but only if traffic quality remains strong.`;
  }

  if (normalized.includes("cpa")) {
    return `A CPA of ${formattedValue} shows the average cost to acquire one conversion. Lower CPA usually means more efficient customer acquisition.`;
  }

  if (normalized.includes("cost") || normalized.includes("spend")) {
    return `The business spent ${formattedValue} on this activity. This should be compared with revenue, conversions, or profit to judge efficiency.`;
  }

  if (normalized.includes("lead")) {
    return `The activity generated ${formattedValue} leads, showing potential customer demand. The next step is to check lead quality and conversion into sales.`;
  }

  if (normalized.includes("order")) {
    return `The business generated ${formattedValue} orders, showing actual purchase activity. This should be compared with revenue and average order value.`;
  }

  if (normalized.includes("customer")) {
    return `The business reached or acquired ${formattedValue} customers, showing customer growth or engagement.`;
  }

  if (normalized.includes("churn")) {
    return `A churn value of ${formattedValue} indicates customer loss or drop-off. Higher churn may signal retention risk.`;
  }

  if (normalized.includes("retention")) {
    return `A retention value of ${formattedValue} shows how well the business keeps customers over time. Higher retention usually means stronger customer loyalty.`;
  }

  if (normalized.includes("average order value") || normalized.includes("aov")) {
    return `An average order value of ${formattedValue} shows the typical value of each purchase. Increasing this can grow revenue without needing more customers.`;
  }

  return `This KPI is currently at ${formattedValue}. Review it with related business metrics to understand whether it signals growth, efficiency, or risk.`;
}

export function detectKpis(rows: DatasetRow[], profile: DatasetProfile): KpiCandidate[] {
  const numericColumns = new Set(profile.numericColumns);
  const candidates: KpiCandidate[] = [];

  for (const [kpiId, aliases] of Object.entries(KPI_ALIASES)) {
    const column = profile.numericColumns.find((name) => aliases.some((alias) => name.includes(alias)));
    if (!column) {
      continue;
    }

    const values = rows
      .map((row) => parseNumber(row[column]))
      .filter((value): value is number => value !== null);

    if (values.length === 0) {
      continue;
    }

    const aggregateValue = values.reduce((sum, value) => sum + value, 0);
    const confidence = aliases.some((alias) => column === alias) ? 0.98 : 0.88;

    candidates.push({
      id: kpiId,
      label: humanize(kpiId),
      column,
      confidence,
      summary: getBusinessKpiExplanation(kpiId, aggregateValue),
      aggregateValue: Number(aggregateValue.toFixed(2))
    });
  }

  if (candidates.length === 0) {
    for (const column of profile.columns.filter((entry) => entry.kind === "numeric").slice(0, 3)) {
      candidates.push({
        id: column.name,
        label: humanize(column.name),
        column: column.name,
        confidence: numericColumns.has(column.name) ? 0.6 : 0.45,
        summary: getBusinessKpiExplanation(column.name, Number((((column.mean ?? 0) * profile.rowCount) || 0).toFixed(2))),
        aggregateValue: Number((((column.mean ?? 0) * profile.rowCount) || 0).toFixed(2))
      });
    }
  }

  return candidates.sort((left, right) => right.confidence - left.confidence);
}
