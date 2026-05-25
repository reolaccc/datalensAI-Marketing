import { z } from "zod";

export const questionRequestSchema = z.object({
  analysisId: z.string().min(1),
  question: z.string().min(3),
  context: z
    .object({
      selectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      selectedThreshold: z.number().finite().optional(),
      selectedMetric: z.string().min(1).optional(),
      selectedDimension: z.string().min(1).optional(),
      selectedCategory: z.string().min(1).optional(),
      selectedSegmentA: z.string().min(1).optional(),
      selectedSegmentB: z.string().min(1).optional(),
      useAi: z.boolean().optional(),
      conversationHistory: z
        .array(
          z.object({
            question: z.string().min(1),
            answer: z.string().min(1),
            interpretation: z.string().min(1).optional(),
            detectedIntent: z
              .object({
                primaryIntent: z.enum([
                  "trend_analysis",
                  "comparison",
                  "ranking",
                  "anomaly_detection",
                  "correlation",
                  "distribution",
                  "segmentation",
                  "efficiency_analysis",
                  "funnel_analysis",
                  "data_quality",
                  "general_overview"
                ]),
                secondaryIntents: z.array(
                  z.enum([
                    "trend_analysis",
                    "comparison",
                    "ranking",
                    "anomaly_detection",
                    "correlation",
                    "distribution",
                    "segmentation",
                    "efficiency_analysis",
                    "funnel_analysis",
                    "data_quality",
                    "general_overview"
                  ])
                ),
                targetMetrics: z.array(z.string().min(1)),
                targetDimensions: z.array(z.string().min(1)),
                timeRequired: z.boolean(),
                comparisonRequired: z.boolean(),
                anomalyRequired: z.boolean(),
                confidence: z.number().finite(),
                matchedKeywords: z.array(z.string())
              })
              .optional(),
            chartSuggestion: z
              .object({
                chartType: z.enum(["line", "bar", "table"]),
                xKey: z.string().min(1),
                yKey: z.string().min(1),
                series: z.array(z.string().min(1)).optional()
              })
              .optional()
          })
        )
        .max(4)
        .optional()
    })
    .optional()
});
