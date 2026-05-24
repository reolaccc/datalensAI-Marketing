import type { ChartConfig, DatasetProfile, DatasetRow, IntentDetectionResult, KpiCandidate, PrimitiveValue, QuestionContextInput } from "../analytics/types.js";

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
  datasetSummary: {
    fileName: string;
    rowCount: number;
    columnCount: number;
    missingCells: number;
    duplicateRows: number;
    warnings: string[];
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
    weakestSegment?: {
      dimension: string;
      name: string;
      reason: string;
    };
  };
  charts: Array<{
    id: string;
    title: string;
    chartType: ChartConfig["chartType"];
    intent: ChartConfig["intent"];
    metric?: string | null;
    dimension?: string | null;
    reasonCode: string;
    reason: string;
    dataPreview: Array<Record<string, PrimitiveValue>>;
  }>;
  profile: {
    numericColumns: string[];
    categoricalColumns: string[];
    datetimeColumns: string[];
    outliers: DatasetProfile["outliers"];
    correlations: DatasetProfile["correlations"];
  };
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
  detectedIntent?: IntentDetectionResult;
  supportingData: Array<{ label: string; value: string | number }>;
  resultTable?: {
    columns: string[];
    rows: Record<string, PrimitiveValue>[];
  };
  chartSelectionSummary: string;
  chartSelectionExplanation: string;
  chartSelectionWarnings: string[];
  suggestedFollowUps: string[];
  recommendedCharts?: ChartConfig[];
  context?: QuestionContextInput;
  facts: AnalyticsFacts;
}
