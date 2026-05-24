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
  charts: ChartConfig[];
  edaSummary: string;
  executiveSummary: {
    overview: string;
    kpiSummary: string;
    anomalySummary: string;
    trendSummary: string;
    suggestedQuestions: string[];
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

export interface QuestionContextInput {
  selectedDate?: string;
  selectedThreshold?: number;
  selectedMetric?: string;
  selectedDimension?: string;
  selectedCategory?: string;
  selectedSegmentA?: string;
  selectedSegmentB?: string;
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
}
