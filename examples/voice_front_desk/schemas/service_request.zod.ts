import { z } from "zod";

const patientContextSchema = z.object({
  callerName: z.string().optional(),
  patientId: z.string().optional(),
  dob: z.string().optional(),
  callbackNumber: z.string().optional(),
  insuranceStatus: z.string().optional(),
});

export default z.object({
  patientContext: patientContextSchema.optional(),
  reason: z.string().describe(
    "Free-text summary of why the deck is being called",
  ),
  metadata: z.record(z.any()).optional().describe(
    "Additional hints like urgency or preferred provider",
  ),
});
