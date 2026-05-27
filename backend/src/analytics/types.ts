import type { CleanedDatasetProfile } from "./normalization/types.js";

export type PrimitiveValue = string | number | boolean | null;

export type DatasetRow = Record<string, PrimitiveValue>;

export type ColumnKind = "numeric" | "categorical" | "datetime";

export interface DatasetColumnProfile {
  name: string;
  kind: ColumnKind;
  missingCount: number;
  uniqueCount: number;
  sampleValues: PrimitiveValue[];
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  topCategories?: Array<{ value: string; count: number }>;
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  duplicateRowCount: number;
  missingCells: number;
  numericColumns: string[];
  categoricalColumns: string[];
  datetimeColumns: string[];
  columns: DatasetColumnProfile[];
  outliers: Array<{
    column: string;
    count: number;
    min: number;
    max: number;
  }>;
  correlations: Array<{
    x: string;
    y: string;
    coefficient: number;
  }>;
  normalizedProfile?: CleanedDatasetProfile;
  semanticContract?: SemanticDatasetContract;
}

export interface SemanticMetricResolution {
  key: string;
  sourceColumns: string[];
  resolution: "direct" | "alias" | "derived";
  confidence: number;
  aggregation: "sum" | "ratio" | "difference" | "average";
  formula?: string;
  denominatorMetric?: string;
}

export interface SemanticDimensionResolution {
  key: string;
  sourceColumns: string[];
  resolution: "direct" | "alias" | "derived";
  confidence: number;
}

export interface SemanticDatasetContract {
  metricResolutions: Record<string, SemanticMetricResolution>;
  dimensionResolutions: Record<string, SemanticDimensionResolution>;
  availableMetrics: string[];
  availableDimensions: string[];
  derivedMetrics: string[];
  sourceToCanonical: Record<string, string>;
  sourceToSemanticRole?: Record<string, string>;
  roleMappings?: Array<{
    rawColumn: string;
    semanticRole: string | null;
    confidence: number;
    kind: "metric" | "dimension" | "datetime" | "identifier" | "flag" | "value" | "unknown";
    evidence: string[];
  }>;
  detectedDomain?: {
    domain:
      | "call_tracking"
      | "call_operations"
      | "marketing_attribution"
      | "mixed_call_tracking_attribution"
      | "generic_business"
      | "unknown";
    confidence: number;
    detectedCapabilities: string[];
  };
  enabledKpis?: Array<{
    key: string;
    label: string;
    status: "enabled" | "disabled";
    requiredRoles: string[];
    reason: string;
  }>;
  disabledKpis?: Array<{
    key: string;
    label: string;
    status: "enabled" | "disabled";
    requiredRoles: string[];
    reason: string;
  }>;
  safetyWarnings?: Array<{
    rawColumn: string;
    blockedRole: string;
    reason: string;
    suggestedRole?: string;
  }>;
}

export interface KpiCandidate {
  id: string;
  label: string;
  column: string;
  confidence: number;
  summary: string;
  aggregateValue: number;
}

export type KpiMetricType = "currency" | "percentage" | "count" | "ratio" | "rate" | "duration" | "generic_number";

export type KpiReliability = "high" | "medium" | "low";

export interface KpiCard {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  unit: string;
  metricType: KpiMetricType;
  description: string;
  formula: string;
  reliability: KpiReliability;
  priority: number;
  warnings?: string[];
  relatedDimension?: string;
  contextLine?: string;
}

export type IntentType =
  | "trend_analysis"
  | "comparison"
  | "ranking"
  | "anomaly_detection"
  | "correlation"
  | "distribution"
  | "segmentation"
  | "efficiency_analysis"
  | "funnel_analysis"
  | "data_quality"
  | "general_overview";

export interface IntentDetectionResult {
  primaryIntent: IntentType;
  secondaryIntents: IntentType[];
  targetMetrics: string[];
  targetDimensions: string[];
  explicitDimensionMention?: string | null;
  timeRequired: boolean;
  comparisonRequired: boolean;
  anomalyRequired: boolean;
  confidence: number;
  matchedKeywords: string[];
}

