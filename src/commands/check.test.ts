import { assertRejects } from "@std/assert";
import * as path from "@std/path";
import { handleCheckCommand } from "./check.ts";

async function writeDeck(dir: string, filename: string, contents: string) {
  const target = path.join(dir, filename);
  await Deno.writeTextFile(target, contents);
  return target;
}

function resolveUrl(input: Request | URL | string): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

Deno.test("check validates models across providers", async () => {
  const dir = await Deno.makeTempDir();
  const rootDeck = await writeDeck(
    dir,
    "root.deck.md",
    `+++
label = "root"
[modelParams]
model = "openrouter/anthropic/claude-3.5-sonnet"
[handlers.onError]
path = "./handler.deck.md"
[[testDecks]]
label = "child"
path = "./child.deck.md"
+++

Root deck.`,
  );
  await writeDeck(
    dir,
    "child.deck.md",
    `+++
label = "child"
[modelParams]
model = "ollama/llama3"
+++

Child deck.`,
  );
  await writeDeck(
    dir,
    "handler.deck.md",
    `+++
label = "handler"
[modelParams]
model = "openrouter/anthropic/claude-3.5-sonnet"
+++

Handler deck.`,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: Request | URL | string) => {
    const url = resolveUrl(input);
    if (url.includes("openrouter.test")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ id: "anthropic/claude-3.5-sonnet" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (url.includes("ollama.test")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ id: "llama3" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };

  try {
    await handleCheckCommand({
      deckPath: rootDeck,
      openRouterBaseURL: "https://openrouter.test/v1",
      ollamaBaseURL: "http://ollama.test/v1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("check reports missing models", async () => {
  const dir = await Deno.makeTempDir();
  const rootDeck = await writeDeck(
    dir,
    "root.deck.md",
    `+++
label = "root"
[modelParams]
model = "anthropic/claude-3.5-sonnet"
[[testDecks]]
label = "child"
path = "./child.deck.md"
+++

Root deck.`,
  );
  await writeDeck(
    dir,
    "child.deck.md",
    `+++
label = "child"
[modelParams]
model = "ollama/llama3"
+++

Child deck.`,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

  try {
    await assertRejects(
      () =>
        handleCheckCommand({
          deckPath: rootDeck,
          openRouterBaseURL: "https://openrouter.test/v1",
          ollamaBaseURL: "http://ollama.test/v1",
        }),
      Error,
      "Missing models detected:",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("check includes handler models", async () => {
  const dir = await Deno.makeTempDir();
  const rootDeck = await writeDeck(
    dir,
    "root.deck.md",
    `+++
label = "root"
[handlers.onError]
path = "./handler.deck.md"
+++

Root deck.`,
  );
  await writeDeck(
    dir,
    "handler.deck.md",
    `+++
label = "handler"
[modelParams]
model = "ollama/missing-model"
+++

Handler deck.`,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: Request | URL | string) => {
    const url = resolveUrl(input);
    if (url.includes("ollama.test")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  };

  try {
    await assertRejects(
      () =>
        handleCheckCommand({
          deckPath: rootDeck,
          openRouterBaseURL: "https://openrouter.test/v1",
          ollamaBaseURL: "http://ollama.test/v1",
        }),
      Error,
      "Missing models detected:",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
