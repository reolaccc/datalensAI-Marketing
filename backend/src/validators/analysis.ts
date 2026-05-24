import { z } from "zod";

export const uploadedFileSchema = z.object({
  originalname: z.string().min(1),
  mimetype: z.string().min(1),
  buffer: z.instanceof(Buffer)
});
