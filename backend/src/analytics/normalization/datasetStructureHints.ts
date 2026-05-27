import type { DatasetStructureHint } from "./types.js";

function normalize(value: string) {
  return value.toLowerCase();
}

function tokenize(column: string) {
  return normalize(column)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasCallIdentifier(columns: string[]) {
  return columns.some((column) =>
    /\b(call_id|phone_call_id|enquiry_id|inquiry_id|call_uuid|call_reference)\b/.test(normalize(column))
  );
}

function hasCallTimestamp(columns: string[]) {
  return columns.some((column) =>
    /\b(call_datetime|call_date|call_time|timestamp|timestamp_local|created_at)\b/.test(normalize(column))
  );
}

function hasCallParticipant(columns: string[]) {
  return columns.some((column) =>
    /\b(caller_number|destination_number|tracking_number|customer_number)\b/.test(normalize(column))
  );
}

function hasCallDuration(columns: string[]) {
  return columns.some((column) =>
    /\b(call_duration|duration|talk_time|handle_time|wait_time|ring_time)\b/.test(normalize(column))
  );
}

function hasAggregatedCounts(columns: string[]) {
  return columns.some((column) => {
    const normalized = normalize(column);
    if (/\b(total_calls|call_count|calls|call_volume|qualified_calls|missed_calls|answered_calls|converted_calls)\b/.test(normalized)) {
      return true;
    }

    const tokens = new Set(tokenize(column));
    const hasMeasureToken = ["call", "calls", "lead", "leads", "conversion", "conversions", "appointment", "appointments"].some((token) =>
      tokens.has(token)
    );
    const hasSummaryToken = ["count", "counts", "volume", "total", "qualified", "converted", "missed", "answered", "inbound", "outbound"].some(
      (token) => tokens.has(token)
    );

    return hasMeasureToken && hasSummaryToken;
  });
}

function hasCampaignSummary(columns: string[]) {
  return columns.some((column) =>
    /\b(campaign|channel|source|medium|source_medium)\b/.test(normalize(column))
  );
}

function hasSummaryValueColumns(columns: string[]) {
  return columns.some((column) => /\b(spend|cost|budget|revenue|sales|value)\b/.test(normalize(column)));
}

export function detectDatasetStructureHint(columnNames: string[]): DatasetStructureHint {
  const signals: string[] = [];
  let rowLevelScore = 0;
  let aggregatedScore = 0;
  const aggregatedCountFields = columnNames.filter((column) => hasAggregatedCounts([column]));

  if (hasCallIdentifier(columnNames)) {
    rowLevelScore += 0.35;
    signals.push("Call identifier field detected.");
  }
  if (hasCallTimestamp(columnNames)) {
    rowLevelScore += 0.2;
    signals.push("Call timestamp field detected.");
  }
  if (hasCallParticipant(columnNames)) {
    rowLevelScore += 0.15;
    signals.push("Caller or destination number field detected.");
  }
  if (hasCallDuration(columnNames)) {
    rowLevelScore += 0.1;
    signals.push("Call duration field detected.");
  }

  if (aggregatedCountFields.length > 0) {
    aggregatedScore += 0.45;
    signals.push("Explicit aggregated call-count field detected.");
  }
  if (aggregatedCountFields.length >= 2) {
    aggregatedScore += 0.2;
    signals.push("Multiple summary count fields detected.");
  }
  if (hasCampaignSummary(columnNames)) {
    aggregatedScore += 0.15;
    signals.push("Campaign or channel summary field detected.");
  }
  if (hasSummaryValueColumns(columnNames) && aggregatedCountFields.length > 0) {
    aggregatedScore += 0.1;
    signals.push("Summary metrics appear alongside spend or revenue fields.");
  }

  if (aggregatedScore > rowLevelScore && aggregatedScore >= 0.45) {
    return {
      grain: "aggregated_call_summary",
      confidence: Number(Math.min(1, aggregatedScore).toFixed(2)),
      signals
    };
  }

  if (rowLevelScore > aggregatedScore && rowLevelScore >= 0.45) {
    return {
      grain: "row_level_call_log",
      confidence: Number(Math.min(1, rowLevelScore).toFixed(2)),
      signals
    };
  }

  return {
    grain: "unknown",
    confidence: Number(Math.max(rowLevelScore, aggregatedScore).toFixed(2)),
    signals
  };
}
