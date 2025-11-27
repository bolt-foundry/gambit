import { assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { runDeck } from "./runtime.ts";
import type { ModelMessage, ModelProvider } from "./types.ts";

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
      label: "compute_test",
      run(ctx: { input: string }) {
        return "ok:" + ctx.input;
      }
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

Deno.test("compute deck can define run inline", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "inline.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      label: "inline_run",
      run(ctx: { input: string }) {
        return "inline:" + ctx.input;
      }
    });
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: dummyProvider,
    isRoot: true,
  });

  assertEquals(result, "inline:hi");
});

Deno.test("LLM deck streams via onStreamText", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "stream.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const chunks: string[] = [];
  let sawStreamFlag = false;
  const streamingProvider: ModelProvider = {
    chat(input) {
      sawStreamFlag = Boolean(input.stream);
      input.onStreamText?.("a");
      input.onStreamText?.("b");
      return Promise.resolve({
        message: { role: "assistant", content: "ab" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: streamingProvider,
    isRoot: true,
    stream: true,
    onStreamText: (chunk) => chunks.push(chunk),
  });

  assertEquals(result, "ab");
  assertEquals(chunks.join(""), "ab");
  assertEquals(sawStreamFlag, true);
});

Deno.test("LLM deck defaults to assistant-first, userFirst opt-in", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "assistant-first.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  let lastMessages: ModelMessage[] = [];
  const provider: ModelProvider = {
    chat(input) {
      lastMessages = input.messages;
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
  });
  const hasUserDefault = lastMessages.some((m) => m.role === "user");
  assertEquals(hasUserDefault, false);

  await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
    userFirst: true,
  });
  const hasUserOptIn = lastMessages.some((m) => m.role === "user");
  assertEquals(hasUserOptIn, true);
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

Deno.test("card schema fragments merge into deck schemas", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "card.card.ts",
    `
    import { defineCard } from "${modHref}";
    import { z } from "zod";
    export default defineCard({
      inputFragment: z.object({ extra: z.string() }),
      outputFragment: z.object({ note: z.string() })
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
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      actions: [],
      embeds: ["./card.card.ts"],
    });
    export async function run(ctx: { input: { text: string, extra: string } }) {
      return { result: ctx.input.text, note: ctx.input.extra };
    }
    `,
  );

  const result = await runDeck({
    path: rootPath,
    input: { text: "hi", extra: "more" },
    modelProvider: dummyProvider,
    isRoot: true,
  });

  assertEquals(typeof result, "object");
});

Deno.test("card embed cycles are rejected", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "a.card.ts",
    `
    import { defineCard } from "${modHref}";
    export default defineCard({
      embeds: ["./b.card.ts"]
    });
    `,
  );

  await writeTempDeck(
    dir,
    "b.card.ts",
    `
    import { defineCard } from "${modHref}";
    export default defineCard({
      embeds: ["./a.card.ts"]
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
      embeds: ["./a.card.ts"],
      modelParams: { model: "test-model" },
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: rootPath,
        input: "hello",
        modelProvider: dummyProvider,
        isRoot: true,
      }),
    Error,
    "cycle",
  );
});
