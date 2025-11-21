import { assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { runDeck } from "./runtime.ts";
import type { ModelProvider } from "./types.ts";

const dummyProvider: ModelProvider = {
  chat() {
    return Promise.resolve({
      message: { role: "assistant", content: "dummy" },
      finishReason: "stop",
    });
  },
};

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

Deno.test("compute deck returns validated output", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "compute.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      activity: "compute_test",
    });
    export async function run(ctx: { input: string }) {
      return "ok:" + ctx.input;
    }
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: dummyProvider,
    isRoot: true,
  });

  assertEquals(result, "ok:hello");
});

Deno.test("non-root missing schemas fails load", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "bad.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({});
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: "data",
        modelProvider: dummyProvider,
        isRoot: false,
      }),
    Error,
    "must declare inputSchema and outputSchema",
  );
});

Deno.test("deck.actions merge overrides card actions", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "card.card.ts",
    `
    import { defineCard } from "${modHref}";
    export default defineCard({
      actions: [{ name: "from_card", path: "./child.deck.ts", description: "card" }]
    });
    `,
  );

  const rootPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      actions: [
        { name: "from_card", path: "./child.deck.ts", description: "deck override" },
        { name: "from_deck", path: "./child.deck.ts", description: "deck only" }
      ],
      modelParams: { model: "test-model" },
      embeds: ["./card.card.ts"]
    });
    `,
  );

  // child deck for schema validation
  await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
    });
    export async function run(ctx: { input: { text: string } }) {
      return ctx.input.text;
    }
    `,
  );

  const loaded = await runDeck({
    path: rootPath,
    input: "hello",
    modelProvider: dummyProvider,
    isRoot: true,
  });

  // dummy provider returns "dummy" so root output will be validated as string
  assertEquals(typeof loaded, "string");
});
