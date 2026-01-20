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
  assertStringIncludes(deck.body ?? "", "gambit_init");
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
inputSchema = "gambit://schemas/graders/respond.ts"
+++

Schema deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assert(deck.inputSchema, "expected input schema to resolve");
  const parsed = deck.inputSchema.parse({ status: "ok" });
  assertEquals(parsed, { status: "ok" });
});
