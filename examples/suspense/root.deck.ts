import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  prompt:
    "You are a polite assistant. Call the slow_action to demonstrate suspense handling.",
  inputSchema: z.string().optional(),
  outputSchema: z.string(),
  modelParams: { model: "openai/gpt-4o-mini" },
  suspenseHandler: {
    path: "./suspense_handler.deck.ts",
    delayMs: 500,
    activity: "demo_suspense",
  },
  actions: [
    {
      name: "slow_action",
      path: "./slow_action.deck.ts",
      description: "Simulate slow work",
      activity: "demo_suspense",
    },
  ],
});
