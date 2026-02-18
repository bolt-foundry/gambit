import { z } from "zod";

type RespondEnvelope = {
  payload?: unknown;
  status?: number;
  message?: string;
  code?: string;
  meta?: Record<string, unknown>;
};

const respondSchema: z.ZodType<RespondEnvelope> = z.object({
  payload: z.any().optional(),
  status: z.number().int().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  meta: z.record(z.any()).optional(),
});

export default respondSchema;
