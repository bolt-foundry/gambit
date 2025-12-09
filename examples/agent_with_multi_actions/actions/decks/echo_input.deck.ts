import { defineDeck } from "../../../../mod.ts";
import { z } from "zod";

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
