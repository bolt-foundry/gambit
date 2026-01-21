import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "lookup_fact",
  contextSchema: z.object({ question: z.string() }),
  responseSchema: z.object({ answer: z.string() }),
  // Simple compute deck that fabricates a short fact.
  run(ctx) {
    const answer = `Here is a quick note on "${ctx.input.question}".`;
    return { answer };
  },
});
