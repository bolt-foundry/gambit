++ 
import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

const sourceSchema = z.object({
  deckPath: z.string(),
  actionName: z.string(),
});

export default defineDeck({
  label: "on_interval_handler_ts",
  inputSchema: z.object({
    kind: z.literal("suspense"),
    label: z.string().optional(),
    source: sourceSchema,
    trigger: z.object({
      reason: z.literal("timeout"),
      elapsedMs: z.number(),
    }),
    childInput: z.record(z.unknown()).optional(),
  }),
  outputSchema: z.string().min(1),
  run(ctx) {
    const elapsed = Math.round(ctx.input.trigger.elapsedMs);
    return `Still working (TS) after ${elapsed}ms...`;
  },
});