export type SemanticBusinessIntent =
  | "high_potential"
  | "best_performing"
  | "scalable"
  | "efficient"
  | "underperforming"
  | "wasting_budget"
  | "growth_opportunity"
  | "neutral";

export interface SemanticMetricSignal {
  metric: string;
  direction: "high" | "low";
  weight: number;
}

export interface SemanticBusinessIntentAnalysis {
  businessIntent: SemanticBusinessIntent;
  matchedPhrases: string[];
  metricSignals: SemanticMetricSignal[];
  dimensionHints: string[];
  confidence: number;
  summary: string;
}

export interface DatasetCapabilities {
  numericMetrics: string[];
  categoricalDimensions: string[];
  datetimeFields: string[];
  kpiCandidates: string[];
  segmentFields: string[];
  comparisonFields: string[];
  anomalyFields: string[];
  derivedMetrics: string[];
  defaultMetric: string | null;
  defaultDimension: string | null;
  defaultDateDimension?: string | null;
  funnelStageFields: string[];
  semanticContract?: SemanticDatasetContract;
}

export interface ChartConfig {
  id: string;
  title: string;
  subtitle?: string;
  semanticSignature?: string;
  businessArea?:
    | "volume"
    | "quality"
    | "conversion"
    | "efficiency"
    | "outcome"
    | "operations";
  analysisRole?:
    | "trend"
    | "comparison"
    | "composition"
    | "efficiency"
    | "relationship"
    | "funnel"
    | "anomaly"
    | "distribution"
    | "diagnostic";
  chartType:
    | "kpi_card"
    | "line"
    | "bar"
    | "horizontal_bar"
    | "stacked_bar"
    | "scatter"
    | "histogram"
    | "box_plot"
    | "donut"
    | "heatmap"
    | "funnel"
    | "anomaly_trend";
  intent: IntentType;
  description: string;
  reason: string;
  whyThisChart: string;
  recommendations?: string[];
  xAxis: string;
  yAxis?: string;
  metric?: string | null;
  dimension?: string | null;
  groupBy?: string | null;
  sort?: "asc" | "desc" | null;
  limit: number;
  filters: Array<{
    column: string;
    operator: "eq" | "gt" | "gte" | "lt" | "lte" | "after" | "before";
    value: string | number;
  }>;
  xKey: string;
  yKey?: string;
  series?: string[];
  data: Record<string, PrimitiveValue>[];
}

export interface AnalysisResult {
  analysisId: string;
  fileName: string;
  dataSummaryNotes?: string[];
  datasetSummary: {
    rowCount: number;
    columnCount: number;
    sheetName?: string;
  };
  profile: DatasetProfile;
  kpis: KpiCandidate[];
  kpiCards: KpiCard[];
  charts: ChartConfig[];
  edaSummary: string;
  executiveSummary: {
    overview: string;
    kpiSummary: string;
    anomalySummary: string;
    trendSummary: string;
    suggestedQuestions: string[];
    bullets?: string[];
    warning?: string;
    source?: "llm" | "fallback";
  };
}

export interface QuestionAnswer {
  question: string;
  answer: string;
  interpretation?: string;
  detectedIntent?: IntentDetectionResult;
  analysisSummary?: string;
  chartSelectionSummary?: string;
  missingFieldWarnings?: string[];
  suggestedFollowUps?: string[];
  recommendedCharts?: ChartConfig[];
  narrative?: {
    directAnswer: string;
    evidence: string[];
    caution?: string;
    suggestedNextQuestion?: string;
    confidenceNote?: string;
    warning?: string;
    source: "llm" | "fallback";
  };
  supportingData: Array<{
    label: string;
    value: string | number;
  }>;
  resultTable?: {
    columns: string[];
    rows: Record<string, PrimitiveValue>[];
  };
  chartSuggestion?: {
    chartType: "line" | "bar" | "table";
    xKey: string;
    yKey: string;
    series?: string[];
    data: Record<string, PrimitiveValue>[];
  };
}

