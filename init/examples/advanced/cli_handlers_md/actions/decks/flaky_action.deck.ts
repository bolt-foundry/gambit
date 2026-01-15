import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "flaky_action",
  inputSchema: z.object({
    text: z.string().describe("Text to process"),
    fail: z.boolean().default(false)
      .describe("If true, throw to trigger onError"),
  }),
  outputSchema: z.object({
    echoed: z.string(),
  }),
  run(ctx) {
    if (ctx.input.fail || /fail/i.test(ctx.input.text)) {
      throw new Error("Intentional failure for handler demo");
    }
    return { echoed: ctx.input.text };
  },
});
