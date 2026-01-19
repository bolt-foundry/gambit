import { z } from "npm:zod";

export default z.object({
  facts: z.array(z.string()).describe(
    "Relevant, concise facts extracted from the FAQ content",
  ),
  suggestedFollowUp: z.string().optional().describe(
    "Optional next step for the assistant if no direct answer is available",
  ),
  sources: z.array(z.object({
    title: z.string(),
    url: z.string().optional(),
  })).optional(),
});
