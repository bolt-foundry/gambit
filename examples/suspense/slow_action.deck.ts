import { defineDeck, type ExecutionContext } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  inputSchema: z.object({ waitMs: z.number().default(1500) }),
  outputSchema: z.string(),
  label: "demo_suspense",
  async run(ctx: ExecutionContext<{ waitMs: number }>) {
    await new Promise((resolve) => setTimeout(resolve, ctx.input.waitMs));
    return `Done after ${ctx.input.waitMs}ms`;
  },
});
