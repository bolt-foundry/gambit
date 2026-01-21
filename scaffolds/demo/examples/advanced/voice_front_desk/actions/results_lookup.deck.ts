import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

const contextSchema = z.object({
  patientId: z.string(),
  testName: z.string().default("recent lab"),
  requestedOn: z.string().optional(),
});

const responseSchema = z.object({
  summary: z.string(),
  followUp: z.string(),
  provenance: z.string(),
});

export default defineDeck({
  label: "results_lookup",
  contextSchema,
  responseSchema,
  run(ctx) {
    const summary =
      `Results for ${ctx.input.testName} are available and were reviewed by Dr. Chen.`;
    const followUp =
      "Nurse team will call if anything unusual appears; otherwise follow your care plan.";
    const provenance = ctx.input.requestedOn ?? new Date().toISOString();

    return { summary, followUp, provenance };
  },
});
