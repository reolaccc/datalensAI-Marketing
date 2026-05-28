import fs from "node:fs";
import path from "node:path";

const outputDir = path.resolve("datasets/blind-qa");
const csvPath = path.join(outputDir, "kpi_semantic_consistency_blind.csv");
const notesPath = path.join(outputDir, "kpi_semantic_consistency_blind_expected.md");

let seed = 20260528;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

function pick(items) {
  return items[Math.floor(rand() * items.length)];
}

function weighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = rand() * total;
  for (const item of items) {
    target -= item.weight;
    if (target <= 0) return item.value;
  }
  return items.at(-1).value;
}

function money(value) {
  return Number(value.toFixed(2));
}

function maybeNull(value, probability) {
  return rand() < probability ? "" : value;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const channels = [
  { value: "Paid Search", weight: 26 },
  { value: "Paid Social", weight: 20 },
  { value: "Organic Search", weight: 16 },
  { value: "Email", weight: 12 },
  { value: "Referral", weight: 10 },
  { value: "Direct", weight: 9 },
  { value: "Display", weight: 7 }
];

const mediumByChannel = {
  "Paid Search": "cpc",
  "Paid Social": "cpc",
  "Organic Search": "organic",
  Email: "email",
  Referral: "referral",
  Direct: "direct",
  Display: "display"
};

const campaignByChannel = {
  "Paid Search": ["Brand Protect AU", "Emergency Lead Capture", "High Intent Search"],
  "Paid Social": ["Meta Lead Gen NSW", "Lookalike Call Trial", "Retargeting Social"],
  "Organic Search": ["SEO Local Pages", "Content Hub", "Organic Maps"],
  Email: ["Nurture Reactivation", "Quote Follow Up", "Newsletter Promo"],
  Referral: ["Partner Network", "Affiliate Warm Leads", "Broker Referral"],
  Direct: ["Direct / Unknown", "Returning Visitors", "Phone Number Recall"],
  Display: ["Display Awareness", "Programmatic Retargeting", "YouTube Display"]
};

const regions = ["NSW", "VIC", "QLD", "WA", "SA", "TAS"];
const devices = ["Mobile", "Desktop", "Tablet"];
const callStatuses = ["answered", "missed", "voicemail", "abandoned"];
const leadStatuses = ["new", "qualified", "disqualified", "opportunity", "closed_won", "closed_lost"];
const outcomeStatuses = ["pending", "booked", "won", "lost", "no_answer"];

const rows = [];
const start = Date.UTC(2025, 11, 15);
const dayMs = 24 * 60 * 60 * 1000;
const rowCount = 520;

for (let i = 0; i < rowCount; i += 1) {
  const channel = weighted(channels);
  const medium = mediumByChannel[channel];
  const campaign = pick(campaignByChannel[channel]);
  const date = new Date(start + Math.floor(rand() * 108) * dayMs);
  const dateText = date.toISOString().slice(0, 10);
  const createdAt = `${dateText}T${String(8 + Math.floor(rand() * 10)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00`;
  const month = dateText.slice(0, 7);

  let callCount = Math.floor(rand() * 4);
  let leadCount = Math.floor(rand() * 5);
  if (["Paid Search", "Paid Social", "Display"].includes(channel)) {
    callCount += Math.floor(rand() * 4);
    leadCount += Math.floor(rand() * 3);
  }
  if (["Organic Search", "Email", "Referral"].includes(channel)) {
    leadCount += Math.floor(rand() * 4);
  }
  if (channel === "Direct") {
    callCount += Math.floor(rand() * 3);
  }
  if (i % 47 === 0) callCount = 0;
  if (i % 59 === 0) leadCount = 0;

  let qualifiedCalls = callCount > 0 ? Math.floor(callCount * (0.18 + rand() * 0.55)) : 0;
  let qualifiedLeads = leadCount > 0 ? Math.floor(leadCount * (0.22 + rand() * 0.52)) : 0;
  if (i % 83 === 0 && callCount > 0) qualifiedCalls = callCount + 1 + Math.floor(rand() * 2);
  if (i % 97 === 0 && leadCount > 0) qualifiedLeads = leadCount + 1 + Math.floor(rand() * 2);

  const isSalesQualified = qualifiedCalls > 0 || qualifiedLeads > 0 || rand() < 0.18 ? 1 : 0;
  const opportunities = Math.min(leadCount + 1, Math.floor(qualifiedLeads * (0.35 + rand() * 0.42)) + (rand() < 0.08 ? 1 : 0));
  const closedWonCount = Math.min(opportunities, Math.floor(opportunities * (0.18 + rand() * 0.45)));
  const bookedJobs = Math.min(callCount + closedWonCount, closedWonCount + (rand() < 0.18 ? 1 : 0));
  const convertedFlag = closedWonCount > 0 || bookedJobs > 0 ? 1 : 0;

  const isPaid = ["Paid Search", "Paid Social", "Display"].includes(channel);
  const spendBase = isPaid ? callCount * (42 + rand() * 95) + leadCount * (18 + rand() * 44) : rand() < 0.08 ? rand() * 35 : 0;
  const mediaCost = isPaid ? maybeNull(money(spendBase), rand() < 0.08 ? 1 : 0) : maybeNull(spendBase > 0 ? money(spendBase) : "", 0.72);
  const jobValue = bookedJobs > 0 || closedWonCount > 0 ? money((bookedJobs + closedWonCount) * (480 + rand() * 2200)) : maybeNull("", 0.98);
  const revenue = closedWonCount > 0 && rand() > 0.28 ? money(closedWonCount * (650 + rand() * 2600)) : maybeNull("", 0.9);
  const salesValue = opportunities > 0 && rand() > 0.16 ? money(opportunities * (320 + rand() * 1800)) : maybeNull("", 0.82);

  const qualifiedRate = leadCount > 0 ? (qualifiedLeads / leadCount) * 100 : "";
  const conversionRate = leadCount > 0 ? (closedWonCount / leadCount) * 100 : "";
  const providedQualifiedRate = i % 101 === 0 ? 128 + Math.floor(rand() * 35) : maybeNull(qualifiedRate === "" ? "" : money(qualifiedRate), 0.08);
  const providedConversionRate = i % 113 === 0 ? 111 + Math.floor(rand() * 25) : maybeNull(conversionRate === "" ? "" : money(conversionRate), 0.1);

  const idPattern = rand();
  const hasCallId = idPattern < 0.68;
  const hasLeadId = idPattern > 0.18 && idPattern < 0.92;
  const hasBoth = idPattern > 0.34 && idPattern < 0.62;
  const customerId = `CUST-${String(1000 + Math.floor(i / 3) + Math.floor(rand() * 18)).padStart(5, "0")}`;
  const enquiryRef = `ENQ-${String(7000 + Math.floor(i / 2)).padStart(5, "0")}`;

  rows.push({
    interaction_id: `INT-${String(i + 1).padStart(5, "0")}`,
    call_id: hasCallId || hasBoth ? `CALL-${String(30000 + i).padStart(6, "0")}` : "",
    lead_id: hasLeadId || hasBoth ? `LEAD-${String(50000 + Math.floor(i * 1.13)).padStart(6, "0")}` : "",
    enquiry_ref: i % 17 === 0 ? `ENQ-DUP-${String(Math.floor(i / 17)).padStart(3, "0")}` : enquiryRef,
    customer_id: i % 11 === 0 ? `CUST-DUP-${String(Math.floor(i / 11) % 9).padStart(2, "0")}` : customerId,
    interaction_date: dateText,
    created_at: createdAt,
    month,
    source_channel: i % 31 === 0 ? channel.toLowerCase() : channel,
    campaign_name: i % 29 === 0 ? campaign.toUpperCase() : campaign,
    medium: i % 37 === 0 ? medium.toUpperCase() : medium,
    device_type: pick(devices),
    region: pick(regions),
    call_count: callCount,
    lead_count: leadCount,
    qualified_calls: qualifiedCalls,
    qualified_leads: qualifiedLeads,
    is_sales_qualified: isSalesQualified,
    opportunities,
    closed_won_count: closedWonCount,
    booked_jobs: bookedJobs,
    converted_flag: convertedFlag,
    media_cost_aud: mediaCost,
    sales_value_aud: salesValue,
    job_value_aud: jobValue,
    revenue_aud: revenue,
    provided_qualified_rate_pct: providedQualifiedRate,
    provided_conversion_rate_pct: providedConversionRate,
    call_status: pick(callStatuses),
    lead_status: closedWonCount > 0 ? "closed_won" : opportunities > 0 ? "opportunity" : qualifiedLeads > 0 ? "qualified" : pick(leadStatuses),
    outcome_status: bookedJobs > 0 ? "booked" : closedWonCount > 0 ? "won" : pick(outcomeStatuses)
  });
}

const columns = Object.keys(rows[0]);

function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(values) {
  return values.reduce((total, value) => total + (num(value) ?? 0), 0);
}

function validRate(rowsForRate, numeratorKey, denominatorKey) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rowsForRate) {
    const n = num(row[numeratorKey]);
    const d = num(row[denominatorKey]);
    if (n === null || d === null || d <= 0 || n < 0 || n > d) continue;
    numerator += n;
    denominator += d;
  }
  return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null };
}

