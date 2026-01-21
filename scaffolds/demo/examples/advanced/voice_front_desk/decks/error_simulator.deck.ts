import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "error_simulator",
  contextSchema: z.object({
    reason: z.string().optional().describe("Optional test reason."),
  }),
  responseSchema: z.object({
    ok: z.boolean(),
  }),
  run(ctx) {
    const reason = ctx.input.reason ?? "no reason provided";
    throw new Error(`Intentional error simulator failure: ${reason}`);
  },
});
