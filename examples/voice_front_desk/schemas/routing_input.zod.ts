import { z } from "npm:zod@^3.23.8";

export default z.object({
  ask: z.string().describe("Caller request summary"),
  patientSummary: z.string().optional().describe("Identity deck summary"),
  urgencyHint: z.enum(["urgent", "soon", "routine"]).optional(),
});
