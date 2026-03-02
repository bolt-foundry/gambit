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
      "is not installed in ollama",
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
    "No fallback provider configured for unprefixed model",
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
    codexLoginStatusChecker: () =>
      Promise.resolve({
        codexLoggedIn: true,
        codexLoginStatus: "Logged in",
      }),
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
    codexLoginStatusChecker: () =>
      Promise.resolve({
        codexLoggedIn: true,
        codexLoginStatus: "Logged in",
      }),
  });
});

Deno.test({
  name: "check fails when codex login status is not authenticated",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "codex-cli/default");

  await assertRejects(
    () =>
      handleCheckCommand({
        deckPath,
        checkOnline: false,
        codexLoginStatusChecker: () =>
          Promise.resolve({
            codexLoggedIn: false,
            codexLoginStatus: "Not logged in. Run `codex login`.",
          }),
      }),
    Error,
    "Not logged in",
  );
});

Deno.test({
  name: "check json mode returns structured failures without throwing",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "root.deck.md", "codex-cli/default");

  const report = await handleCheckCommand({
    deckPath,
    checkOnline: false,
    json: true,
    codexLoginStatusChecker: () =>
      Promise.resolve({
        codexLoggedIn: false,
        codexLoginStatus: "Not logged in. Run `codex login`.",
      }),
  });

  if (report.ok) {
    throw new Error("expected json-mode report to fail");
  }
  if (report.failures.length !== 1) {
    throw new Error(`expected one failure, got ${report.failures.length}`);
  }
  if (report.failures[0].code !== "not_logged_in") {
    throw new Error(
      `expected not_logged_in code, got ${report.failures[0].code}`,
    );
  }
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
    "Legacy codex prefix is unsupported",
  );
});
