import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod@^3.23.8";

export default defineDeck({
  label: "slow_action_ts",
  inputSchema: z.object({
    text: z.string().describe("Text to echo after a delay"),
    delayMs: z.number().min(0).max(120000).default(2000)
      .describe("Artificial delay in milliseconds"),
  }),
  outputSchema: z.object({
    echoed: z.string(),
    delayMs: z.number(),
  }),
  async run(ctx) {
    const delay = ctx.input.delayMs ?? 2000;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { echoed: ctx.input.text, delayMs: delay };
  },
});
