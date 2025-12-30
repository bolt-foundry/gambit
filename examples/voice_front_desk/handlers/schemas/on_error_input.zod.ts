import { z } from "zod";

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
