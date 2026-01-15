import { z } from "npm:zod";

export default z.object({
  ask: z.string().describe("Caller request summary"),
  patientSummary: z.string().optional().describe("Identity deck summary"),
  urgencyHint: z.enum(["urgent", "soon", "routine"]).optional(),
});
