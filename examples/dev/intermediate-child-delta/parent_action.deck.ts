import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

export default defineDeck({
  contextSchema: z.string(),
  responseSchema: z.string(),
  modelParams: { model: "codex-cli/default" },
  actionDecks: [{ name: "child_progress", path: "./child_progress.deck.ts" }],
  body: `You orchestrate one child action.

Requirements:
- Call tool child_progress exactly once with JSON args: {"task": "<user context>"}.
- After tool result, respond with one short line: "child complete".
- Do not call any other tools.`,
});
