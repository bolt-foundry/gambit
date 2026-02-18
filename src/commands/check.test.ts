import { assertRejects } from "@std/assert";
import * as path from "@std/path";
import { handleCheckCommand } from "./check.ts";

async function writeDeck(dir: string, name: string, model: string) {
  const deckPath = path.join(dir, name);
  const contents = `+++
label = "test"

[modelParams]
model = "${model}"
+++

Test deck.
`;
  await Deno.writeTextFile(deckPath, contents);
  return deckPath;
}

Deno.test({
  name: "check fails when ollama model is missing",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "ollama/missing-model");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
  try {
    await assertRejects(
      () =>
        handleCheckCommand({
          deckPath,
        }),
      Error,
      "ollama: model not installed",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test({
  name: "check skips remote providers when offline",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "openrouter/test");

  await handleCheckCommand({
    deckPath,
    checkOnline: false,
  });
});

Deno.test({
  name: "check enforces remote providers when online",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "openrouter/test");

  await assertRejects(
    () =>
      handleCheckCommand({
        deckPath,
        checkOnline: true,
      }),
    Error,
    "OPENROUTER_API_KEY",
  );
});

Deno.test({
  name: "check rejects unprefixed models when fallback is none",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "llama3");

  await assertRejects(
    () =>
      handleCheckCommand({
        deckPath,
        fallbackProvider: null,
      }),
    Error,
    "no fallback provider configured",
  );
});

Deno.test({
  name: "check accepts codex-cli-prefixed models without remote checks",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "codex-cli/default");

  await handleCheckCommand({
    deckPath,
    checkOnline: false,
  });
});

Deno.test({
  name: "check accepts bare codex-cli as default alias",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "codex-cli");

  await handleCheckCommand({
    deckPath,
    checkOnline: false,
  });
});

Deno.test({
  name: "check rejects legacy codex-prefixed models",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "codex/default");

  await assertRejects(
    () =>
      handleCheckCommand({
        deckPath,
        checkOnline: false,
      }),
    Error,
    "legacy codex prefix is unsupported",
  );
});
