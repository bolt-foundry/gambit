import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "on_idle_handler_ts",
  contextSchema: z.object({
    kind: z.literal("idle"),
    label: z.string().optional(),
    source: z.object({ deckPath: z.string() }),
    trigger: z.object({
      reason: z.literal("idle_timeout"),
      elapsedMs: z.number(),
    }),
  }),
  responseSchema: z.string().min(1),
  run(ctx) {
    const elapsed = Math.round(ctx.input.trigger.elapsedMs);
    return `Idle ping after ${elapsed}ms.`;
  },
});
