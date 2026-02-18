import { z } from "zod";

type GraderOutput = {
  score: number;
  reason: string;
  evidence?: Array<string>;
};

const graderOutputSchema: z.ZodType<GraderOutput> = z.object({
  score: z.number().int().min(-3).max(3),
  reason: z.string(),
  evidence: z.array(z.string()).optional(),
});

export default graderOutputSchema;
