import { z } from "npm:zod";

export default z.object({
  spokenResponse: z.string().describe(
    "What the root deck should say to the caller",
  ),
  followUp: z.string().optional().describe(
    "Extra note to mention before closing",
  ),
  nextAction: z
    .string()
    .optional()
    .describe("Optional machine-readable hint for logging or routing"),
});
