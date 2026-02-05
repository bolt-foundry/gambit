import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import * as path from "@std/path";
import { loadDeck } from "./loader.ts";
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

Deno.test("markdown deck resolves gambit://snippets embeds", async () => {
  const dir = await Deno.makeTempDir();

  const deckPath = await writeTempDeck(
    dir,
    "builtin-snippets.deck.md",
    `+++
label = "builtin-snippets"
+++

![](gambit://snippets/respond.md)
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
contextSchema = "gambit://schemas/graders/respond.zod.ts"
+++

Schema deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assert(deck.contextSchema, "expected context schema to resolve");
  const parsed = deck.contextSchema.parse({ status: 200 });
  assertEquals(parsed, { status: 200 });
});

Deno.test("markdown deck warns on legacy schema URIs", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "legacy-schema-uri.deck.md",
    `+++
label = "legacy-schema-uri"
contextSchema = "gambit://schemas/graders/respond.ts"
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
  } finally {
    // deno-lint-ignore no-console
    console.warn = originalWarn;
  }

  assert(
    warnings.some((line) =>
      line.includes("deprecated") && line.includes(".ts")
    ),
    "expected legacy schema URI warning",
  );
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

Deno.test("markdown deck parses 1.0 actions/scenarios/graders", async () => {
  const dir = await Deno.makeTempDir();
  const actionDir = path.join(dir, "actions", "do");
  const scenarioDir = path.join(dir, "scenarios", "happy");
  const graderDir = path.join(dir, "graders", "qa");
  await Deno.mkdir(actionDir, { recursive: true });
  await Deno.mkdir(scenarioDir, { recursive: true });
  await Deno.mkdir(graderDir, { recursive: true });

  await writeTempDeck(
    actionDir,
    "PROMPT.md",
    `+++
label = "do"
+++
Action deck.
`,
  );
  await writeTempDeck(
    scenarioDir,
    "PROMPT.md",
    `+++
label = "happy"
+++
Scenario deck.
`,
  );
  await writeTempDeck(
    graderDir,
    "PROMPT.md",
    `+++
label = "qa"
+++
Grader deck.
`,
  );

  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"

[[actions]]
name = "do_thing"
path = "./actions/do/PROMPT.md"
description = "Run the do thing action."

[[scenarios]]
path = "./scenarios/happy/PROMPT.md"

[[graders]]
path = "./graders/qa/PROMPT.md"
+++

Root deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);
  assertEquals(deck.actionDecks.length, 1);
  assertEquals(deck.actionDecks[0].name, "do_thing");
  assert(deck.actionDecks[0].path.endsWith("actions/do/PROMPT.md"));
  assertEquals(deck.testDecks.length, 1);
  assert(deck.testDecks[0].path.endsWith("scenarios/happy/PROMPT.md"));
  assertEquals(deck.graderDecks.length, 1);
  assert(deck.graderDecks[0].path.endsWith("graders/qa/PROMPT.md"));
});

Deno.test("markdown deck requires action descriptions in 1.0 actions", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"

[[actions]]
name = "do_thing"
path = "./actions/do/PROMPT.md"
+++

Root deck.
`,
  );

  await assertRejects(
    () => loadMarkdownDeck(deckPath),
    Error,
    "description",
  );
});

Deno.test("markdown execute deck loads module and PROMPT overrides schemas", async () => {
  const dir = await Deno.makeTempDir();
  const execPath = path.join(dir, "exec.ts");
  const definitionsUrl = path.toFileUrl(
    path.resolve("packages/gambit-core/src/definitions.ts"),
  ).href;
  await Deno.writeTextFile(
    execPath,
    `import { defineDeck } from "${definitionsUrl}";
import { z } from "zod";

export default defineDeck({
  label: "exec",
  contextSchema: z.object({ fromExec: z.string() }),
  responseSchema: z.object({ out: z.string() }),
  run: (_ctx) => ({ out: "ok" }),
});
`,
  );

  const schemaPath = path.join(dir, "context.zod.ts");
  await Deno.writeTextFile(
    schemaPath,
    `import { z } from "zod";
export default z.object({ fromPrompt: z.number() });
`,
  );

  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "exec-root"
execute = "./exec.ts"
contextSchema = "./context.zod.ts"
+++

Execute deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);
  assert(deck.executor, "expected executor to be set");
  assert(deck.contextSchema, "expected context schema to resolve");
  deck.contextSchema.parse({ fromPrompt: 123 });
});

Deno.test("loadDeck resolves gambit://decks PROMPT.md", async () => {
  const deck = await loadDeck(
    "gambit://decks/openai/codex-sdk/PROMPT.md",
  );
  assertEquals(deck.label, "Codex SDK bridge");
});