function groupByChannel(rowsForGroup, numeratorKey, denominatorKey = null, lowerIsBetter = false) {
  const grouped = new Map();
  for (const row of rowsForGroup) {
    const channel = String(row.source_channel).toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
    const bucket = grouped.get(channel) ?? { numerator: 0, denominator: 0 };
    const n = num(row[numeratorKey]);
    const d = denominatorKey ? num(row[denominatorKey]) : null;
    if (denominatorKey) {
      if (n === null || d === null || d <= 0 || n < 0 || n > d) continue;
      bucket.numerator += n;
      bucket.denominator += d;
    } else {
      bucket.numerator += n ?? 0;
    }
    grouped.set(channel, bucket);
  }
  const ranked = [...grouped.entries()]
    .map(([channel, bucket]) => ({
      channel,
      value: denominatorKey ? (bucket.denominator > 0 ? bucket.numerator / bucket.denominator : null) : bucket.numerator,
      numerator: bucket.numerator,
      denominator: denominatorKey ? bucket.denominator : undefined
    }))
    .filter((entry) => entry.value !== null)
    .sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value);
  return ranked[0];
}

const validQualifiedCallRate = validRate(rows, "qualified_calls", "call_count");
const validQualifiedLeadRate = validRate(rows, "qualified_leads", "lead_count");
const opportunityRate = validRate(rows, "opportunities", "lead_count");
const closedWonRate = validRate(rows, "closed_won_count", "lead_count");
const bookedJobRate = validRate(rows, "booked_jobs", "call_count");

