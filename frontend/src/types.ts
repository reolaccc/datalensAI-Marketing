export type PrimitiveValue = string | number | boolean | null;

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

export interface ColumnProfile {
  name: string;
  kind: "numeric" | "categorical" | "datetime";
  missingCount: number;
  uniqueCount: number;
  sampleValues: PrimitiveValue[];
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  topCategories?: Array<{ value: string; count: number }>;
}

export interface AnalysisResponse {
  analysisId: string;
  fileName: string;
  datasetSummary: {
    rowCount: number;
    columnCount: number;
    sheetName?: string;
  };
  profile: {
    rowCount: number;
    columnCount: number;
    duplicateRowCount: number;
    missingCells: number;
    numericColumns: string[];
    categoricalColumns: string[];
    datetimeColumns: string[];
    columns: ColumnProfile[];
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
  };
  kpis: Array<{
    id: string;
    label: string;
    column: string;
    confidence: number;
    summary: string;
    aggregateValue: number;
  }>;
  charts: Array<{
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
  }>;
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
  detectedIntent?: {
    primaryIntent: IntentType;
    secondaryIntents: IntentType[];
    targetMetrics: string[];
    targetDimensions: string[];
    timeRequired: boolean;
    comparisonRequired: boolean;
    anomalyRequired: boolean;
    confidence: number;
    matchedKeywords: string[];
  };
  analysisSummary?: string;
  chartSelectionSummary?: string;
  missingFieldWarnings?: string[];
  suggestedFollowUps?: string[];
  recommendedCharts?: AnalysisResponse["charts"];
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

export interface PinnedInsight extends QuestionAnswer {
  id: string;
  pinnedAt: string;
}

export interface WorkspaceSnapshot {
  id: string;
  label: string;
  fileName: string;
  savedAt: string;
  analysis: AnalysisResponse;
  questionAnswer: QuestionAnswer | null;
  questionHistory: QuestionAnswer[];
  pinnedInsights: PinnedInsight[];
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
