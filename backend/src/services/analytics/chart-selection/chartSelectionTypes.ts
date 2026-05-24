import type {
  ChartConfig,
  DatasetCapabilities,
  DatasetProfile,
  DatasetRow,
  IntentDetectionResult,
  KpiCandidate
} from "../../../analytics/types.js";
import type { QuestionContextInput } from "../../../analytics/types.js";

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
  semanticRole: "main_answer" | "supporting_comparison" | "trend_or_distribution" | "diagnostic";
  secondaryMetric?: string | null;
}

export interface ChartSelectionContext {
  question: string;
  rows: DatasetRow[];
  profile: DatasetProfile;
  kpis: KpiCandidate[];
  capabilities: DatasetCapabilities;
  intent: IntentDetectionResult;
  input?: QuestionContextInput;
}
