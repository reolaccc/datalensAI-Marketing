import type { DatasetProfile, KpiCandidate } from "../analytics/types.js";
import type { LlmMessage, LlmTextGenerationRequest } from "../providers/llmProvider.js";

export interface ExecutiveSummaryPromptInput {
  fileName: string;
  edaSummary: string;
  profile: DatasetProfile;
  kpis: KpiCandidate[];
}

export interface ExecutiveSummaryPromptOutput {
  overview: string;
  kpiSummary: string;
  anomalySummary: string;
  trendSummary: string;
  suggestedQuestions: string[];
}

export function buildExecutiveSummaryPrompt(input: ExecutiveSummaryPromptInput): LlmTextGenerationRequest {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "You are an analytics copilot. Return only valid JSON for an executive summary grounded in the dataset profile. Do not invent facts. Use concise business language."
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          fileName: input.fileName,
          rowCount: input.profile.rowCount,
          columnCount: input.profile.columnCount,
          numericColumns: input.profile.numericColumns,
          categoricalColumns: input.profile.categoricalColumns,
          datetimeColumns: input.profile.datetimeColumns,
          missingCells: input.profile.missingCells,
          duplicateRowCount: input.profile.duplicateRowCount,
          outliers: input.profile.outliers.slice(0, 5),
          correlations: input.profile.correlations.slice(0, 5),
          kpis: input.kpis.slice(0, 5),
          edaSummary: input.edaSummary,
          outputSchema: {
            overview: "string",
            kpiSummary: "string",
            anomalySummary: "string",
            trendSummary: "string",
            suggestedQuestions: ["string"]
          }
        },
        null,
        2
      )
    }
  ];

  return {
    model: "analytics-copilot-summary",
    messages,
    temperature: 0.2,
    maxTokens: 500,
    responseFormat: "json"
  };
}
