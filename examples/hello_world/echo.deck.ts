import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.string(),
  activity: "echo_text",
  run(ctx: { input: { text: string } }) {
    return `Echo: ${ctx.input.text}`;
  },
});
