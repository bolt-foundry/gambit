import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  prompt:
    "You are a concise assistant. Call the `echo` action to repeat the user's text and return the final answer in one sentence.",
  inputSchema: z.string(),
  outputSchema: z.string(),
  modelParams: {
    model: "openai/gpt-4o-mini",
  },
  actions: [
    {
      name: "echo",
      path: "./echo.deck.ts",
      description: "Return the text back verbatim with a short prefix.",
      activity: "echo_text",
    },
  ],
});
