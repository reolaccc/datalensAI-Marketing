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
      useAi: z.boolean().optional()
    })
    .optional()
});
