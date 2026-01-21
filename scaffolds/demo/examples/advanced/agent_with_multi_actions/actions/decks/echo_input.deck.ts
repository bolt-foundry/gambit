import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "echo_input",
  contextSchema: z.object({
    text: z.string().describe("Text to echo back"),
  }),
  responseSchema: z.object({
    text: z.string(),
  }),
  run(ctx) {
    return { text: ctx.input.text };
  },
});
