import { z } from "npm:zod";

const sourceSchema = z.object({
  deckPath: z.string(),
  actionName: z.string(),
});

export default z.object({
  kind: z.union([z.literal("busy"), z.literal("suspense")]),
  label: z.string().optional(),
  source: sourceSchema,
  trigger: z.object({
    reason: z.literal("timeout"),
    elapsedMs: z.number(),
  }),
  childInput: z.record(z.unknown()).optional(),
});
