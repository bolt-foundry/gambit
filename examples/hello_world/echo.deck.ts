import { defineDeck, type ExecutionContext } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.string(),
  label: "echo_text",
  run(ctx: ExecutionContext<{ text: string }>) {
    return `Echo: ${ctx.input.text}`;
  },
});
