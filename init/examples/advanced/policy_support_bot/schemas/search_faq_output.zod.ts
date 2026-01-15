import { z } from "npm:zod";

const matchSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  category: z.string(),
  sourceUrl: z.string().url(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

export default z.object({
  matches: z.array(matchSchema),
  topCategory: z.string().optional(),
});
