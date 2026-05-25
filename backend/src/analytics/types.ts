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
  funnelStageFields: string[];
}

export interface ChartConfig {
  id: string;
  title: string;
  subtitle?: string;
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
}