export interface ConversationTurnContext {
  question: string;
  answer: string;
  interpretation?: string;
  detectedIntent?: IntentDetectionResult;
  chartSuggestion?: {
    chartType: "line" | "bar" | "table";
    xKey: string;
    yKey: string;
    series?: string[];
  };
}

export interface QuestionContextInput {
  selectedDate?: string;
  selectedThreshold?: number;
  selectedMetric?: string;
  selectedDimension?: string;
  selectedCategory?: string;
  selectedSegmentA?: string;
  selectedSegmentB?: string;
  useAi?: boolean;
  conversationHistory?: ConversationTurnContext[];
}

export type GroundingStatus = "strong" | "partial" | "weak" | "unsupported";

export interface GroundingConfidence {
  overall: GroundingStatus;
  metricGrounding: {
    status: GroundingStatus;
    requestedMetrics: string[];
    groundedMetrics: string[];
    missingMetrics: string[];
    weakMetrics: string[];
    reasons: string[];
  };
  dimensionGrounding: {
    status: GroundingStatus;
    requestedDimensions: string[];
    groundedDimensions: string[];
    missingDimensions: string[];
    weakDimensions: string[];
    reasons: string[];
  };
  relationshipGrounding: {
    status: GroundingStatus;
    relationshipType?:
      | "single_metric"
      | "metric_vs_metric"
      | "relative_to"
      | "while"
      | "without_matching"
      | "trend_shift"
      | "concentration"
      | "unknown";
    requiredMetrics: string[];
    supportedMetrics: string[];
    unsupportedMetrics: string[];
    reasons: string[];
  };
  reliabilityGrounding: {
    status: GroundingStatus;
    coverageWarnings: string[];
    ratioWarnings: string[];
    semanticWarnings: string[];
    reasons: string[];
  };
}

export interface TrustedQuestionFacts {
  question: string;
  routing: {
    mode: "standard" | "trust";
    reasons: string[];
  };
  resolvedIntent: {
    intent: string;
    requestedMetrics: string[];
    requestedDimensions: string[];
    answeredMetric?: string | null;
    semanticBusinessIntent?: string;
  };
  semanticAlignment: {
    requestedMetrics: string[];
    answeredMetric?: string | null;
    status: "strong" | "partial" | "weak" | "none";
    reason: string;
  };
  groundingConfidence: GroundingConfidence;
  answerability: {
    status: "answerable" | "unsupported" | "weak";
    reasons: string[];
    caution?: string;
  };
  answer: {
    mode: "summary" | "ranking" | "trend" | "comparison" | "anomaly";
    directAnswer: string;
    interpretation: string;
    supportingData: Array<{
      label: string;
      value: string | number;
    }>;
    resultTable?: {
      columns: string[];
      rows: Record<string, PrimitiveValue>[];
    };
  };
  evidence: {
    primaryMetric?: string | null;
    primaryDimension?: string | null;
    metricsUsed: string[];
    dimensionsUsed: string[];
    trustFlags: string[];
  };
  chartSupportRequest?: {
    kind: "bar" | "line" | "table" | "none";
    metric: string | null;
    dimension: string | null;
    sort?: "asc" | "desc" | null;
    limit?: number;
  };
}

export interface PlannedQuery {
  intent:
    | "top_segment"
    | "trend"
    | "anomaly"
    | "summary"
    | "compare_segments"
    | "compare_trend"
    | "dimension_trend"
    | "aggregate_segments";
  metric: string | null;
  metrics: string[];
  dimension: string | null;
  datetimeColumn: string | null;
  aggregateOperation: "sum" | "average" | "min" | "max";
  sortDirection: "asc" | "desc";
  limit: number;
  filters: Array<{
    column: string;
    operator: "eq" | "gt" | "gte" | "lt" | "lte" | "after" | "before";
    value: string | number;
  }>;
  comparisonValues: string[];
  semanticProfile?: SemanticBusinessIntentAnalysis;
  unavailableMetricReasons?: string[];
  explicitMetrics?: string[];
  semanticMetrics?: string[];
}
