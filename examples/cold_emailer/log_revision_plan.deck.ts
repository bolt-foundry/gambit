import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  label: "log_revision_plan",
  inputSchema: z.object({
    steps: z.array(z.string().min(1)).min(1)
      .describe("Revision steps derived from the critique"),
  }),
  outputSchema: z.object({
    status: z.string().min(1).describe("Log status"),
  }),
  run(ctx) {
    ctx.log({
      level: "info",
      message: "Revision plan",
      meta: { steps: ctx.input.steps },
    });
    return { status: "logged" };
  },
});
