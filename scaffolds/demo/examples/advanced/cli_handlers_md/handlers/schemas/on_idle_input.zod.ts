import { z } from "npm:zod";

export default z.object({
  kind: z.literal("idle"),
  label: z.string().optional(),
  source: z.object({ deckPath: z.string() }),
  trigger: z.object({
    reason: z.literal("idle_timeout"),
    elapsedMs: z.number(),
  }),
});
