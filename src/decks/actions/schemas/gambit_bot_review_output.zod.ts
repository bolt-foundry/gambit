import { z } from "npm:zod";

export default z.object({
  summary: z.string().describe(
    "Short summary of the main gaps or opportunities.",
  ),
  recommendations: z.array(
    z.object({
      title: z.string().describe("Short name for the recommendation."),
      rationale: z.string().describe("Why this change matters."),
      suggestedChange: z.string().describe("Concrete change to apply."),
    }),
  ).describe("Ordered list of the most important recommendations."),
  followUps: z.array(
    z.string().describe("Targeted question to resolve an open decision."),
  ).optional(),
});
