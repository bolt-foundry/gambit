import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod@^3.23.8";

export default defineDeck({
  label: "echo_input",
  inputSchema: z.object({
    text: z.string().describe("Text to echo back"),
  }),
  outputSchema: z.object({
    text: z.string(),
  }),
  run(ctx) {
    return { text: ctx.input.text };
  },
});
