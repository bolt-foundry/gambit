import { z } from "zod";

export default z.object({
  score: z.number().int().min(-3).max(3),
  reason: z.string(),
  evidence: z.array(z.string()).optional(),
});
