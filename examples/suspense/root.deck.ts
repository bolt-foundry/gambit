import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  body:
    "You are a polite assistant. Call the slow_action to demonstrate suspense handling.",
  inputSchema: z.string().optional(),
  outputSchema: z.string(),
  modelParams: { model: "openai/gpt-4o-mini" },
  handlers: {
    onPing: {
      path: "./suspense_handler.deck.ts",
      delayMs: 500,
      label: "demo_suspense",
    },
  },
  actions: [
    {
      name: "slow_action",
      path: "./slow_action.deck.ts",
      description: "Simulate slow work",
      label: "demo_suspense",
    },
  ],
});
