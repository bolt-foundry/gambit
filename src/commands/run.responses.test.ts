import { assertEquals } from "@std/assert";
import * as path from "@std/path";
import type { ModelProvider } from "@molt-foundry/gambit-core";
import { handleRunCommand } from "./run.ts";

function deckPath(): string {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  return path.resolve(here, "..", "decks", "gambit-assistant.deck.md");
}

Deno.test("run command uses responses mode when enabled", async () => {
  let responsesCalled = false;
  const provider: ModelProvider = {
    responses: () => {
      responsesCalled = true;
      return Promise.resolve({
        id: "resp_test",
        object: "response",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Ask me anything." }],
          },
        ],
      });
    },
    chat: () => {
      throw new Error("chat should not be called in responses mode");
    },
  };

  await handleRunCommand({
    deckPath: deckPath(),
    context: undefined,
    contextProvided: false,
    message: undefined,
    modelProvider: provider,
    responsesMode: true,
  });

  assertEquals(responsesCalled, true);
});
