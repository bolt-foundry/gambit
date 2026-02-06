import { z } from "npm:zod";

export default z.object({
  summaries: z.array(z.object({
    appliesTo: z.string().describe(
      "What part of the proposed change this summary applies to.",
    ),
    summary: z.string().describe(
      "Policy guidance for that part of the change.",
    ),
  })).min(1).describe(
    "Scoped policy summaries so the parent knows where each policy applies.",
  ),
});
