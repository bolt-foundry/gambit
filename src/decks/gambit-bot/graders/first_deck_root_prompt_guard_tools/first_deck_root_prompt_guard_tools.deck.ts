import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";
import contextSchema, {
  type graderMessageWithToolsSchema as messageSchema,
} from "../../../../../packages/gambit-core/schemas/graders/contexts/turn_tools.ts";

const responseSchema = z.object({
  score: z.number().int().min(-3).max(3),
  reason: z.string(),
  evidence: z.array(z.string()).optional(),
});

type GraderInput = z.infer<typeof contextSchema>;
type SessionMessage = z.infer<typeof messageSchema>;

type DeckWrite = {
  path: string;
  messageIndex: number;
};

export default defineDeck({
  label: "first_deck_root_prompt_guard_tools",
  contextSchema,
  responseSchema,
  run(ctx) {
    const messages = ctx.input.session.messages ?? [];
    const deckWrites = collectDeckPromptWrites(messages);

    if (deckWrites.length === 0) {
      return {
        score: 0,
        reason:
          "No deck creation write found (no bot_write call targeting PROMPT.md).",
      };
    }

    const firstWrite = deckWrites[0];
    if (firstWrite.path === "PROMPT.md") {
      return {
        score: 3,
        reason: "First created deck is root PROMPT.md.",
        evidence: [`first deck write path: ${firstWrite.path}`],
      };
    }

    return {
      score: -3,
      reason:
        "First created deck is not root PROMPT.md; it was created in a subfolder.",
      evidence: [
        `first deck write path: ${firstWrite.path}`,
        `message index: ${firstWrite.messageIndex}`,
      ],
    };
  },
});

function collectDeckPromptWrites(
  messages: Array<SessionMessage>,
): Array<DeckWrite> {
  const writes: Array<DeckWrite> = [];

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls?.length) continue;

    for (const tool of msg.tool_calls) {
      if (tool.function.name !== "bot_write") continue;
      if (!tool.function.arguments) continue;

      try {
        const parsed = JSON.parse(tool.function.arguments) as {
          path?: unknown;
        };
        if (typeof parsed.path !== "string") continue;

        const normalizedPath = normalizePath(parsed.path);
        if (isDeckPromptPath(normalizedPath)) {
          writes.push({ path: normalizedPath, messageIndex: i });
        }
      } catch {
        // Ignore malformed tool args and continue scanning.
      }
    }
  }

  return writes;
}

function normalizePath(path: string): string {
  const withForwardSlashes = path.replaceAll("\\", "/");
  return withForwardSlashes.replace(/^\.\//, "");
}

function isDeckPromptPath(path: string): boolean {
  return path === "PROMPT.md" || path.endsWith("/PROMPT.md");
}
