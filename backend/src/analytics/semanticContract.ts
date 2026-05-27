import type { DatasetColumnProfile, DatasetProfile, DatasetRow, PrimitiveValue } from "./types.js";
import { parseDateValue, parseNumber } from "../utils/inference.js";

type ResolutionKind = "direct" | "alias" | "derived";
type MetricAggregation = "sum" | "ratio" | "difference" | "average";
type SemanticRoleCategory =
  | "metric"
  | "dimension"
  | "datetime"
  | "identifier"
  | "flag"
  | "value"
  | "unknown";
type DatasetDomain =
  | "call_tracking"
  | "call_operations"
  | "marketing_attribution"
  | "mixed_call_tracking_attribution"
  | "generic_business"
  | "unknown";

export interface SemanticMetricResolution {
  key: string;
  sourceColumns: string[];
  resolution: ResolutionKind;
  confidence: number;
  aggregation: MetricAggregation;
  formula?: string;
  denominatorMetric?: string;
}

export interface SemanticDimensionResolution {
  key: string;
  sourceColumns: string[];
  resolution: ResolutionKind;
  confidence: number;
}

export interface SemanticRoleMapping {
  rawColumn: string;
  semanticRole: string | null;
  confidence: number;
  kind: SemanticRoleCategory;
  evidence: string[];
}

export interface SemanticDomainDetection {
  domain: DatasetDomain;
  confidence: number;
  detectedCapabilities: string[];
}

export interface SemanticKpiAvailability {
  key: string;
  label: string;
  status: "enabled" | "disabled";
  requiredRoles: string[];
  reason: string;
}

export interface SemanticSafetyWarning {
  rawColumn: string;
  blockedRole: string;
  reason: string;
  suggestedRole?: string;
}

export interface SemanticDatasetContract {
  metricResolutions: Record<string, SemanticMetricResolution>;
  dimensionResolutions: Record<string, SemanticDimensionResolution>;
  availableMetrics: string[];
  availableDimensions: string[];
  derivedMetrics: string[];
  sourceToCanonical: Record<string, string>;
  sourceToSemanticRole?: Record<string, string>;
  roleMappings?: SemanticRoleMapping[];
  detectedDomain?: SemanticDomainDetection;
  enabledKpis?: SemanticKpiAvailability[];
  disabledKpis?: SemanticKpiAvailability[];
  safetyWarnings?: SemanticSafetyWarning[];
}

type RoleSpec = {
  key: string;
  aliases: string[];
  kind: SemanticRoleCategory;
  expectedKinds?: Array<DatasetColumnProfile["kind"]>;
  legacyMetricKey?: string;
  legacyDimensionKey?: string;
  valueDetector?: (column: DatasetColumnProfile) => { score: number; evidence: string[] };
};

type RankedRoleCandidate = {
  spec: RoleSpec;
  score: number;
  evidence: string[];
};

type SemanticSafetyDecision = {
  mapping: SemanticRoleMapping;
  warning?: SemanticSafetyWarning;
};

const BOOLEAN_TRUE_VALUES = new Set(["true", "yes", "y", "1", "qualified", "converted", "answered", "booked"]);
const BOOLEAN_FALSE_VALUES = new Set(["false", "no", "n", "0", "unqualified", "not qualified", "missed", "not answered"]);
const QUALIFIED_OUTCOME_PATTERNS = [
  /\bqualified lead\b/i,
  /\bbooked appointment\b/i,
  /\bclosed won\b/i,
  /\bconverted\b/i,
  /\bsale\b/i,
  /\bquote sent\b/i
];
const CONVERTED_OUTCOME_PATTERNS = [/\bclosed won\b/i, /\bconverted\b/i, /\bsale\b/i];
const MISSED_OUTCOME_PATTERNS = [/\bmissed\b/i, /\babandoned\b/i, /\bno answer\b/i, /\bvoicemail\b/i, /\bhung up\b/i];
const ANSWERED_OUTCOME_PATTERNS = [
  /\binbound\b/i,
  /\boutbound\b/i,
  /\banswered\b/i,
  /\bconnected\b/i,
  /\bqualified lead\b/i,
  /\bbooked appointment\b/i,
  /\bclosed won\b/i
];
const FLAG_ROLE_KEYS = new Set(["qualifiedCall", "convertedCall", "missedCall", "answeredCall", "firstTimeCaller", "repeatCaller"]);
const IDENTIFIER_ROLE_KEYS = new Set(["callId", "trackingNumber", "callerNumber", "destinationNumber"]);
const CHANNEL_ALIAS_MAP: Array<{ matchers: RegExp[]; label: string }> = [
  { matchers: [/^google[\s_-]*ads$/i, /^googleads$/i], label: "Google Ads" },
  { matchers: [/^paid[\s_-]*search$/i, /^ppc$/i], label: "Paid Search" },
  { matchers: [/^meta[\s_-]*ads$/i, /^facebook[\s_-]*ads$/i, /^paid[\s_-]*social$/i], label: "Paid Social" },
  { matchers: [/^organic[\s_-]*search$/i, /^seo$/i], label: "Organic Search" }
];
const KPI_DEFINITIONS = [
  { key: "total_calls", label: "Total Calls", requiredRoles: ["callId"] },
  { key: "unique_callers", label: "Unique Callers", requiredRoles: ["callerNumber"] },
  { key: "qualified_calls", label: "Qualified Calls", requiredRoles: ["qualifiedCall"] },
  { key: "qualified_call_rate", label: "Qualified Call Rate", requiredRoles: ["qualifiedCall", "callId"] },
  { key: "converted_calls", label: "Converted Calls", requiredRoles: ["convertedCall"] },
  { key: "conversion_rate", label: "Conversion Rate", requiredRoles: ["convertedCall", "callId"] },
  { key: "total_revenue", label: "Total Revenue", requiredRoles: ["revenue"] },
  { key: "revenue_per_call", label: "Revenue per Call", requiredRoles: ["revenue", "callId"] },
  { key: "total_spend", label: "Total Spend", requiredRoles: ["spend"] },
  { key: "cost_per_call", label: "Cost per Call", requiredRoles: ["spend", "callId"] },
  { key: "roas", label: "ROAS", requiredRoles: ["revenue", "spend"] },
  { key: "cost_per_qualified_call", label: "Cost per Qualified Call", requiredRoles: ["spend", "qualifiedCall"] },
  { key: "cost_per_conversion", label: "Cost per Conversion", requiredRoles: ["spend", "convertedCall"] },
  { key: "avg_call_duration", label: "Avg Call Duration", requiredRoles: ["callDuration"] },
  { key: "repeat_caller_rate", label: "Repeat Caller Rate", requiredRoles: ["repeatCaller"] },
  { key: "missed_call_rate", label: "Missed Call Rate", requiredRoles: ["missedCall"] },
  { key: "answered_call_rate", label: "Answered Call Rate", requiredRoles: ["answeredCall"] }
] as const;

