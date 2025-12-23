import { z } from "zod";

export default z.object({
  callerNumber: z.string().optional(),
  callOriginNumber: z.string().optional(),
  notes: z.string().optional(),
});
