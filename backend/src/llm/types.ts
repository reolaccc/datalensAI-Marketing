import type {
  ChartConfig,
  DatasetProfile,
  DatasetRow,
  IntentDetectionResult,
  KpiCard,
  KpiCandidate,
  PrimitiveValue,
  QuestionContextInput,
  SemanticBusinessIntentAnalysis,
  TrustedQuestionFacts
} from "../analytics/types.js";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmTextGenerationRequest {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface LlmTextGenerationResult {
  text: string;
  raw?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface LlmProvider {
  name: string;
  generateText(request: LlmTextGenerationRequest): Promise<LlmTextGenerationResult>;
}

export function createDisabledLlmProvider(): LlmProvider {
  return {
    name: "disabled",
    async generateText() {
      throw new Error("No LLM provider is configured.");
    }
  };
}

export interface AnalyticsFacts {
  semanticContract?: DatasetProfile["semanticContract"];
  datasetSummary: {
    fileName: string;
    rowCount: number;
    columnCount: number;
    missingCells: number;
    duplicateRows: number;
    warnings: string[];
    dataSummaryNotes?: string[];
  };
  kpis: {
    totalRevenue?: number;
    totalCost?: number;
    totalClicks?: number;
    totalImpressions?: number;
    overallRoas?: number;
    overallConversionRate?: number;
    additionalMetrics: Array<{ name: string; value: number }>;
  };
  kpiCards: Array<Pick<KpiCard, "label" | "formattedValue" | "metricType" | "description" | "reliability" | "warnings" | "relatedDimension" | "contextLine" | "formula">>;
  concentration: {
    top1RevenueShare?: number;
    top3RevenueShare?: number;
    top1RevenueEntity?: {
      dimension: string;
      name: string;
      revenue: number;
      share: number;
    };
    top3RevenueEntities?: Array<{
      dimension: string;
      name: string;
      revenue: number;
      share: number;
    }>;
  };
  rankings: {
    topRevenueEntities: Array<{
      dimension: string;
      name: string;
      revenue: number;
      share?: number;
    }>;
    topRoasEntities: Array<{
      dimension: string;
      name: string;
      roas: number;
      deltaFromAverage?: number;
    }>;
    topConversionEntities: Array<{
      dimension: string;
      name: string;
      conversionRate: number;
    }>;
    bottomRevenueEntities: Array<{
      dimension: string;
      name: string;
      revenue: number;
      share?: number;
    }>;
    bottomRoasEntities: Array<{
      dimension: string;
      name: string;
      roas: number;
    }>;
  };
  comparisons: {
    revenueVsEfficiencyMismatches: Array<{
      highRevenueName: string;
      highRevenueValue: number;
      highRevenueShare?: number;
      lowerEfficiencyName?: string;
      lowerEfficiencyValue?: number;
      note: string;
    }>;
    benchmarkComparison: Array<{
      dimension: string;
      name: string;
      revenue?: number;
      roas?: number;
      conversionRate?: number;
      vsAverage?: string;
    }>;
  };
  segments: {
    strongestSegment?: {
      dimension: string;
      name: string;
      metric: string;
      value: number;
    };
    weakestSegment?: {
      dimension: string;
      name: string;
      metric: string;
      value: number;
    };
    segmentSpread?: {
      metric: string;
      maxValue: number;
      minValue: number;
      ratio?: number;
    };
  };
  trends: {
    hasDateField: boolean;
    recentDirection?: "up" | "down" | "flat" | "mixed";
    recentChange?: {
      metric: string;
      absoluteChange: number;
      percentChange?: number;
      periodLabel: string;
    };
  };
  qualitySignals: {
    hasMissingData: boolean;
    hasDuplicates: boolean;
    otherWarnings: string[];
  };
  topFindings: {
    topRevenueSegment?: {
      dimension: string;
      name: string;
      revenue: number;
      share: number;
    };
    bestRoasSegment?: {
      dimension: string;
      name: string;
      roas: number;
    };
    bestConversionSegment?: {
      dimension: string;
      name: string;
      conversionRate: number;
    };
    weakestSegment?: {
      dimension: string;
      name: string;
      reason: string;
      metric?: string;
      value?: number;
    };
  };
  charts: Array<{
    id: string;
    title: string;
    chartType: ChartConfig["chartType"];
    intent: ChartConfig["intent"];
    analysisRole?: ChartConfig["analysisRole"];
    businessArea?: ChartConfig["businessArea"];
    semanticSignature?: string;
    metric?: string | null;
    dimension?: string | null;
    reasonCode: string;
    reason: string;
    dataPreview: Array<Record<string, PrimitiveValue>>;
    keyObservation?: string;
  }>;
  profile: {
    numericColumns: string[];
    categoricalColumns: string[];
    datetimeColumns: string[];
    outliers: DatasetProfile["outliers"];
    correlations: DatasetProfile["correlations"];
  };
  recommendedActions: string[];
  chartContext: Array<{
    title: string;
    chartType: ChartConfig["chartType"];
    analysisRole?: ChartConfig["analysisRole"];
    semanticSignature?: string;
    metric: string;
    dimension?: string | null;
    reasonCode: string;
    keyObservation?: string;
  }>;
}

export interface ExecutiveInsightNarrative {
  bullets: string[];
  suggestedQuestions: string[];
  warning?: string;
  source: "llm" | "fallback";
}

export interface ChartExplanationNarrative {
  id: string;
  explanation: string;
}

export interface AskAnswerNarrative {
  directAnswer: string;
  evidence: string[];
  caution?: string;
  suggestedNextQuestion?: string;
  analysisSummary: string;
  chartSelectionSummary: string;
  confidenceNote?: string;
  warning?: string;
  source: "llm" | "fallback";
}

export interface ExecutiveInsightInput {
  fileName: string;
  edaSummary: string;
  profile: DatasetProfile;
  kpis: KpiCandidate[];
  charts: ChartConfig[];
}

export interface QuestionNarrativeInput {
  question: string;
  answer: string;
  trustedQuestionFacts?: TrustedQuestionFacts;
  detectedIntent?: IntentDetectionResult;
  semanticProfile?: SemanticBusinessIntentAnalysis;
  semanticContract?: DatasetProfile["semanticContract"];
  conversationHistory?: Array<{
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
  }>;
  supportingData: Array<{ label: string; value: string | number }>;
  resultTable?: {
    columns: string[];
    rows: Record<string, PrimitiveValue>[];
  };
  datasetSchema: Array<{
    name: string;
    kind: string;
    sampleValues: PrimitiveValue[];
    min?: number | string;
    max?: number | string;
    mean?: number;
    median?: number;
    topCategories?: Array<{ value: string; count: number }>;
  }>;
  sampleRows: Record<string, PrimitiveValue>[];
  chartSelectionSummary: string;
  chartSelectionExplanation: string;
  chartSelectionWarnings: string[];
  suggestedFollowUps: string[];
  recommendedCharts?: ChartConfig[];
  context?: QuestionContextInput;
  facts: AnalyticsFacts;
}
