import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import * as path from "@std/path";
import { loadMarkdownDeck } from "./markdown.ts";

async function writeTempDeck(dir: string, filename: string, contents: string) {
  const target = path.join(dir, filename);
  await Deno.writeTextFile(target, contents);
  return target;
}

Deno.test("markdown deck resolves gambit://cards embeds", async () => {
  const dir = await Deno.makeTempDir();

  const deckPath = await writeTempDeck(
    dir,
    "builtin-cards.deck.md",
    `+++
label = "builtin-cards"
+++

![](gambit://cards/respond.card.md)
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assertEquals(deck.respond, true);
  assertStringIncludes(deck.body ?? "", "gambit_respond");
});

Deno.test("markdown deck expands legacy gambit:// markers", async () => {
  const dir = await Deno.makeTempDir();

  const deckPath = await writeTempDeck(
    dir,
    "legacy-markers.deck.md",
    `+++
label = "legacy-markers"
+++

![](gambit://init)
![](gambit://respond)
![](gambit://end)
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assertEquals(deck.respond, true);
  assertEquals(deck.allowEnd, true);
  assertStringIncludes(deck.body ?? "", "gambit_context");
  assertStringIncludes(deck.body ?? "", "gambit_respond");
  assertStringIncludes(deck.body ?? "", "gambit_end");
});

Deno.test("markdown deck resolves gambit://schemas references", async () => {
  const dir = await Deno.makeTempDir();

  const deckPath = await writeTempDeck(
    dir,
    "builtin-schema.deck.md",
    `+++
label = "builtin-schema"
contextSchema = "gambit://schemas/graders/respond.ts"
+++

Schema deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assert(deck.contextSchema, "expected context schema to resolve");
  const parsed = deck.contextSchema.parse({ status: "ok" });
  assertEquals(parsed, { status: "ok" });
});

Deno.test("markdown deck warns on legacy schema keys", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "legacy-schema.deck.md",
    `+++
label = "legacy-schema"
inputSchema = "gambit://schemas/graders/respond.ts"
outputSchema = "gambit://schemas/graders/respond.ts"
+++

Schema deck.
`,
  );

  const warnings: Array<string> = [];
  // deno-lint-ignore no-console
  const originalWarn = console.warn;
  // deno-lint-ignore no-console
  console.warn = (message?: unknown, ...rest: Array<unknown>) => {
    warnings.push([message, ...rest].map(String).join(" "));
  };
  try {
    const deck = await loadMarkdownDeck(deckPath);
    assert(deck.contextSchema, "expected context schema to resolve");
    assert(deck.responseSchema, "expected response schema to resolve");
  } finally {
    // deno-lint-ignore no-console
    console.warn = originalWarn;
  }

  assert(
    warnings.some((line) => line.includes('deprecated "inputSchema"')),
    "expected legacy inputSchema warning",
  );
  assert(
    warnings.some((line) => line.includes('deprecated "outputSchema"')),
    "expected legacy outputSchema warning",
  );
});
