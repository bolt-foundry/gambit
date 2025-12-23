import { z } from "zod";

export default z.object({
  callerName: z.string().optional().describe(
    "Full name provided during verification",
  ),
  dob: z.string().optional().describe("Date of birth as provided"),
  callbackNumber: z.string().optional().describe(
    "Best number to reach the caller",
  ),
  patientId: z.string().optional().describe(
    "Existing patient identifier, if found",
  ),
  newPatient: z.boolean().default(false).describe(
    "True when we created a new chart",
  ),
  insuranceStatus: z
    .enum(["captured", "missing", "on_file"])
    .default("missing")
    .describe("Whether insurance is on file, captured, or missing"),
  summary: z.string().optional().describe("One sentence summary for routing"),
});
