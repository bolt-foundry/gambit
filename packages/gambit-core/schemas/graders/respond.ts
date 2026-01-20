import { z } from "zod";

export default z.object({
  payload: z.any().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
  code: z.any().optional(),
  meta: z.record(z.any()).optional(),
});
