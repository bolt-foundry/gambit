import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

const inputSchema = z.object({
  patientId: z.string(),
  testName: z.string().default("recent lab"),
  requestedOn: z.string().optional(),
});

const outputSchema = z.object({
  summary: z.string(),
  followUp: z.string(),
  provenance: z.string(),
});

export default defineDeck({
  label: "results_lookup",
  inputSchema,
  outputSchema,
  run(ctx) {
    const summary =
      `Results for ${ctx.input.testName} are available and were reviewed by Dr. Chen.`;
    const followUp =
      "Nurse team will call if anything unusual appears; otherwise follow your care plan.";
    const provenance = ctx.input.requestedOn ?? new Date().toISOString();

    return { summary, followUp, provenance };
  },
});
