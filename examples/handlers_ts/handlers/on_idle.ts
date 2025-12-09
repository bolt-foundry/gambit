import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

export default defineDeck({
  label: "on_idle_handler_ts",
  inputSchema: z.object({
    kind: z.literal("idle"),
    label: z.string().optional(),
    source: z.object({ deckPath: z.string() }),
    trigger: z.object({
      reason: z.literal("idle_timeout"),
      elapsedMs: z.number(),
    }),
  }),
  outputSchema: z.string().min(1),
  run(ctx) {
    const elapsed = Math.round(ctx.input.trigger.elapsedMs);
    return `Idle ping after ${elapsed}ms.`;
  },
});
