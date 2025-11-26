import { defineDeck } from "../../mod.ts";
import { z } from "zod";

const InputSchema = z.object({
  kind: z.literal("suspense"),
  label: z.string().optional(),
  source: z.object({ deckPath: z.string(), actionName: z.string() }),
  trigger: z.object({ reason: z.literal("timeout"), elapsedMs: z.number() }),
  childInput: z.record(z.any()),
});

export default defineDeck({
  inputSchema: InputSchema,
  outputSchema: z.string(),
  label: "demo_suspense",
});

export function run(ctx: { input: z.infer<typeof InputSchema> }) {
  return `Still working after ${ctx.input.trigger.elapsedMs}ms...`;
}
