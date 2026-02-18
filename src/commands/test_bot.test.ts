import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { loadState } from "@bolt-foundry/gambit-core";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import { runTestBotLoop } from "./test_bot.ts";
import { modImportPath } from "../server_test_utils.ts";

Deno.test("scenario loop stamps scenario metadata and user message sources", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const rootDeckPath = path.join(dir, "root.deck.ts");
  const scenarioDeckPath = path.join(dir, "scenario-persona.deck.ts");
  const statePath = path.join(dir, "state.json");

  const deckSource = `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
  `;
  await Deno.writeTextFile(rootDeckPath, deckSource);
  await Deno.writeTextFile(scenarioDeckPath, deckSource);

  let callCount = 0;
  const provider: ModelProvider = {
    chat() {
      callCount += 1;
      return Promise.resolve({
        message: { role: "assistant", content: `msg-${callCount}` },
        finishReason: "stop",
      });
    },
  };

  await runTestBotLoop({
    rootDeckPath,
    botDeckPath: scenarioDeckPath,
    contextProvided: false,
    maxTurns: 1,
    modelProvider: provider,
    statePath,
  });

  const state = loadState(statePath);
  assert(state, "expected persisted state");
  assertEquals(state.meta?.scenarioRunId, state.runId);
  assertEquals(state.meta?.scenarioConfigPath, scenarioDeckPath);
  assertEquals(state.meta?.selectedScenarioDeckId, "scenario-persona");

  const userRefs = (state.messages ?? [])
    .map((message, index) => ({
      role: message.role,
      ref: state.messageRefs?.[index],
    }))
    .filter((entry) => entry.role === "user" && entry.ref);
  assert(userRefs.length > 0, "expected at least one user message ref");
  for (const entry of userRefs) {
    assertEquals(entry.ref?.source, "scenario");
  }
});

Deno.test("scenario loop normalizes existing state metadata without new turns", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const rootDeckPath = path.join(dir, "root.deck.ts");
  const scenarioDeckPath = path.join(dir, "scenario-persona.deck.ts");
  const statePath = path.join(dir, "state.json");

  const deckSource = `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
  `;
  await Deno.writeTextFile(rootDeckPath, deckSource);
  await Deno.writeTextFile(scenarioDeckPath, deckSource);
  await Deno.writeTextFile(
    statePath,
    JSON.stringify({
      runId: "run-existing",
      messages: [
        { role: "user", content: "legacy user turn" },
        { role: "assistant", content: "legacy response" },
      ],
      messageRefs: [
        { id: "msg-user", role: "user" },
        { id: "msg-assistant", role: "assistant" },
      ],
      meta: {},
    }),
  );

  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "unused" },
        finishReason: "stop",
      });
    },
  };

  await runTestBotLoop({
    rootDeckPath,
    botDeckPath: scenarioDeckPath,
    contextProvided: false,
    maxTurns: 0,
    modelProvider: provider,
    statePath,
  });

  const state = loadState(statePath);
  assert(state, "expected persisted state");
  assertEquals(state.meta?.scenarioRunId, "run-existing");
  assertEquals(state.meta?.scenarioConfigPath, scenarioDeckPath);
  assertEquals(state.meta?.selectedScenarioDeckId, "scenario-persona");
  assertEquals(state.messageRefs?.[0]?.source, "scenario");
});

Deno.test("scenario loop terminates when persona returns empty message", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const rootDeckPath = path.join(dir, "root.deck.ts");
  const scenarioDeckPath = path.join(dir, "scenario-persona.deck.ts");
  const statePath = path.join(dir, "state.json");

  const deckSource = `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
  `;
  await Deno.writeTextFile(rootDeckPath, deckSource);
  await Deno.writeTextFile(scenarioDeckPath, deckSource);

  let callCount = 0;
  const provider: ModelProvider = {
    chat() {
      callCount += 1;
      const content = callCount === 2 ? "   " : "assistant-turn";
      return Promise.resolve({
        message: { role: "assistant", content },
        finishReason: "stop",
      });
    },
  };

  await runTestBotLoop({
    rootDeckPath,
    botDeckPath: scenarioDeckPath,
    contextProvided: false,
    maxTurns: 5,
    modelProvider: provider,
    statePath,
  });

  assertEquals(
    callCount,
    2,
    "expected loop to stop immediately after empty persona output",
  );
});
