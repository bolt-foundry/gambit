import { assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { renderDeck } from "../mod.ts";
import { logger as renderLogger } from "./render.ts";
import type { ToolDefinition } from "./types.ts";

function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

async function writeTempDeck(dir: string, filename: string, contents: string) {
  const target = path.join(dir, filename);
  await Deno.writeTextFile(target, contents);
  return target;
}

Deno.test("renderDeck prepends deck system prompt and merges deck tools", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const childPath = await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      run(ctx) { return ctx.input.text; }
    });
    `,
  );

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      body: "Deck system prompt.",
      modelParams: { model: "deck-model", temperature: 0 },
      actionDecks: [{ name: "child", path: "${childPath}" }],
    });
    `,
  );

  const res = await renderDeck({
    deckPath,
    request: {
      messages: [{ role: "user", content: "hi" }],
    },
  });

  assertEquals(res.request.model, "deck-model");
  assertEquals(res.request.temperature, 0);
  assertEquals(res.request.messages[0].role, "system");
  assertEquals(res.request.messages[0].content, "Deck system prompt.");
  assertEquals(
    res.request.tools?.some((t) => t.function.name === "child"),
    true,
  );
  assertEquals(typeof res.gambit.actionPathsByName.child, "string");
});

Deno.test("renderDeck warns on mismatched system message", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      body: "Deck system prompt.",
      modelParams: { model: "deck-model" },
    });
    `,
  );

  let warned = false;
  const origWarn = renderLogger.warn;
  renderLogger.warn = () => {
    warned = true;
  };
  try {
    await renderDeck({
      deckPath,
      request: {
        model: "x",
        messages: [{ role: "system", content: "User system prompt." }],
      },
    });
    assertEquals(warned, true);
  } finally {
    renderLogger.warn = origWarn;
  }
});

Deno.test("renderDeck rejects tool name collisions with deck actions", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const childPath = await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run() { return "ok"; }
    });
    `,
  );

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      modelParams: { model: "deck-model" },
      actionDecks: [{ name: "dup", path: "${childPath}" }],
    });
    `,
  );

  const externalTool: ToolDefinition = {
    type: "function",
    function: {
      name: "dup",
      parameters: { type: "object", properties: {} },
    },
  };

  await assertRejects(
    () =>
      renderDeck({
        deckPath,
        request: {
          model: "x",
          messages: [{ role: "user", content: "hi" }],
          tools: [externalTool],
        },
      }),
    Error,
    "collision",
  );
});

Deno.test("renderDeck rejects external tools with reserved gambit_ prefix", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      modelParams: { model: "deck-model" },
    });
    `,
  );

  const externalTool: ToolDefinition = {
    type: "function",
    function: {
      name: "gambit_not_allowed",
      parameters: { type: "object", properties: {} },
    },
  };

  await assertRejects(
    () =>
      renderDeck({
        deckPath,
        request: {
          model: "x",
          messages: [{ role: "user", content: "hi" }],
          tools: [externalTool],
        },
      }),
    Error,
    "reserved",
  );
});
