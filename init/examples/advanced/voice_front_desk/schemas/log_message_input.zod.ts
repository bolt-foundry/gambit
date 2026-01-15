import { z } from "npm:zod";

export default z.object({
  callId: z.string(),
  callerName: z.string().optional(),
  callbackNumber: z.string(),
  summary: z.string().describe(
    "Short description of why the caller needs help",
  ),
  priority: z.enum(["urgent", "high", "normal", "low"]).default("normal"),
  audience: z
    .enum(["nurse", "billing", "provider", "front_desk"])
    .default("nurse"),
  requestedBy: z.string().optional(),
});
