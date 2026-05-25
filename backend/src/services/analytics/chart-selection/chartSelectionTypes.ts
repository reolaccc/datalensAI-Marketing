import type {
  ChartConfig,
  DatasetCapabilities,
  DatasetProfile,
  DatasetRow,
  IntentDetectionResult,
  KpiCandidate,
  SemanticBusinessIntentAnalysis
} from "../../../analytics/types.js";
import type { QuestionContextInput } from "../../../analytics/types.js";

export type ChartSemanticRole =
  | "main_answer"
  | "supporting_comparison"
  | "trend_or_distribution"
  | "diagnostic";

export type ChartAnalysisRole =
  | "trend"
  | "comparison"
  | "composition"
  | "efficiency"
  | "relationship"
  | "funnel"
  | "anomaly"
  | "distribution"
  | "diagnostic";

export interface ChartBlueprint {
  id: string;
  title: string;
  chartType: ChartConfig["chartType"];
  intent: ChartConfig["intent"];
  description: string;
  reason: string;
  whyThisChart: string;
  metric?: string | null;
  dimension?: string | null;
  groupBy?: string | null;
  xAxis?: string | null;
  yAxis?: string | null;
  sort?: "asc" | "desc" | null;
  limit?: number;
  filters?: ChartConfig["filters"];
  priority: number;
  semanticRole: ChartSemanticRole;
  analysisRole?: ChartAnalysisRole;
  secondaryMetric?: string | null;
  businessQuestionAnswered?: string;
  score?: number;
}

export interface ChartSelectionContext {
  question: string;
  rows: DatasetRow[];
  profile: DatasetProfile;
  kpis: KpiCandidate[];
  capabilities: DatasetCapabilities;
  intent: IntentDetectionResult;
  semanticProfile?: SemanticBusinessIntentAnalysis;
  input?: QuestionContextInput;
}
