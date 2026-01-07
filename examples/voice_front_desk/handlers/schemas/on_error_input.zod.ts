import { z } from "npm:zod@^3.23.8";

const sourceSchema = z.object({
  deckPath: z.string(),
  actionName: z.string(),
});

export default z.object({
  kind: z.literal("error"),
  label: z.string().optional(),
  source: sourceSchema,
  error: z.object({ message: z.string() }),
  childInput: z.record(z.unknown()).optional(),
});
