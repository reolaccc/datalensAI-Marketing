import type { ChartConfig } from "../analytics/types.js";
import type { AnalyticsFacts, AskAnswerNarrative, ExecutiveInsightNarrative, QuestionNarrativeInput } from "./types.js";
import type { LlmMessage, LlmTextGenerationRequest } from "./types.js";

function buildSystemPrompt(scope: string) {
  return [
    "You are a senior data analyst and marketing strategist.",
    "Write for business stakeholders, not for developers.",
    "Use only the provided structured facts.",
    "Do not invent numbers, labels, or relationships.",
    "Do not recalculate metrics or infer unsupported values.",
    "Do not mention a metric unless it appears in the input facts.",
    "If evidence is insufficient, say so plainly.",
    "Keep the tone concise, specific, and commercially useful.",
    "Every insight must include at least one metric or dimension.",
    "If data quality warnings exist, mention them briefly and explain the impact.",
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
            bullets: "3-5 short bullets",
            tone: "senior analyst and marketing lead",
            expectations: [
              "mention specific metrics and dimensions",
              "compare performance where possible",
              "include a cautious recommendation",
              "briefly mention data quality issues if relevant"
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
            chartType: chart.chartType,
            metric: chart.metric,
            dimension: chart.dimension,
            reason: chart.reason,
            whyThisChart: chart.whyThisChart,
            dataPreview: chart.data.slice(0, 3)
          })),
          requirements: [
            "Explain why each chart was selected.",
            "Explain what question the chart helps answer.",
            "Explain what the chart shows.",
            "Explain what the user should compare next.",
            "Keep each explanation short and concrete.",
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
          supportingData: input.supportingData,
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
            "Write like a senior analyst explaining the result to marketing leadership.",
            "Return a direct answer, evidence bullets, a short caution if needed, and one suggested next question.",
            "Keep the analysis summary concise and business-focused."
          ],
          outputSchema: {
            directAnswer: "string",
            evidence: ["string"],
            caution: "string",
            suggestedNextQuestion: "string",
            analysisSummary: "string",
            chartSelectionSummary: "string",
            warning: "string"
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
  warning?: string;
}

