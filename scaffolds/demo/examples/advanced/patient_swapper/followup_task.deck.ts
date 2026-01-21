import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "followup_task",
  contextSchema: z.object({
    patientId: z.string(),
    updateField: z.string(),
    updateValue: z.string(),
    callingContext: z.string().optional(),
  }),
  responseSchema: z.object({
    status: z.string().describe("Mock status result"),
  }),
  run(ctx) {
    const summary =
      `Queued follow-up for ${ctx.input.patientId} (${ctx.input.updateField} -> ${ctx.input.updateValue}).`;

    ctx.log({
      level: "info",
      message: "Mocked follow-up task",
      meta: { callingContext: ctx.input.callingContext ?? null },
    });

    return { status: summary };
  },
});
