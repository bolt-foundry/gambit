import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.string(),
  label: "echo_text",
});

export function run(ctx: { input: { text: string } }) {
  return `Echo: ${ctx.input.text}`;
}