const paidRows = rows.filter((row) => ["Paid Search", "Paid Social", "Display"].includes(String(row.source_channel).replace(/\b\w/g, (m) => m.toUpperCase())));
const spendCoveredRows = rows.filter((row) => (num(row.media_cost_aud) ?? 0) > 0);
const revenueSpendRows = rows.filter((row) => (num(row.media_cost_aud) ?? 0) > 0 && num(row.revenue_aud) !== null);

const expected = {
  rowCount,
  columnCount: columns.length,
  identityCoverage: {
    call_id_populated: rows.filter((row) => row.call_id).length,
    lead_id_populated: rows.filter((row) => row.lead_id).length,
    both_call_and_lead_id: rows.filter((row) => row.call_id && row.lead_id).length,
    only_enquiry_ref: rows.filter((row) => !row.call_id && !row.lead_id && row.enquiry_ref).length
  },
  totals: {
    sum_call_count: sum(rows.map((row) => row.call_count)),
    count_call_id: rows.filter((row) => row.call_id).length,
    sum_lead_count: sum(rows.map((row) => row.lead_count)),
    count_lead_id: rows.filter((row) => row.lead_id).length,
    sum_qualified_calls: sum(rows.map((row) => row.qualified_calls)),
    sum_qualified_leads: sum(rows.map((row) => row.qualified_leads)),
    sum_opportunities: sum(rows.map((row) => row.opportunities)),
    sum_closed_won_count: sum(rows.map((row) => row.closed_won_count)),
    sum_booked_jobs: sum(rows.map((row) => row.booked_jobs)),
    sum_media_cost_aud: money(sum(rows.map((row) => row.media_cost_aud))),
    sum_job_value_aud: money(sum(rows.map((row) => row.job_value_aud))),
    sum_revenue_aud: money(sum(rows.map((row) => row.revenue_aud))),
    sum_sales_value_aud: money(sum(rows.map((row) => row.sales_value_aud)))
  },
  rates: {
    qualified_call_rate_valid_rows: validQualifiedCallRate,
    qualified_lead_rate_valid_rows: validQualifiedLeadRate,
    opportunity_conversion_rate_valid_rows: opportunityRate,
    closed_won_conversion_rate_valid_rows: closedWonRate,
    booked_job_per_call_rate_valid_rows: bookedJobRate
  },
  cpqc: {
    all_spend_all_qualified_calls: money(sum(rows.map((row) => row.media_cost_aud)) / sum(rows.map((row) => row.qualified_calls))),
    paid_channel_spend_paid_channel_qualified_calls: money(sum(paidRows.map((row) => row.media_cost_aud)) / sum(paidRows.map((row) => row.qualified_calls))),
    spend_covered_rows_spend_covered_qualified_calls: money(sum(spendCoveredRows.map((row) => row.media_cost_aud)) / sum(spendCoveredRows.map((row) => row.qualified_calls)))
  },
  roas: {
    revenue_aud_over_media_cost_where_both_populated: money(sum(revenueSpendRows.map((row) => row.revenue_aud)) / sum(revenueSpendRows.map((row) => row.media_cost_aud))),
    rows_with_both_revenue_and_spend: revenueSpendRows.length
  },
  topSegments: {
    total_calls: groupByChannel(rows, "call_count"),
    total_leads: groupByChannel(rows, "lead_count"),
    qualified_calls: groupByChannel(rows, "qualified_calls"),
    qualified_leads: groupByChannel(rows, "qualified_leads"),
    qualified_call_rate: groupByChannel(rows, "qualified_calls", "call_count"),
    qualified_lead_rate: groupByChannel(rows, "qualified_leads", "lead_count"),
    closed_won_conversion_rate: groupByChannel(rows, "closed_won_count", "lead_count"),
    revenue_job_value: groupByChannel(rows, "job_value_aud"),
    cpqc_paid_channel_lower_is_better: (() => {
      const grouped = new Map();
      for (const row of paidRows) {
        const channel = String(row.source_channel).toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
        const bucket = grouped.get(channel) ?? { spend: 0, qualified: 0 };
        bucket.spend += num(row.media_cost_aud) ?? 0;
        bucket.qualified += num(row.qualified_calls) ?? 0;
        grouped.set(channel, bucket);
      }
      return [...grouped.entries()]
        .map(([channel, bucket]) => ({ channel, value: bucket.qualified > 0 ? bucket.spend / bucket.qualified : null, spend: bucket.spend, qualified: bucket.qualified }))
        .filter((entry) => entry.value !== null)
        .sort((a, b) => a.value - b.value)[0];
    })(),
    cpqc_spend_covered_lower_is_better: (() => {
      const grouped = new Map();
      for (const row of spendCoveredRows) {
        const channel = String(row.source_channel).toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
        const bucket = grouped.get(channel) ?? { spend: 0, qualified: 0 };
        bucket.spend += num(row.media_cost_aud) ?? 0;
        bucket.qualified += num(row.qualified_calls) ?? 0;
        grouped.set(channel, bucket);
      }
      return [...grouped.entries()]
        .map(([channel, bucket]) => ({ channel, value: bucket.qualified > 0 ? bucket.spend / bucket.qualified : null, spend: bucket.spend, qualified: bucket.qualified }))
        .filter((entry) => entry.value !== null)
        .sort((a, b) => a.value - b.value)[0];
    })(),
    roas_revenue_scope: (() => {
      const grouped = new Map();
      for (const row of revenueSpendRows) {
        const channel = String(row.source_channel).toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
        const bucket = grouped.get(channel) ?? { revenue: 0, spend: 0 };
        bucket.revenue += num(row.revenue_aud) ?? 0;
        bucket.spend += num(row.media_cost_aud) ?? 0;
        grouped.set(channel, bucket);
      }
      return [...grouped.entries()]
        .map(([channel, bucket]) => ({ channel, value: bucket.spend > 0 ? bucket.revenue / bucket.spend : null, revenue: bucket.revenue, spend: bucket.spend }))
        .filter((entry) => entry.value !== null)
        .sort((a, b) => b.value - a.value)[0];
    })()
  },
  messyCases: {
    qualified_calls_gt_call_count: rows.filter((row) => num(row.qualified_calls) > num(row.call_count)).length,
    qualified_leads_gt_lead_count: rows.filter((row) => num(row.qualified_leads) > num(row.lead_count)).length,
    zero_call_count_rows: rows.filter((row) => num(row.call_count) === 0).length,
    zero_lead_count_rows: rows.filter((row) => num(row.lead_count) === 0).length,
    provided_qualified_rate_over_100: rows.filter((row) => (num(row.provided_qualified_rate_pct) ?? 0) > 100).length,
    provided_conversion_rate_over_100: rows.filter((row) => (num(row.provided_conversion_rate_pct) ?? 0) > 100).length,
    duplicated_customer_ids: rowCount - new Set(rows.map((row) => row.customer_id)).size,
    duplicated_enquiry_refs: rowCount - new Set(rows.map((row) => row.enquiry_ref)).size
  }
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(csvPath, [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n"));

function pct(rate) {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(2)}%`;
}

const notes = `# KPI Semantic Consistency Blind QA Expected Values

Generated by \`scripts/generate-kpi-semantic-blind-data.mjs\`.

## Dataset

- File: \`datasets/blind-qa/kpi_semantic_consistency_blind.csv\`
- Rows: ${expected.rowCount}
- Columns: ${expected.columnCount}
- Date range: December 2025 to March 2026
- Purpose: stress-test KPI card semantic consistency on a messy call/lead attribution hybrid dataset.

## Field Meanings

- \`call_count\`: explicit call volume. This should be preferred for total call volume over \`COUNT(call_id)\` when the system treats the dataset as aggregated or hybrid.
- \`lead_count\`: explicit lead volume. This should be preferred for total lead volume over \`COUNT(lead_id)\`.
- \`qualified_calls\`: qualified call count; should be compared with \`call_count\`.
- \`qualified_leads\`: qualified lead count; should be compared with \`lead_count\`.
- \`is_sales_qualified\`: row-level boolean-like qualification flag, useful only if the system chooses row-level grain.
- \`opportunities\`: mid-funnel lead conversion.
- \`closed_won_count\`: final closed-won conversion.
- \`booked_jobs\`: booked call/job outcome.
- \`media_cost_aud\`: paid media cost, mostly populated for paid channels.
- \`job_value_aud\`: job value when booked or closed-won outcomes exist.
- \`revenue_aud\`: incomplete revenue field.
- \`sales_value_aud\`: broader sales/opportunity value field that may differ from revenue.
- \`provided_qualified_rate_pct\` and \`provided_conversion_rate_pct\`: already stored as percent points, not decimals.

## Expected Global KPI Values

| KPI | Preferred Formula | Expected Value | Notes |
| --- | --- | ---: | --- |
| Total Calls | \`SUM(call_count)\` | ${expected.totals.sum_call_count} | \`COUNT(call_id)\` is ${expected.totals.count_call_id}; count fields represent volume better in this hybrid data. |
| Total Leads | \`SUM(lead_count)\` | ${expected.totals.sum_lead_count} | \`COUNT(lead_id)\` is ${expected.totals.count_lead_id}. |
| Qualified Calls | \`SUM(qualified_calls)\` | ${expected.totals.sum_qualified_calls} | Distinct from qualified leads. |
| Qualified Leads | \`SUM(qualified_leads)\` | ${expected.totals.sum_qualified_leads} | Distinct from qualified calls. |
| Qualified Call Rate | valid \`SUM(qualified_calls) / SUM(call_count)\` | ${pct(expected.rates.qualified_call_rate_valid_rows.rate)} | Excludes rows where numerator exceeds denominator or denominator is zero. |
| Qualified Lead Rate | valid \`SUM(qualified_leads) / SUM(lead_count)\` | ${pct(expected.rates.qualified_lead_rate_valid_rows.rate)} | Excludes invalid row ratios. |
| Opportunity Conversion Rate | valid \`SUM(opportunities) / SUM(lead_count)\` | ${pct(expected.rates.opportunity_conversion_rate_valid_rows.rate)} | Mid-funnel conversion. |
| Closed-Won Conversion Rate | valid \`SUM(closed_won_count) / SUM(lead_count)\` | ${pct(expected.rates.closed_won_conversion_rate_valid_rows.rate)} | Final closed-won conversion. |
| Booked Job per Call Rate | valid \`SUM(booked_jobs) / SUM(call_count)\` | ${pct(expected.rates.booked_job_per_call_rate_valid_rows.rate)} | Call/job booking outcome. |
| Job Value | \`SUM(job_value_aud)\` | $${expected.totals.sum_job_value_aud.toLocaleString()} | Strongest wording is “job value attributed to tracked calls/leads.” |
| Revenue | \`SUM(revenue_aud)\` | $${expected.totals.sum_revenue_aud.toLocaleString()} | Incomplete coverage; should be caveated. |
| Sales Value | \`SUM(sales_value_aud)\` | $${expected.totals.sum_sales_value_aud.toLocaleString()} | Broader sales/opportunity value. |

## CPQC Candidates

| Formula | Value | Notes |
| --- | ---: | --- |
| \`SUM(media_cost_aud) / SUM(qualified_calls)\` | $${expected.cpqc.all_spend_all_qualified_calls} | All rows, including organic/direct rows with zero or missing spend. |
| paid-channel spend / paid-channel qualified calls | $${expected.cpqc.paid_channel_spend_paid_channel_qualified_calls} | Paid Search, Paid Social, Display. |
| spend-covered rows / qualified calls in spend-covered rows | $${expected.cpqc.spend_covered_rows_spend_covered_qualified_calls} | Closest to spend-coverage-gated CPQC. |

## ROAS Candidate

- \`SUM(revenue_aud) / SUM(media_cost_aud)\` where both revenue and spend are populated: ${expected.roas.revenue_aud_over_media_cost_where_both_populated}x
- Rows with both revenue and spend: ${expected.roas.rows_with_both_revenue_and_spend}
- Caveat: \`revenue_aud\` coverage is intentionally incomplete, so ROAS should not be over-trusted.

## Expected Top Source Channels

| KPI | Top Channel | Value |
| --- | --- | ---: |
| Total Calls | ${expected.topSegments.total_calls.channel} | ${expected.topSegments.total_calls.value} |
| Total Leads | ${expected.topSegments.total_leads.channel} | ${expected.topSegments.total_leads.value} |
| Qualified Calls | ${expected.topSegments.qualified_calls.channel} | ${expected.topSegments.qualified_calls.value} |
| Qualified Leads | ${expected.topSegments.qualified_leads.channel} | ${expected.topSegments.qualified_leads.value} |
| Qualified Call Rate | ${expected.topSegments.qualified_call_rate.channel} | ${pct(expected.topSegments.qualified_call_rate.value)} |
| Qualified Lead Rate | ${expected.topSegments.qualified_lead_rate.channel} | ${pct(expected.topSegments.qualified_lead_rate.value)} |
| Closed-Won Conversion Rate | ${expected.topSegments.closed_won_conversion_rate.channel} | ${pct(expected.topSegments.closed_won_conversion_rate.value)} |
| Revenue / Job Value | ${expected.topSegments.revenue_job_value.channel} | $${money(expected.topSegments.revenue_job_value.value).toLocaleString()} |
| CPQC, paid channels, lower is better | ${expected.topSegments.cpqc_paid_channel_lower_is_better.channel} | $${money(expected.topSegments.cpqc_paid_channel_lower_is_better.value)} |
| CPQC, spend-covered rows, lower is better | ${expected.topSegments.cpqc_spend_covered_lower_is_better.channel} | $${money(expected.topSegments.cpqc_spend_covered_lower_is_better.value)} |
| ROAS | ${expected.topSegments.roas_revenue_scope.channel} | ${money(expected.topSegments.roas_revenue_scope.value)}x |

## Intentional Messiness

- Rows with \`qualified_calls > call_count\`: ${expected.messyCases.qualified_calls_gt_call_count}
- Rows with \`qualified_leads > lead_count\`: ${expected.messyCases.qualified_leads_gt_lead_count}
- Rows with zero \`call_count\`: ${expected.messyCases.zero_call_count_rows}
- Rows with zero \`lead_count\`: ${expected.messyCases.zero_lead_count_rows}
- \`provided_qualified_rate_pct > 100\`: ${expected.messyCases.provided_qualified_rate_over_100}
- \`provided_conversion_rate_pct > 100\`: ${expected.messyCases.provided_conversion_rate_over_100}
- Duplicate customer IDs: ${expected.messyCases.duplicated_customer_ids}
- Duplicate enquiry refs: ${expected.messyCases.duplicated_enquiry_refs}
- Partial spend coverage on non-paid channels.
- Partial revenue coverage even when job value or sales value exists.
- Inconsistent casing in channel, campaign, and medium fields.

## Bugs This Dataset Is Designed To Catch

- KPI card says “calls” when denominator is actually \`lead_count\`.
- KPI card says “leads” when denominator is actually \`call_count\`.
- Qualified Rate and Conversion Rate collapse into the same definition.
- Conversion Rate description does not state whether it uses opportunities, closed-won outcomes, or booked jobs.
- Count fields are formatted as percentages.
- Existing percent-point fields are multiplied by 100 again.
- Rows with numerator greater than denominator create impossible percentages.
- CPQC silently changes denominator scope without saying whether it uses all rows, paid channels, or spend-covered rows.
- Top segment for a ratio KPI is computed from volume instead of grouped ratio.
- Top segment for CPQC uses highest value instead of lower-is-better logic.
`;

fs.writeFileSync(notesPath, notes);

console.log(JSON.stringify({ csvPath, notesPath, rowCount: expected.rowCount, columnCount: expected.columnCount, expected }, null, 2));