const ROLE_SPECS: RoleSpec[] = [
  {
    key: "callId",
    aliases: [
      "call id",
      "callid",
      "phone call id",
      "phone_call_id",
      "call ref",
      "call reference",
      "call_ref",
      "call_reference",
      "call uuid",
      "call_uuid",
      "interaction id",
      "interaction ref",
      "interaction_ref",
      "lead call id",
      "lead_call_id",
      "session call id",
      "session_call_id",
      "enquiry id",
      "enquiry_id",
      "inquiry id",
      "inquiry_id"
    ],
    kind: "identifier",
    expectedKinds: ["categorical", "numeric"],
    valueDetector: detectIdLikeValues
  },
  {
    key: "callerId",
    aliases: ["caller id", "callerid", "lead id", "leadid", "contact id"],
    kind: "identifier",
    expectedKinds: ["categorical", "numeric"]
  },
  {
    key: "callerNumber",
    aliases: ["caller number", "caller", "phone number", "phone", "customer phone", "customer_number", "mobile number"],
    kind: "identifier",
    expectedKinds: ["categorical", "numeric"],
    valueDetector: detectPhoneLikeValues
  },
  {
    key: "trackingNumber",
    aliases: [
      "tracking number",
      "tracking num",
      "trackingnum",
      "tracking no",
      "tracking_no",
      "dni number",
      "dni no",
      "dni_number",
      "dni tracking no",
      "dni_tracking_no",
      "call tracking number"
    ],
    kind: "identifier",
    expectedKinds: ["categorical", "numeric"],
    valueDetector: detectPhoneLikeValues
  },
  {
    key: "destinationNumber",
    aliases: ["destination number", "destination_number", "dialed number", "sales line", "business number"],
    kind: "identifier",
    expectedKinds: ["categorical", "numeric"],
    valueDetector: detectPhoneLikeValues
  },
  {
    key: "callDateTime",
    aliases: [
      "call datetime",
      "call timestamp",
      "timestamp",
      "timestamp local",
      "timestamp_local",
      "date time",
      "date_time",
      "call start",
      "call started at",
      "call_started_at",
      "start time",
      "created at"
    ],
    kind: "datetime",
    expectedKinds: ["datetime"],
    valueDetector: detectDatetimeLikeValues
  },
  {
    key: "callDate",
    aliases: ["call date", "date", "call_day", "day", "call date time"],
    kind: "datetime",
    expectedKinds: ["datetime"],
    valueDetector: detectDatetimeLikeValues
  },
  {
    key: "callTime",
    aliases: ["call time", "time of call", "hour", "time", "hour of day", "hour_of_day"],
    kind: "datetime",
    expectedKinds: ["datetime", "categorical"],
    valueDetector: detectDatetimeLikeValues
  },
  {
    key: "channel",
    aliases: ["channel", "marketing channel", "marketing_channel", "source channel", "source_channel"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "channel",
    valueDetector: detectChannelLikeValues
  },
  {
    key: "source",
    aliases: ["source", "utm source", "utm_source", "traffic source", "traffic_source"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "source"
  },
  {
    key: "medium",
    aliases: ["medium", "utm medium", "utm_medium"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "medium"
  },
  {
    key: "campaign",
    aliases: ["campaign", "campaign name", "campaign_name", "utm campaign", "utm_campaign"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "campaign"
  },
  {
    key: "adGroup",
    aliases: ["ad group", "ad_group", "adgroup", "utm adgroup", "ad set"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "adGroup"
  },
  {
    key: "keyword",
    aliases: ["keyword", "utm term", "utm_term", "search term", "search_term"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "keyword"
  },
  {
    key: "callRecordingUrl",
    aliases: [
      "recording url",
      "recording_url",
      "call recording url",
      "call_recording_url",
      "recording link",
      "call recording",
      "audio url",
      "audio_url",
      "audio link"
    ],
    kind: "value",
    expectedKinds: ["categorical"],
    valueDetector: detectUrlLikeValues
  },
  {
    key: "landingPage",
    aliases: ["landing page", "landing_page", "landing url", "landing_url", "page url", "page_url", "url"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "landingPage",
    valueDetector: detectUrlLikeValues
  },
  {
    key: "deviceType",
    aliases: ["device", "device type", "device_type", "platform"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "device",
    valueDetector: detectDeviceLikeValues
  },
  {
    key: "callStatus",
    aliases: ["call status", "status", "call outcome status", "disposition", "call direction", "direction", "call type"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "callStatus",
    valueDetector: detectCallStatusValues
  },
  {
    key: "qualifiedCall",
    aliases: ["qualified call", "qualified", "is qualified", "is_qualified"],
    kind: "flag",
    expectedKinds: ["categorical", "numeric"],
    legacyMetricKey: "qualifiedCall",
    valueDetector: detectBooleanLikeValues
  },
  {
    key: "convertedCall",
    aliases: ["converted", "conversion", "booked", "sale", "closed won", "converted call"],
    kind: "flag",
    expectedKinds: ["categorical", "numeric"],
    legacyMetricKey: "convertedCall",
    valueDetector: detectBooleanLikeValues
  },
  {
    key: "missedCall",
    aliases: ["missed call", "missed", "unanswered", "lost call"],
    kind: "flag",
    expectedKinds: ["categorical", "numeric"],
    legacyMetricKey: "missedCall",
    valueDetector: detectBooleanLikeValues
  },
  {
    key: "answeredCall",
    aliases: ["answered call", "answered", "connected call"],
    kind: "flag",
    expectedKinds: ["categorical", "numeric"],
    legacyMetricKey: "answeredCall",
    valueDetector: detectBooleanLikeValues
  },
  {
    key: "callOutcome",
    aliases: ["call outcome", "outcome", "result", "call result", "disposition", "status"],
    kind: "dimension",
    expectedKinds: ["categorical"]
  },
  {
    key: "callDuration",
    aliases: ["call duration", "duration", "duration seconds", "duration_seconds", "call length", "call duration sec", "duration sec", "duration_sec"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "callDuration",
    valueDetector: detectDurationLikeValues
  },
  {
    key: "talkTime",
    aliases: ["talk time", "talk_time", "talktime", "conversation duration", "talk seconds", "talk_seconds"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "talkTime",
    valueDetector: detectDurationLikeValues
  },
  {
    key: "waitTime",
    aliases: ["wait time", "wait_time", "wait seconds", "wait_seconds"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "waitTime",
    valueDetector: detectDurationLikeValues
  },
  {
    key: "ringTime",
    aliases: ["ring time", "ring_time", "ring seconds", "ring_seconds"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "ringTime",
    valueDetector: detectDurationLikeValues
  },
  {
    key: "handleTime",
    aliases: ["handle time", "handle_time", "handle seconds", "handle_seconds"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "handleTime",
    valueDetector: detectDurationLikeValues
  },
  {
    key: "firstTimeCaller",
    aliases: ["first time caller", "first_time_caller", "new caller"],
    kind: "flag",
    expectedKinds: ["categorical", "numeric"],
    legacyMetricKey: "firstTimeCaller",
    valueDetector: detectBooleanLikeValues
  },
  {
    key: "repeatCaller",
    aliases: [
      "repeat caller",
      "repeat_caller",
      "repeat customer",
      "repeat_customer",
      "repeat customer flag",
      "repeat_customer_flag",
      "returning caller",
      "returning customer",
      "returning_customer",
      "existing customer flag",
      "existing_customer_flag"
    ],
    kind: "flag",
    expectedKinds: ["categorical", "numeric"],
    legacyMetricKey: "repeatCaller",
    valueDetector: detectBooleanLikeValues
  },
  {
    key: "revenue",
    aliases: [
      "revenue",
      "revenue value",
      "revenue_value",
      "sale value",
      "sale_value",
      "sales value",
      "sales_value",
      "sales",
      "deal value",
      "deal_value",
      "booking value",
      "booking_value",
      "value"
    ],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "revenue"
  },
  {
    key: "spend",
    aliases: [
      "spend",
      "cost",
      "ad spend",
      "ad_spend",
      "ad cost",
      "ad_cost",
      "media cost",
      "media_cost",
      "campaign cost",
      "campaign_cost",
      "marketing spend",
      "marketing_spend",
      "paid media cost",
      "paid_media_cost",
      "budget"
    ],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "spend"
  },
  {
    key: "cost",
    aliases: ["cost"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "spend"
  },
  {
    key: "leadValue",
    aliases: ["lead value", "lead_value"],
    kind: "metric",
    expectedKinds: ["numeric"]
  },
  {
    key: "salesValue",
    aliases: ["sales value", "sales_value", "order value"],
    kind: "metric",
    expectedKinds: ["numeric"]
  },
  {
    key: "clientId",
    aliases: ["client id", "client_id", "account id", "account_id"],
    kind: "identifier",
    expectedKinds: ["categorical", "numeric"]
  },
  {
    key: "clientName",
    aliases: ["client name", "client_name", "account name", "account_name"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "client"
  },
  {
    key: "accountId",
    aliases: [
      "account id",
      "account_id",
      "account no",
      "account number",
      "account_no",
      "account_number",
      "customer account id",
      "customer_account_id",
      "business account id",
      "business_account_id",
      "advertiser id",
      "advertiser_id",
      "brand id",
      "brand_id",
      "company id",
      "company_id"
    ],
    kind: "identifier",
    expectedKinds: ["categorical", "numeric"],
    valueDetector: detectIdLikeValues
  },
  {
    key: "accountName",
    aliases: [
      "account",
      "account name",
      "account_name",
      "customer account",
      "customer_account",
      "business account",
      "business_account",
      "advertiser",
      "brand",
      "company"
    ],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "account",
    valueDetector: detectAccountLikeValues
  },
  {
    key: "qualityScore",
    aliases: ["score", "quality score", "quality_score", "call quality rating", "call_quality_rating", "rating"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "qualityScore",
    valueDetector: detectScoreLikeValues
  },
  {
    key: "leadScore",
    aliases: ["lead score", "lead_score"],
    kind: "metric",
    expectedKinds: ["numeric"],
    legacyMetricKey: "leadScore",
    valueDetector: detectScoreLikeValues
  },
  {
    key: "businessUnit",
    aliases: ["business unit", "business_unit", "department"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "businessUnit"
  },
  {
    key: "region",
    aliases: ["region", "market", "country", "state", "geo"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "region"
  },
  {
    key: "location",
    aliases: ["location", "office", "branch", "city"],
    kind: "dimension",
    expectedKinds: ["categorical"],
    legacyDimensionKey: "location"
  }
];

function normalizeName(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  return normalizeName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function scoreColumnMatch(column: string, alias: string) {
  const normalizedColumn = normalizeName(column);
  const normalizedAlias = normalizeName(alias);
  if (normalizedColumn === normalizedAlias) {
    return 4;
  }
  if (normalizedColumn.startsWith(normalizedAlias) || normalizedColumn.endsWith(normalizedAlias)) {
    return 3.5;
  }
  if (normalizedAlias.length >= 5 && normalizedColumn.includes(normalizedAlias)) {
    return 3;
  }
  const columnTokens = tokenize(column);
  const aliasTokens = tokenize(alias);
  const overlap = aliasTokens.filter((token) => columnTokens.includes(token)).length;
  if (overlap > 0) {
    return Math.min(2.5, overlap);
  }
  return 0;
}

function detectPhoneLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  const matches = samples.filter((sample) => {
    if (isStrongDatetimeSample(sample)) {
      return false;
    }
    if (/[a-z]/i.test(sample.replace(/[tz]/gi, "")) && !/^\+?[\d\s().-]+$/i.test(sample)) {
      return false;
    }
    const digits = sample.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }).length;
  if (samples.length > 0 && matches / samples.length >= 0.6) {
    return { score: 2.2, evidence: ["Sample values look like phone numbers"] };
  }
  return { score: 0, evidence: [] };
}

function detectIdLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  if (samples.length === 0) {
    return { score: 0, evidence: [] };
  }

  const matches = samples.filter((sample) => {
    if (isStrongDatetimeSample(sample)) {
      return false;
    }
    if (detectPhoneLikeValues(column).score > 0) {
      return false;
    }
    if (/\b(score|rating|quality)\b/i.test(column.name)) {
      return false;
    }
    return /^[a-z0-9][a-z0-9\-_/#. ]{1,40}$/i.test(sample) && /[a-z]/i.test(sample);
  }).length;

  if (column.uniqueCount >= Math.max(10, Math.floor((column.missingCount + samples.length) * 0.8)) && matches / samples.length >= 0.4) {
    return { score: 2.3, evidence: ["Sample values look like identifier codes"] };
  }

  if (samples.length > 0 && matches / samples.length >= 0.6) {
    return { score: 1.8, evidence: ["Sample values look like identifier-like codes"] };
  }

  return { score: 0, evidence: [] };
}

function detectDatetimeLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  const hasTimeSignalInName = /\b(date|time|timestamp|datetime|created|start)\b/.test(normalizeName(column.name));
  const matches = samples.filter((sample) => isStrongDatetimeSample(sample)).length;

  if (samples.length > 0 && matches / samples.length >= 0.5) {
    return { score: 2.4, evidence: ["Sample values look like datetime values"] };
  }

  if (
    hasTimeSignalInName &&
    column.kind === "numeric" &&
    typeof column.min === "number" &&
    typeof column.max === "number" &&
    column.min >= 946_684_800 &&
    column.max <= 4_102_444_800
  ) {
    return { score: 2.5, evidence: ["Numeric values look like epoch timestamps in seconds"] };
  }

  if (
    hasTimeSignalInName &&
    column.kind === "numeric" &&
    typeof column.min === "number" &&
    typeof column.max === "number" &&
    column.min >= 946_684_800_000 &&
    column.max <= 4_102_444_800_000
  ) {
    return { score: 2.5, evidence: ["Numeric values look like epoch timestamps in milliseconds"] };
  }

  return { score: 0, evidence: [] };
}

function detectUrlLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  const matches = samples.filter((sample) => /https?:\/\/|www\.|\/[a-z0-9_-]+/i.test(sample)).length;
  if (samples.length > 0 && matches / samples.length >= 0.5) {
    return { score: 2.2, evidence: ["Sample values look like URLs or landing pages"] };
  }
  return { score: 0, evidence: [] };
}

function detectBooleanLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  const matches = samples.filter((sample) => {
    const normalized = normalizeName(sample);
    return BOOLEAN_TRUE_VALUES.has(normalized) || BOOLEAN_FALSE_VALUES.has(normalized);
  }).length;
  if (column.kind === "numeric" && typeof column.min === "number" && typeof column.max === "number" && column.min >= 0 && column.max <= 1) {
    return { score: 1.8, evidence: ["Numeric values are bounded like a boolean flag"] };
  }
  if (samples.length > 0 && matches / samples.length >= 0.75) {
    return { score: 2, evidence: ["Sample values look like boolean call outcome flags"] };
  }
  return { score: 0, evidence: [] };
}

function isBooleanLikeColumn(column: DatasetColumnProfile) {
  if (column.kind === "numeric" && typeof column.min === "number" && typeof column.max === "number") {
    return column.min >= 0 && column.max <= 1;
  }

  const samples = collectSampleStrings(column);
  if (samples.length === 0) {
    return false;
  }

  const matches = samples.filter((sample) => {
    const normalized = normalizeName(sample);
    return BOOLEAN_TRUE_VALUES.has(normalized) || BOOLEAN_FALSE_VALUES.has(normalized);
  }).length;

  return matches / samples.length >= 0.75;
}

function hasMoneyValueSignal(column: DatasetColumnProfile) {
  return /\b(conversion|lead|sales|job|deal|revenue|order)\s*(value)?\b|\b(value)\b/i.test(normalizeName(column.name));
}

function isContinuousNumericValueColumn(column: DatasetColumnProfile) {
  return (
    column.kind === "numeric" &&
    typeof column.max === "number" &&
    typeof column.min === "number" &&
    (column.max > 1 || column.min < 0)
  );
}

function inferSaferMetricRole(column: DatasetColumnProfile) {
  const normalized = normalizeName(column.name);
  if (/\blead value\b|\blead_value\b/i.test(normalized)) {
    return "leadValue";
  }
  if (/\bsale value\b|\bsale_value\b|\bsales value\b|\bsales_value\b|\border value\b|\border_value\b/i.test(normalized)) {
    return "salesValue";
  }
  if (/\bconversion value\b|\bconversion_value\b|\bjob value\b|\bjob_value\b|\bdeal value\b|\bdeal_value\b|\bbooking value\b|\bbooking_value\b|\brevenue value\b|\brevenue_value\b|\bsale value\b|\bsale_value\b/i.test(normalized)) {
    return "revenue";
  }
  return null;
}

function matchesAnyPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function classifyOutcomeSemanticRole(value: PrimitiveValue, semanticRole: string) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeName(value);
  if (!normalized) {
    return null;
  }

  if (semanticRole === "qualifiedCall") {
    return matchesAnyPattern(normalized, QUALIFIED_OUTCOME_PATTERNS) ? 1 : 0;
  }

  if (semanticRole === "convertedCall") {
    return matchesAnyPattern(normalized, CONVERTED_OUTCOME_PATTERNS) ? 1 : 0;
  }

  if (semanticRole === "missedCall") {
    return matchesAnyPattern(normalized, MISSED_OUTCOME_PATTERNS) ? 1 : 0;
  }

  if (semanticRole === "answeredCall") {
    if (matchesAnyPattern(normalized, MISSED_OUTCOME_PATTERNS)) {
      return 0;
    }
    return matchesAnyPattern(normalized, ANSWERED_OUTCOME_PATTERNS) ? 1 : 0;
  }

  return null;
}

function deriveOutcomeFlagMapping(params: {
  column: DatasetColumnProfile;
  semanticRole: "qualifiedCall" | "convertedCall" | "missedCall" | "answeredCall";
  evidenceLabel: string;
}) {
  const samples = collectSampleStrings(params.column);
  if (samples.length === 0) {
    return null;
  }

  const classifiedValues = samples
    .map((sample) => classifyOutcomeSemanticRole(sample, params.semanticRole))
    .filter((value): value is 0 | 1 => value !== null);
  const positiveMatches = classifiedValues.filter((value) => value === 1).length;

  if (positiveMatches === 0) {
    return null;
  }

  const confidenceBase = params.semanticRole === "qualifiedCall" ? 0.88 : params.semanticRole === "missedCall" ? 0.9 : 0.82;
  return {
    rawColumn: params.column.name,
    semanticRole: params.semanticRole,
    confidence: Number(Math.min(0.96, confidenceBase + Math.min(0.06, positiveMatches * 0.01)).toFixed(2)),
    kind: "flag" as const,
    evidence: [
      `${params.evidenceLabel} contains recognizable ${params.semanticRole} outcome values`,
      `Examples matched the ${params.semanticRole} outcome pattern`
    ]
  };
}

function inferSaferDatetimeRole(column: DatasetColumnProfile) {
  const normalized = normalizeName(column.name);
  if (/\b(datetime|timestamp|created at|created|started at|call start|start time)\b/.test(normalized)) {
    return "callDateTime";
  }
  if (/\b(call date|date|day)\b/.test(normalized)) {
    return "callDate";
  }
  if (/\b(call time|time of call|hour|time)\b/.test(normalized)) {
    return "callTime";
  }
  return "callDateTime";
}

function detectDurationLikeValues(column: DatasetColumnProfile) {
  if (column.kind !== "numeric") {
    return { score: 0, evidence: [] };
  }
  if (/\b(score|rating|quality)\b/i.test(column.name)) {
    return { score: 0, evidence: [] };
  }
  if (typeof column.min === "number" && typeof column.max === "number" && column.min >= 0 && column.max <= 14400) {
    return { score: 1.7, evidence: ["Numeric range looks like call duration in seconds"] };
  }
  return { score: 0, evidence: [] };
}

function detectAccountLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  if (samples.length === 0) {
    return { score: 0, evidence: [] };
  }

  const nameLike = samples.filter((sample) => {
    if (isStrongDatetimeSample(sample)) {
      return false;
    }
    if (/^\+?[\d\s().-]+$/.test(sample)) {
      return false;
    }
    if (/^[A-Z0-9_-]{2,12}$/.test(sample)) {
      return false;
    }
    return /[a-z]/i.test(sample);
  }).length;

  if (nameLike / samples.length >= 0.5) {
    return { score: 1.9, evidence: ["Sample values look like account or company names"] };
  }

  return { score: 0, evidence: [] };
}

function detectScoreLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  if (samples.length === 0) {
    return { score: 0, evidence: [] };
  }

  if (!/\b(score|rating|quality)\b/i.test(column.name)) {
    return { score: 0, evidence: [] };
  }

  if (column.kind === "numeric" && typeof column.min === "number" && typeof column.max === "number") {
    if (column.min >= 0 && column.max <= 100) {
      return { score: 2.1, evidence: ["Numeric range looks like a score or rating"] };
    }
    if (column.min >= 0 && column.max <= 5) {
      return { score: 1.9, evidence: ["Numeric range looks like a compact score or rating"] };
    }
  }

  return { score: 1.5, evidence: ["Column name suggests a score or rating field"] };
}

function detectChannelLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  const matches = samples.filter((sample) =>
    /(google|facebook|instagram|organic|direct|referral|paid|display|search|social|email)/i.test(sample)
  ).length;
  if (samples.length > 0 && matches / samples.length >= 0.4) {
    return { score: 1.6, evidence: ["Sample values look like marketing channels or traffic sources"] };
  }
  return { score: 0, evidence: [] };
}

function detectDeviceLikeValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  const matches = samples.filter((sample) => /(mobile|desktop|tablet|ios|android)/i.test(sample)).length;
  if (samples.length > 0 && matches / samples.length >= 0.5) {
    return { score: 1.4, evidence: ["Sample values look like device types"] };
  }
  return { score: 0, evidence: [] };
}

function detectCallStatusValues(column: DatasetColumnProfile) {
  const samples = collectSampleStrings(column);
  const matches = samples.filter((sample) =>
    /(answered|missed|no answer|voicemail|busy|failed|converted|qualified)/i.test(sample)
  ).length;
  if (samples.length > 0 && matches / samples.length >= 0.5) {
    return { score: 1.8, evidence: ["Sample values look like call outcomes or statuses"] };
  }
  return { score: 0, evidence: [] };
}

function collectSampleStrings(column: DatasetColumnProfile) {
  return unique(
    column.sampleValues
      .filter((value): value is string | number | boolean => value !== null)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .slice(0, 8)
  );
}

function isStrongDatetimeSample(sample: string) {
  if (!/(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})|(\d{1,2}:\d{2})|T\d{2}:\d{2}/.test(sample)) {
    return false;
  }

  return parseDateValue(sample) !== null;
}

function scoreKindMatch(column: DatasetColumnProfile, spec: RoleSpec) {
  if (!spec.expectedKinds || spec.expectedKinds.includes(column.kind)) {
    return {
      score: spec.expectedKinds?.length ? 1.2 : 0.4,
      evidence: spec.expectedKinds?.length ? [`Column type ${column.kind} matches expected shape`] : []
    };
  }

  if (spec.kind === "identifier" && column.kind === "numeric") {
    return { score: 0.5, evidence: ["Numeric identifiers are still plausible for this role"] };
  }

  return { score: -0.6, evidence: [`Column type ${column.kind} is weaker for this role`] };
}

function inferRoleMapping(column: DatasetColumnProfile): SemanticRoleMapping {
  const normalizedName = normalizeName(column.name);
  const nameTokens = tokenize(column.name);
  const hasTimeSignalInName = /\b(date|time|timestamp|datetime|created at|created|start|started|call datetime|call time|call date|call started at|timestamp local)\b/.test(
    normalizedName
  );
  const hasAccountSignalInName = /\b(account|client|customer|business|advertiser|brand|company)\b/.test(normalizedName);
  const hasRepeatCustomerSignalInName = /\b(repeat|returning|existing)\b/.test(normalizedName) && /\b(customer|caller)\b/.test(normalizedName);
  const hasRefSignalInName = /\b(ref|reference|uuid|interaction|session|enquiry|inquiry)\b/.test(normalizedName);
  const hasDirectionSignalInName = /\b(direction|call direction|call type|type)\b/.test(normalizedName);
  const hasRecordingSignalInName = /\b(recording|audio|ivr)\b/.test(normalizedName);
  const hasPaidMediaCostSignalInName = /\b(ad|media|campaign|marketing|paid)\b/.test(normalizedName) && /\b(cost|spend)\b/.test(normalizedName);
  const hasIdentifierSignalInName = nameTokens.includes("id") || /\b(id|identifier|number|no)\b/.test(normalizedName);
  const rankedCandidates: RankedRoleCandidate[] = ROLE_SPECS.map((spec) => {
    const aliasScores = spec.aliases
      .map((alias) => ({ alias, score: scoreColumnMatch(column.name, alias) }))
      .sort((left, right) => right.score - left.score);
    const bestAlias = aliasScores[0];
    const evidence: string[] = [];
    let score = bestAlias?.score ?? 0;

    if (bestAlias && bestAlias.score > 0) {
      evidence.push(`Column name matched "${bestAlias.alias}"`);
    }

    const kindMatch = scoreKindMatch(column, spec);
    score += kindMatch.score;
    evidence.push(...kindMatch.evidence);

    const valueSignal = spec.valueDetector?.(column);
    if (valueSignal && valueSignal.score > 0) {
      score += valueSignal.score;
      evidence.push(...valueSignal.evidence);
    }

    if (spec.kind === "datetime" && hasTimeSignalInName) {
      score += 1.6;
      evidence.push("Column name strongly suggests a time or datetime field");
    }

    if (spec.kind === "datetime" && hasAccountSignalInName) {
      score -= 2.2;
      evidence.push("Account-like naming weakens the datetime interpretation");
    }

    if (spec.key === "landingPage" && hasRecordingSignalInName) {
      score -= 2.8;
      evidence.push("Recording-style naming weakens the landing-page interpretation");
    }

    if (spec.kind === "datetime" && /\b(talk|handle|wait|ring|duration|seconds?|secs?)\b/.test(normalizedName)) {
      score -= 2;
      evidence.push("Duration-like wording weakens the datetime interpretation");
    }

    if (spec.kind === "datetime" && hasIdentifierSignalInName && !hasTimeSignalInName) {
      score -= 1.8;
      evidence.push("Identifier-like naming weakens the datetime interpretation");
    }

    if (spec.key === "callId" && hasRefSignalInName) {
      score += 1.5;
      evidence.push("Reference-like naming strongly suggests a call identifier");
    }

    if (spec.key === "callId" && !hasRefSignalInName && !/\b(call|interaction|lead|session|enquiry|inquiry)\b/.test(normalizedName)) {
      score -= 2.4;
      evidence.push("Call identifier inference needs a stronger call-specific naming signal");
    }

    if (spec.key === "callId" && hasDirectionSignalInName) {
      score -= 3.2;
      evidence.push("Direction-style naming weakens the call-identifier interpretation");
    }

    if (spec.key === "callStatus" && hasDirectionSignalInName) {
      score += 2.4;
      evidence.push("Direction-style naming strongly suggests a call status or outcome field");
    }

    if (["callerNumber", "trackingNumber", "destinationNumber"].includes(spec.key) && hasRefSignalInName) {
      score -= 1.3;
      evidence.push("Reference-like naming weakens phone-number interpretation");
    }

    if (spec.kind === "identifier" && hasTimeSignalInName) {
      score -= 1.2;
      evidence.push("Column name suggests time semantics, which weakens identifier roles");
    }

    if (spec.kind === "identifier") {
      if (nameTokens.includes("id")) {
        score += 0.8;
        evidence.push('Column name includes "id", which strengthens identifier roles');
      }
      if (column.uniqueCount >= Math.max(10, Math.floor(column.sampleValues.length * 0.8))) {
        score += 0.3;
        evidence.push("Column has identifier-like uniqueness");
      }
    }

    if (spec.key === "accountName" && hasAccountSignalInName) {
      score += 1.3;
      evidence.push("Account-like naming strongly suggests an account or client name");
    }

    if (spec.key === "repeatCaller" && hasRepeatCustomerSignalInName) {
      score += 2.3;
      evidence.push("Repeat-customer naming strongly suggests a repeat caller flag");
    }

    if (spec.key === "accountName" && hasRepeatCustomerSignalInName) {
      score -= 2.4;
      evidence.push("Repeat-customer naming weakens the account-name interpretation");
    }

    if (spec.key === "callRecordingUrl" && hasRecordingSignalInName) {
      score += 2.2;
      evidence.push("Recording-style naming strongly suggests a call recording URL");
    }

    if (spec.key === "spend" && hasPaidMediaCostSignalInName) {
      score += 1.8;
      evidence.push("Paid-media cost naming strongly suggests marketing spend");
    }

    if (spec.key === "cost" && hasPaidMediaCostSignalInName) {
      score -= 1.6;
      evidence.push("Paid-media cost naming is more specific to spend than generic cost");
    }

    return {
      spec,
      score,
      evidence
    };
  }).sort((left, right) => right.score - left.score);

  const winner = rankedCandidates[0];
  if (!winner || winner.score < 3.2) {
    return {
      rawColumn: column.name,
      semanticRole: null,
      confidence: 0,
      kind: "unknown",
      evidence: ["No semantic role cleared the confidence threshold"]
    };
  }

  return {
    rawColumn: column.name,
    semanticRole: winner.spec.key,
    confidence: Number(Math.min(0.99, winner.score / 7.5).toFixed(2)),
    kind: winner.spec.kind,
    evidence: winner.evidence
  };
}

function chooseBestRoleMappings(roleMappings: SemanticRoleMapping[]) {
  const bestByRole = new Map<string, SemanticRoleMapping>();

  for (const mapping of roleMappings) {
    if (!mapping.semanticRole) {
      continue;
    }
    const current = bestByRole.get(mapping.semanticRole);
    if (!current || mapping.confidence > current.confidence) {
      bestByRole.set(mapping.semanticRole, mapping);
    }
  }

  return bestByRole;
}

function augmentOutcomeFlagMappings(roleMappings: SemanticRoleMapping[], profile: DatasetProfile) {
  const columnsByName = new Map(profile.columns.map((column) => [column.name, column]));
  const candidateColumns = roleMappings
    .filter(
      (mapping) =>
        mapping.semanticRole === "callStatus" ||
        mapping.semanticRole === "callOutcome" ||
        normalizeName(mapping.rawColumn).includes("disposition") ||
        normalizeName(mapping.rawColumn).includes("direction")
    )
    .map((mapping) => columnsByName.get(mapping.rawColumn))
    .filter((column): column is DatasetColumnProfile => Boolean(column));

  const derivedMappings: SemanticRoleMapping[] = [];

  for (const column of candidateColumns) {
    const evidenceLabel = normalizeName(column.name).includes("direction") ? "Direction field" : "Outcome field";

    const qualifiedMapping = deriveOutcomeFlagMapping({
      column,
      semanticRole: "qualifiedCall",
      evidenceLabel
    });
    if (qualifiedMapping) {
      derivedMappings.push(qualifiedMapping);
    }

    const convertedMapping = deriveOutcomeFlagMapping({
      column,
      semanticRole: "convertedCall",
      evidenceLabel
    });
    if (convertedMapping) {
      derivedMappings.push(convertedMapping);
    }

    const missedMapping = deriveOutcomeFlagMapping({
      column,
      semanticRole: "missedCall",
      evidenceLabel
    });
    if (missedMapping) {
      derivedMappings.push(missedMapping);
    }

    const answeredMapping = deriveOutcomeFlagMapping({
      column,
      semanticRole: "answeredCall",
      evidenceLabel
    });
    if (answeredMapping) {
      derivedMappings.push(answeredMapping);
    }
  }

  return [...roleMappings, ...derivedMappings];
}

function buildMetricResolutionFromRole(mapping: SemanticRoleMapping, spec: RoleSpec): SemanticMetricResolution | null {
  if (!mapping.semanticRole || !spec.legacyMetricKey) {
    return null;
  }

  return {
    key: spec.legacyMetricKey,
    sourceColumns: [mapping.rawColumn],
    resolution: normalizeName(mapping.rawColumn) === normalizeName(spec.legacyMetricKey) ? "direct" : "alias",
    confidence: mapping.confidence,
    aggregation: "sum",
    formula:
      spec.legacyMetricKey === "callDuration" || spec.legacyMetricKey === "talkTime"
        ? `sum(${mapping.rawColumn})`
        : `sum(${mapping.rawColumn})`
  };
}

function buildDimensionResolutionFromRole(mapping: SemanticRoleMapping, spec: RoleSpec): SemanticDimensionResolution | null {
  if (!mapping.semanticRole || !spec.legacyDimensionKey) {
    return null;
  }

  return {
    key: spec.legacyDimensionKey,
    sourceColumns: [mapping.rawColumn],
    resolution: normalizeName(mapping.rawColumn) === normalizeName(spec.legacyDimensionKey) ? "direct" : "alias",
    confidence: mapping.confidence
  };
}

function buildDetectedCapabilities(roleMap: Map<string, SemanticRoleMapping>) {
  const capabilities: string[] = [];

  if (roleMap.has("callId")) {
    capabilities.push("call_volume");
  }
  if (roleMap.has("callerNumber") || roleMap.has("trackingNumber")) {
    capabilities.push("call_identity");
  }
  if (roleMap.has("callDuration") || roleMap.has("talkTime")) {
    capabilities.push("call_engagement");
  }
  if (roleMap.has("callTime") || roleMap.has("callOutcome") || roleMap.has("repeatCaller") || roleMap.has("location")) {
    capabilities.push("call_operations");
  }
  if (roleMap.has("callStatus") || roleMap.has("missedCall") || roleMap.has("answeredCall")) {
    capabilities.push("call_outcomes");
  }
  if (roleMap.has("qualifiedCall") || roleMap.has("convertedCall")) {
    capabilities.push("conversion_quality");
  }
  if (roleMap.has("channel") || roleMap.has("source") || roleMap.has("campaign") || roleMap.has("keyword")) {
    capabilities.push("marketing_attribution");
  }
  if (roleMap.has("spend")) {
    capabilities.push("spend_tracking");
  }
  if (roleMap.has("revenue")) {
    capabilities.push("revenue_tracking");
  }
  if (roleMap.has("revenue") && roleMap.has("spend")) {
    capabilities.push("roas_ready");
  }

  return [...new Set(capabilities)];
}

function detectDatasetDomain(roleMap: Map<string, SemanticRoleMapping>): SemanticDomainDetection {
  const callSignals = ["callId", "callerNumber", "trackingNumber", "callDateTime", "callDate", "callDuration", "callStatus", "qualifiedCall"];
  const marketingSignals = ["channel", "source", "campaign", "adGroup", "keyword", "spend", "revenue", "convertedCall"];
  const operationsSignals = ["callTime", "callerNumber", "destinationNumber", "callOutcome", "callDuration", "talkTime", "repeatCaller", "location"];
  const callScore = callSignals.reduce((sum, role) => sum + (roleMap.get(role)?.confidence ?? 0), 0) / callSignals.length;
  const marketingScore = marketingSignals.reduce((sum, role) => sum + (roleMap.get(role)?.confidence ?? 0), 0) / marketingSignals.length;
  const operationsScore = operationsSignals.reduce((sum, role) => sum + (roleMap.get(role)?.confidence ?? 0), 0) / operationsSignals.length;
  const operationsStrongCount = operationsSignals.filter((role) => (roleMap.get(role)?.confidence ?? 0) >= 0.45).length;
  const callStrongCount = callSignals.filter((role) => (roleMap.get(role)?.confidence ?? 0) >= 0.45).length;
  const marketingStrongCount = marketingSignals.filter((role) => (roleMap.get(role)?.confidence ?? 0) >= 0.45).length;
  const detectedCapabilities = buildDetectedCapabilities(roleMap);

  if ((callStrongCount >= 3 || callScore >= 0.3) && (marketingStrongCount >= 3 || marketingScore >= 0.3)) {
    return {
      domain: "mixed_call_tracking_attribution",
      confidence: Number(Math.min(0.98, (callScore + marketingScore) / 2 + 0.12).toFixed(2)),
      detectedCapabilities
    };
  }

  if (callStrongCount >= 3 || callScore >= 0.34) {
    return {
      domain: "call_tracking",
      confidence: Number(Math.min(0.97, callScore + 0.14).toFixed(2)),
      detectedCapabilities
    };
  }

  if ((operationsStrongCount >= 3 || operationsScore >= 0.24) && marketingScore < 0.2) {
    return {
      domain: "call_operations",
      confidence: Number(Math.min(0.96, operationsScore + 0.18).toFixed(2)),
      detectedCapabilities
    };
  }

  if (marketingStrongCount >= 3 || marketingScore >= 0.34) {
    return {
      domain: "marketing_attribution",
      confidence: Number(Math.min(0.97, marketingScore + 0.14).toFixed(2)),
      detectedCapabilities
    };
  }

  if (roleMap.has("revenue") || roleMap.has("region") || roleMap.has("clientName")) {
    return {
      domain: "generic_business",
      confidence: 0.58,
      detectedCapabilities
    };
  }

  return {
    domain: "unknown",
    confidence: 0.22,
    detectedCapabilities
  };
}

function buildKpiAvailability(roleMap: Map<string, SemanticRoleMapping>) {
  return KPI_DEFINITIONS.map((definition) => {
    const durationRoles = ["callDuration", "talkTime", "handleTime", "waitTime", "ringTime"];
    if (definition.key === "avg_call_duration" && durationRoles.some((role) => roleMap.has(role))) {
      return {
        key: definition.key,
        label: definition.label,
        status: "enabled" as const,
        requiredRoles: [...definition.requiredRoles],
        reason: `Duration field detected via ${durationRoles.filter((role) => roleMap.has(role)).join(", ")}`
      };
    }

    const missingRoles = definition.requiredRoles.filter((role) => !roleMap.has(role));
    if (missingRoles.length === 0) {
      return {
        key: definition.key,
        label: definition.label,
        status: "enabled" as const,
        requiredRoles: [...definition.requiredRoles],
        reason: "All required semantic roles were detected"
      };
    }

    return {
      key: definition.key,
      label: definition.label,
      status: "disabled" as const,
      requiredRoles: [...definition.requiredRoles],
      reason: `Missing semantic role${missingRoles.length > 1 ? "s" : ""}: ${missingRoles.join(", ")}`
    };
  });
}

function buildSafetyNormalizedRoleMappings(roleMappings: SemanticRoleMapping[], profile: DatasetProfile): {
  roleMappings: SemanticRoleMapping[];
  safetyWarnings: SemanticSafetyWarning[];
} {
  const columnsByName = new Map(profile.columns.map((column) => [column.name, column]));
  const safetyWarnings: SemanticSafetyWarning[] = [];

  const normalizedMappings = roleMappings.map((mapping): SemanticRoleMapping => {
    if (!mapping.semanticRole) {
      return mapping;
    }

    const column = columnsByName.get(mapping.rawColumn);
    if (!column) {
      return mapping;
    }

    if (FLAG_ROLE_KEYS.has(mapping.semanticRole)) {
      const saferMetricRole = inferSaferMetricRole(column);
      if ((hasMoneyValueSignal(column) || isContinuousNumericValueColumn(column)) && !isBooleanLikeColumn(column)) {
        const warning: SemanticSafetyWarning = {
          rawColumn: mapping.rawColumn,
          blockedRole: mapping.semanticRole,
          reason: `${mapping.rawColumn} looks monetary or continuous, not boolean-like.`,
          suggestedRole: saferMetricRole ?? undefined
        };
        safetyWarnings.push(warning);

        return {
          ...mapping,
          semanticRole: saferMetricRole,
          kind: saferMetricRole ? "metric" : "unknown",
          confidence: saferMetricRole ? Math.max(mapping.confidence, 0.78) : 0,
          evidence: [
            ...mapping.evidence,
            `Safety normalization blocked ${mapping.rawColumn} from ${warning.blockedRole} because values look monetary/continuous, not boolean-like`,
            ...(saferMetricRole ? [`Safety normalization rerouted the column to ${saferMetricRole}`] : [])
          ]
        };
      }
    }

    if (IDENTIFIER_ROLE_KEYS.has(mapping.semanticRole)) {
      const looksLikeDatetime = detectDatetimeLikeValues(column).score > 0 || /\b(date|time|timestamp|datetime|created|start)\b/.test(normalizeName(column.name));
      if (looksLikeDatetime) {
        const saferRole = inferSaferDatetimeRole(column);
        const warning: SemanticSafetyWarning = {
          rawColumn: mapping.rawColumn,
          blockedRole: mapping.semanticRole,
          reason: `${mapping.rawColumn} looks like a datetime field, not an identifier.`,
          suggestedRole: saferRole
        };
        safetyWarnings.push(warning);

        return {
          ...mapping,
          semanticRole: saferRole,
          kind: "datetime",
          confidence: Math.max(mapping.confidence, 0.8),
          evidence: [
            ...mapping.evidence,
            `Safety normalization blocked ${mapping.rawColumn} from ${warning.blockedRole} because the field looks datetime-like`,
            `Safety normalization rerouted the column to ${saferRole}`
          ]
        };
      }
    }

    return mapping;
  });

  return {
    roleMappings: normalizedMappings,
    safetyWarnings
  };
}

function parseFlagValue(value: PrimitiveValue, semanticRole?: string) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const numeric = parseNumber(value);
  if (numeric !== null && numeric >= 0 && numeric <= 1) {
    return numeric;
  }

  if (typeof value === "string") {
    const normalized = normalizeName(value);
    if (BOOLEAN_TRUE_VALUES.has(normalized)) {
      return 1;
    }
    if (BOOLEAN_FALSE_VALUES.has(normalized)) {
      return 0;
    }
  }

  if (semanticRole) {
    return classifyOutcomeSemanticRole(value, semanticRole);
  }

  return null;
}

export function buildSemanticDatasetContract(profile: DatasetProfile): SemanticDatasetContract {
  const initialRoleMappings = profile.columns.map(inferRoleMapping);
  const { roleMappings, safetyWarnings } = buildSafetyNormalizedRoleMappings(initialRoleMappings, profile);
  const augmentedRoleMappings = augmentOutcomeFlagMappings(roleMappings, profile);
  const bestRoleMappings = chooseBestRoleMappings(augmentedRoleMappings);
  const metricResolutions: Record<string, SemanticMetricResolution> = {};
  const dimensionResolutions: Record<string, SemanticDimensionResolution> = {};
  const sourceToCanonical: Record<string, string> = {};
  const sourceToSemanticRole: Record<string, string> = {};

  for (const mapping of augmentedRoleMappings) {
    if (mapping.semanticRole && !sourceToSemanticRole[normalizeName(mapping.rawColumn)]) {
      sourceToSemanticRole[normalizeName(mapping.rawColumn)] = mapping.semanticRole;
    }
  }

  for (const spec of ROLE_SPECS) {
    const mapping = bestRoleMappings.get(spec.key);
    if (!mapping) {
      continue;
    }

    const metricResolution = buildMetricResolutionFromRole(mapping, spec);
    if (metricResolution) {
      metricResolutions[metricResolution.key] = metricResolution;
      sourceToCanonical[normalizeName(mapping.rawColumn)] ??= metricResolution.key;
    }

    const dimensionResolution = buildDimensionResolutionFromRole(mapping, spec);
    if (dimensionResolution) {
      dimensionResolutions[dimensionResolution.key] = dimensionResolution;
      sourceToCanonical[normalizeName(mapping.rawColumn)] ??= dimensionResolution.key;
    }
  }

  const callIdMapping = bestRoleMappings.get("callId");
  if (callIdMapping) {
    metricResolutions.calls = {
      key: "calls",
      sourceColumns: [callIdMapping.rawColumn],
      resolution: "derived",
      confidence: callIdMapping.confidence,
      aggregation: "sum",
      formula: `count(${callIdMapping.rawColumn})`
    };
  }

  const spendMapping = bestRoleMappings.get("spend") ?? bestRoleMappings.get("cost") ?? null;
  const qualifiedMapping = bestRoleMappings.get("qualifiedCall") ?? null;
  const convertedMapping = bestRoleMappings.get("convertedCall") ?? null;
  const repeatMapping = bestRoleMappings.get("repeatCaller") ?? null;
  if (spendMapping && qualifiedMapping) {
    metricResolutions.cost_per_qualified_call = {
      key: "cost_per_qualified_call",
      sourceColumns: [spendMapping.rawColumn, qualifiedMapping.rawColumn],
      resolution: "derived",
      confidence: Number(Math.min(spendMapping.confidence, qualifiedMapping.confidence).toFixed(2)),
      aggregation: "ratio",
      denominatorMetric: "qualifiedCall",
      formula: `sum(${spendMapping.rawColumn}) / sum(${qualifiedMapping.rawColumn})`
    };
  }

  if (spendMapping && convertedMapping) {
    metricResolutions.cost_per_conversion = {
      key: "cost_per_conversion",
      sourceColumns: [spendMapping.rawColumn, convertedMapping.rawColumn],
      resolution: "derived",
      confidence: Number(Math.min(spendMapping.confidence, convertedMapping.confidence).toFixed(2)),
      aggregation: "ratio",
      denominatorMetric: "convertedCall",
      formula: `sum(${spendMapping.rawColumn}) / sum(${convertedMapping.rawColumn})`
    };
  }

  if (repeatMapping) {
    metricResolutions.repeat_caller_rate = {
      key: "repeat_caller_rate",
      sourceColumns: [repeatMapping.rawColumn],
      resolution: "derived",
      confidence: repeatMapping.confidence,
      aggregation: "ratio",
      denominatorMetric: "calls",
      formula: `sum(${repeatMapping.rawColumn}) / sum(calls)`
    };
  }

  if (metricResolutions.revenue && metricResolutions.spend) {
    metricResolutions.roas = {
      key: "roas",
      sourceColumns: [metricResolutions.revenue.sourceColumns[0], metricResolutions.spend.sourceColumns[0]],
      resolution: "derived",
      confidence: Number(Math.min(metricResolutions.revenue.confidence, metricResolutions.spend.confidence).toFixed(2)),
      aggregation: "ratio",
      denominatorMetric: "spend",
      formula: "sum(revenue) / sum(spend)"
    };
  }

  const detectedDomain = detectDatasetDomain(bestRoleMappings);
  const kpiAvailability = buildKpiAvailability(bestRoleMappings);

  return {
    metricResolutions,
    dimensionResolutions,
    availableMetrics: Object.keys(metricResolutions),
    availableDimensions: Object.keys(dimensionResolutions),
    derivedMetrics: Object.values(metricResolutions)
      .filter((resolution) => resolution.resolution === "derived")
      .map((resolution) => resolution.key),
    sourceToCanonical,
    sourceToSemanticRole,
    roleMappings: augmentedRoleMappings,
    detectedDomain,
    enabledKpis: kpiAvailability.filter((item) => item.status === "enabled"),
    disabledKpis: kpiAvailability.filter((item) => item.status === "disabled"),
    safetyWarnings
  };
}

function getRowMetricValue(row: DatasetRow, column: string) {
  return parseNumber(row[column]);
}

function sumRowColumns(row: DatasetRow, columns: string[]) {
  let total = 0;
  let found = false;
  for (const column of columns) {
    const value = getRowMetricValue(row, column);
    if (value === null) {
      continue;
    }
    total += value;
    found = true;
  }
  return found ? total : null;
}

export function firstAvailableMetricFromContract(contract: SemanticDatasetContract, candidates: string[]) {
  for (const candidate of candidates) {
    if (contract.availableMetrics.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveSemanticMetricSourceColumns(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  metric: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  return contract.metricResolutions[metric]?.sourceColumns ?? [];
}

export function resolveSemanticDimensionSourceColumn(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  dimension: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  return contract.dimensionResolutions[dimension]?.sourceColumns[0] ?? null;
}

export function resolveCanonicalMetricKey(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  metricOrSource: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const normalized = normalizeName(metricOrSource);
  const semanticRoleMap = contract.sourceToSemanticRole ?? {};
  return (
    contract.sourceToCanonical[normalized] ??
    semanticRoleMap[normalized] ??
    contract.metricResolutions[metricOrSource]?.key ??
    (normalized.includes("spend") || normalized.includes("cost") ? "spend" : null) ??
    (normalized.includes("revenue") || normalized.includes("sales value") ? "revenue" : null) ??
    metricOrSource
  );
}

export function resolveCanonicalDimensionKey(
  profileOrContract: DatasetProfile | SemanticDatasetContract,
  dimensionOrSource: string
) {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const normalized = normalizeName(dimensionOrSource);
  const semanticRoleMap = contract.sourceToSemanticRole ?? {};
  return contract.sourceToCanonical[normalized] ?? semanticRoleMap[normalized] ?? dimensionOrSource;
}

export function normalizeSemanticDimensionValue(
  value: PrimitiveValue,
  dimensionOrSource: string,
  profileOrContract?: DatasetProfile | SemanticDatasetContract
) {
  if (value === null || value === undefined) {
    return null;
  }

  const rawValue = String(value).trim();
  if (!rawValue) {
    return "";
  }

  const canonicalDimension = profileOrContract
    ? resolveCanonicalDimensionKey(profileOrContract, dimensionOrSource)
    : dimensionOrSource;
  const normalizedDimension = normalizeName(canonicalDimension);

  if (["channel", "source", "medium"].includes(normalizedDimension)) {
    for (const alias of CHANNEL_ALIAS_MAP) {
      if (alias.matchers.some((matcher) => matcher.test(rawValue.trim()))) {
        return alias.label;
      }
    }
  }

  return rawValue;
}

export function resolveSemanticMetricValue(
  row: DatasetRow,
  metric: string,
  profileOrContract: DatasetProfile | SemanticDatasetContract
): number | null {
  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const canonicalMetric = contract.metricResolutions[metric] ? metric : resolveCanonicalMetricKey(contract, metric);
  const resolution = contract.metricResolutions[canonicalMetric];
  const sourceColumns = resolution?.sourceColumns ?? [];

  if (canonicalMetric === "roas") {
    const revenue = resolveSemanticMetricValue(row, "revenue", contract);
    const spend = resolveSemanticMetricValue(row, "spend", contract);
    if (revenue === null || spend === null || spend === 0) {
      return null;
    }
    return Number((revenue / spend).toFixed(2));
  }

  if (canonicalMetric === "cost_per_qualified_call") {
    const spend = resolveSemanticMetricValue(row, "spend", contract);
    const qualifiedCall = resolveSemanticMetricValue(row, "qualifiedCall", contract);
    if (spend === null || qualifiedCall === null || qualifiedCall === 0) {
      return null;
    }
    return Number((spend / qualifiedCall).toFixed(2));
  }

  if (canonicalMetric === "cost_per_conversion") {
    const spend = resolveSemanticMetricValue(row, "spend", contract);
    const convertedCall = resolveSemanticMetricValue(row, "convertedCall", contract);
    if (spend === null || convertedCall === null || convertedCall === 0) {
      return null;
    }
    return Number((spend / convertedCall).toFixed(2));
  }

  if (canonicalMetric === "calls") {
    const sourceColumn = sourceColumns[0];
    if (sourceColumn && row[sourceColumn] !== null && row[sourceColumn] !== undefined && String(row[sourceColumn]).trim() !== "") {
      return 1;
    }
    if (contract.detectedDomain?.domain === "call_tracking" || contract.detectedDomain?.domain === "call_operations" || contract.detectedDomain?.domain === "mixed_call_tracking_attribution") {
      return 1;
    }
    return 0;
  }

  if (["qualifiedCall", "convertedCall", "missedCall", "answeredCall", "firstTimeCaller", "repeatCaller"].includes(canonicalMetric)) {
    const sourceColumn = sourceColumns[0];
    if (!sourceColumn) {
      return null;
    }
    const flagValue = parseFlagValue(row[sourceColumn], canonicalMetric);
    return flagValue === null ? null : flagValue;
  }

  if (sourceColumns.length > 0) {
    const total = sumRowColumns(row, sourceColumns);
    return total === null ? null : Number(total.toFixed(2));
  }

  const direct = parseNumber(row[metric]);
  return direct === null ? null : Number(direct.toFixed(2));
}

export function aggregateSemanticMetric(
  rows: DatasetRow[],
  metric: string,
  profileOrContract: DatasetProfile | SemanticDatasetContract
): number | null {
  if (rows.length === 0) {
    return null;
  }

  const contract = "metricResolutions" in profileOrContract ? profileOrContract : buildSemanticDatasetContract(profileOrContract);
  const canonicalMetric = contract.metricResolutions[metric] ? metric : resolveCanonicalMetricKey(contract, metric);
  const resolution = contract.metricResolutions[canonicalMetric];
  const aggregation = resolution?.aggregation ?? "sum";

  if (aggregation === "ratio") {
    const denominatorMetric = resolution?.denominatorMetric ?? null;
    const numeratorMetric =
      canonicalMetric === "roas"
        ? "revenue"
        : canonicalMetric === "cost_per_qualified_call"
          ? "spend"
          : canonicalMetric === "cost_per_conversion"
            ? "spend"
            : canonicalMetric === "repeat_caller_rate"
              ? "repeatCaller"
            : canonicalMetric;
    const resolvedDenominatorMetric =
      canonicalMetric === "cost_per_qualified_call"
        ? "qualifiedCall"
        : canonicalMetric === "cost_per_conversion"
          ? "convertedCall"
          : canonicalMetric === "repeat_caller_rate"
            ? "calls"
          : denominatorMetric;
    const numerator = aggregateSemanticMetric(rows, numeratorMetric, contract);
    const denominator = resolvedDenominatorMetric ? aggregateSemanticMetric(rows, resolvedDenominatorMetric, contract) : null;

    if (numerator === null || denominator === null || denominator === 0) {
      return null;
    }

    return Number((numerator / denominator).toFixed(2));
  }

  const values = rows
    .map((row) => resolveSemanticMetricValue(row, canonicalMetric, contract))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }

  if (
    canonicalMetric === "callDuration" ||
    canonicalMetric === "talkTime" ||
    canonicalMetric === "handleTime" ||
    canonicalMetric === "waitTime" ||
    canonicalMetric === "ringTime"
  ) {
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  }

  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(2));
}

export function metricFamily(metric: string): MetricAggregation {
  const normalized = normalizeName(metric);
  if (normalized.includes("roas") || normalized.includes("rate")) {
    return "ratio";
  }
  if (normalized.includes("duration") || normalized.includes("talk time")) {
    return "average";
  }
  return "sum";
}
