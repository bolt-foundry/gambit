import { z } from "zod";

export default z.object({
  message: z.string().optional(),
  code: z.string().optional(),
  status: z.number().optional(),
  meta: z.record(z.unknown()).optional(),
  payload: z.unknown().optional(),
});
