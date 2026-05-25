import type { ChartConfig } from "../analytics/types.js";
import type { AnalyticsFacts, AskAnswerNarrative, ExecutiveInsightNarrative, QuestionNarrativeInput } from "./types.js";
import type { LlmMessage, LlmTextGenerationRequest } from "./types.js";

function buildSystemPrompt(scope: string) {
  return [
    "You are a senior data analyst and performance marketing lead.",
    "Write for business stakeholders, not for developers.",
    "Use only the provided structured facts.",
    "Do not invent numbers, labels, or relationships.",
    "Do not recalculate metrics or infer unsupported values.",
    "Do not mention a metric unless it appears in the input facts.",
    "If evidence is insufficient, say so plainly.",
    "Keep the tone concise, specific, and commercially useful.",
    "Every insight must include at least one metric or dimension.",
    "Do not discuss EDA, profiling, missing values, duplicates, or data quality issues in Executive Insight.",
    `Task focus: ${scope}.`
  ].join(" ");
}

function baseJsonInstruction(outputSchema: Record<string, unknown>) {
  return JSON.stringify(
    {
      instruction: "Return only valid JSON.",
      outputSchema
    },
    null,
    2
  );
}

export function buildExecutiveInsightPrompt(facts: AnalyticsFacts): LlmTextGenerationRequest {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt("executive insight generation")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          facts,
          desiredStyle: {
            bullets: "3-6 short bullets",
            tone: "senior data analyst and marketing staff",
            expectations: [
              "focus first on commercial implications and decision guidance",
              "mention specific metrics and dimensions",
              "prioritize concentration, efficiency tradeoffs, rank gaps, and budget implications",
              "compare performance where possible",
              "mention trend direction if available",
              "use the provided chart context and recommended actions when helpful",
              "include a cautious recommendation",
              "make sure each bullet covers a distinct business theme and do not repeat the same viewpoint across bullets",
              "do not mention EDA or data quality issues"
            ]
          },
          outputSchema: {
            bullets: ["string"],
            suggestedQuestions: ["string"],
            warning: "string"
          },
          responseContract: baseJsonInstruction({
            bullets: ["string"],
            suggestedQuestions: ["string"],
            warning: "string"
          })
        },
        null,
        2
      )
    }
  ];

  return {
    model: "analytics-narrative",
    messages,
    temperature: 0.2,
    maxTokens: 500,
    responseFormat: "json"
  };
}

export function buildChartExplanationsPrompt(
  facts: AnalyticsFacts,
  charts: ChartConfig[],
  question?: string
): LlmTextGenerationRequest {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt("chart explanation generation")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          question: question ?? null,
          facts,
          charts: charts.map((chart) => ({
            id: chart.id,
            title: chart.title,
            subtitle: chart.subtitle ?? null,
            chartType: chart.chartType,
            metric: chart.metric,
            dimension: chart.dimension,
            reason: chart.reason,
            whyThisChart: chart.whyThisChart,
            dataPreview: chart.data.slice(0, 3)
          })),
          requirements: [
            "Write like a modern BI product for marketing and sales teams.",
            "Do not say 'this chart compares', 'this bar chart', or explain chart mechanics.",
            "Lead with the business meaning, not the chart type.",
            "Use the actual metric values, units, and segment names when available.",
            "Mention trends, concentration, efficiency gaps, anomalies, or trade-offs when the data supports it.",
            "Keep each explanation to 1-2 short paragraphs or up to 3 bullets.",
            "If confidence is low, be careful and avoid overstating the pattern.",
            "Use only the provided facts."
          ],
          outputSchema: {
            charts: [
              {
                id: "string",
                explanation: "string"
              }
            ]
          }
        },
        null,
        2
      )
    }
  ];

  return {
    model: "analytics-narrative",
    messages,
    temperature: 0.2,
    maxTokens: 900,
    responseFormat: "json"
  };
}

export function buildAskAnswerPrompt(input: QuestionNarrativeInput): LlmTextGenerationRequest {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt("question answering and business narrative generation")
    },
    {
      role: "user",
      content: JSON.stringify(
          {
          question: input.question,
          deterministicAnswer: input.answer,
          detectedIntent: input.detectedIntent ?? null,
          semanticProfile: input.semanticProfile ?? null,
          supportingData: input.supportingData,
          datasetSchema: input.datasetSchema,
          sampleRows: input.sampleRows,
          resultTablePreview: input.resultTable
            ? {
                columns: input.resultTable.columns,
                rows: input.resultTable.rows.slice(0, 8)
              }
            : null,
          chartSelectionSummary: input.chartSelectionSummary,
          chartSelectionExplanation: input.chartSelectionExplanation,
          chartSelectionWarnings: input.chartSelectionWarnings,
          suggestedFollowUps: input.suggestedFollowUps,
          recommendedCharts: input.recommendedCharts?.map((chart) => ({
            id: chart.id,
            title: chart.title,
            chartType: chart.chartType,
            metric: chart.metric,
            dimension: chart.dimension,
            reason: chart.reason
          })),
          context: input.context ?? null,
          facts: input.facts,
          requirements: [
            "Use the deterministic answer as the factual basis.",
            "Do not change the numbers or invent new ones.",
            "Use the detected semantic business intent, dataset schema, and sampled rows to interpret the user's meaning when the wording is indirect.",
            "When the question is a business intent question such as potential, best performing, efficient, scalable, underperforming, or wasting budget, rank the relevant entities using multiple metrics instead of relying on a single metric.",
            "Never return raw fallback or debug text such as 'AI explanation unavailable' or 'could not identify numeric metric'.",
            "Write like a senior analyst explaining the result to marketing leadership.",
            "Return a direct answer, evidence bullets, a short confidence note, a short caution if needed, and one suggested next question.",
            "Keep the analysis summary concise and business-focused.",
            "Prefer a ranked answer with confidence-aware wording when multiple metrics support the conclusion."
          ],
          outputSchema: {
            directAnswer: "string",
            evidence: ["string"],
            caution: "string",
            suggestedNextQuestion: "string",
            analysisSummary: "string",
            chartSelectionSummary: "string",
            confidenceNote: "string"
          }
        },
        null,
        2
      )
    }
  ];

  return {
    model: "analytics-narrative",
    messages,
    temperature: 0.2,
    maxTokens: 900,
    responseFormat: "json"
  };
}

export function parseJsonResponse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface ExecutiveInsightJson {
  bullets?: string[];
  suggestedQuestions?: string[];
  warning?: string;
}

export interface ChartExplanationJson {
  charts?: Array<{ id: string; explanation: string }>;
}

export interface AskAnswerJson {
  directAnswer?: string;
  evidence?: string[];
  caution?: string;
  suggestedNextQuestion?: string;
  analysisSummary?: string;
  chartSelectionSummary?: string;
  confidenceNote?: string;
  warning?: string;
}
