import { z } from "zod";

export default z.object({
  payload: z.any().optional(),
  status: z.number().int().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  meta: z.record(z.any()).optional(),
});
