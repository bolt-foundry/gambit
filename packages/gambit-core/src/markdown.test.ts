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

Deno.test("markdown deck resolves scenario participant snippet embed", async () => {
  const dir = await Deno.makeTempDir();

  const deckPath = await writeTempDeck(
    dir,
    "scenario-participant-snippet.deck.md",
    `+++
label = "scenario-participant-snippet"
+++

![](gambit://snippets/scenario-participant.md)
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assertStringIncludes(deck.body ?? "", "synthetic scenario participant");
  assertStringIncludes(deck.body ?? "", "exactly one empty message");
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

Deno.test("markdown deck resolves tool-call-aware grader context schema", async () => {
  const dir = await Deno.makeTempDir();

  const deckPath = await writeTempDeck(
    dir,
    "turn-tools-schema.deck.md",
    `+++
label = "turn-tools-schema"
contextSchema = "gambit://schemas/graders/contexts/turn_tools.zod.ts"
+++

Schema deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assert(deck.contextSchema, "expected context schema to resolve");
  const parsed = deck.contextSchema.parse({
    session: {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              function: {
                name: "bot_write",
                arguments: '{"path":"PROMPT.md"}',
              },
            },
          ],
        },
      ],
    },
    messageToGrade: {
      role: "assistant",
      tool_calls: [
        {
          function: {
            name: "bot_write",
          },
        },
      ],
    },
  });

  assertEquals(parsed.messageToGrade.role, "assistant");
  assertEquals(
    parsed.session.messages?.[0].tool_calls?.[0].function.name,
    "bot_write",
  );
});

Deno.test("markdown deck resolves conversation-level tool-call grader context schema", async () => {
  const dir = await Deno.makeTempDir();

  const deckPath = await writeTempDeck(
    dir,
    "conversation-tools-schema.deck.md",
    `+++
label = "conversation-tools-schema"
contextSchema = "gambit://schemas/graders/contexts/conversation_tools.zod.ts"
+++

Schema deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);

  assert(deck.contextSchema, "expected context schema to resolve");
  const parsed = deck.contextSchema.parse({
    session: {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              function: {
                name: "bot_write",
                arguments: '{"path":"faq-bot/PROMPT.md"}',
              },
            },
          ],
        },
      ],
    },
  });

  assertEquals(
    parsed.session.messages?.[0].tool_calls?.[0].function.name,
    "bot_write",
  );
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

Deno.test("markdown deck loads without front matter", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `You are a plain markdown deck with no front matter.`,
  );

  const deck = await loadMarkdownDeck(deckPath);
  assertEquals(deck.label, undefined);
  assertStringIncludes(deck.body ?? "", "plain markdown deck");
});

Deno.test("markdown deck rejects malformed explicit front matter", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "broken"

This file is missing a closing delimiter.
`,
  );

  await assertRejects(
    () => loadMarkdownDeck(deckPath),
    Error,
    "Failed to parse front matter",
  );
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

Deno.test("markdown deck resolves deck and action permissions from owner paths", async () => {
  const dir = await Deno.makeTempDir();
  const actionDir = path.join(dir, "actions", "do");
  await Deno.mkdir(actionDir, { recursive: true });
  await writeTempDeck(
    actionDir,
    "PROMPT.md",
    `+++
label = "do"
permissions.read = ["./action-only"]
+++
Action deck.
`,
  );

  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
permissions.read = ["./workspace"]

[[actions]]
name = "do_thing"
path = "./actions/do/PROMPT.md"
description = "run do thing"
permissions.read = ["./action-overrides"]
+++
Root deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);
  assertEquals(deck.permissions?.read, [path.resolve(dir, "workspace")]);
  assertEquals(deck.actionDecks[0].permissions?.read, [
    path.resolve(dir, "action-overrides"),
  ]);
});

Deno.test("markdown deck rejects top-level execute", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
execute = "./compute.deck.ts"
+++

Root deck.
`,
  );

  await assertRejects(
    () => loadMarkdownDeck(deckPath),
    Error,
    "Top-level execute",
  );
});

Deno.test("markdown deck rejects action target with both path and execute", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"

[[actions]]
name = "do_thing"
path = "./actions/do/PROMPT.md"
execute = "./actions/do.deck.ts"
description = "Run do thing."
contextSchema = "./schemas/in.zod.ts"
responseSchema = "./schemas/out.zod.ts"
+++

Root deck.
`,
  );

  await assertRejects(
    () => loadMarkdownDeck(deckPath),
    Error,
    "exactly one of path or execute",
  );
});

Deno.test("markdown deck rejects action target with neither path nor execute", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"

[[actions]]
name = "do_thing"
description = "Run do thing."
+++

Root deck.
`,
  );

  await assertRejects(
    () => loadMarkdownDeck(deckPath),
    Error,
    "exactly one of path or execute",
  );
});

Deno.test("markdown deck normalizes actions execute targets with schemas", async () => {
  const dir = await Deno.makeTempDir();
  const inputSchemaPath = path.join(dir, "input.zod.ts");
  const outputSchemaPath = path.join(dir, "output.zod.ts");
  await Deno.writeTextFile(
    inputSchemaPath,
    `import { z } from "zod";
export default z.object({ count: z.number() });
`,
  );
  await Deno.writeTextFile(
    outputSchemaPath,
    `import { z } from "zod";
export default z.object({ total: z.number() });
`,
  );

  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"

[[actions]]
name = "compute_rollup"
execute = "./actions/compute_rollup.deck.ts"
description = "Compute rollup totals."
contextSchema = "./input.zod.ts"
responseSchema = "./output.zod.ts"
+++

Root deck.
`,
  );

  const deck = await loadMarkdownDeck(deckPath);
  assertEquals(deck.actionDecks.length, 1);
  assert(deck.actionDecks[0].path.endsWith("actions/compute_rollup.deck.ts"));
  assertEquals(
    deck.actionDecks[0].execute,
    deck.actionDecks[0].path,
  );
  const parsedInput = deck.actionDecks[0].contextSchema?.parse({ count: 2 });
  const parsedOutput = deck.actionDecks[0].responseSchema?.parse({ total: 3 });
  assertEquals(parsedInput, { count: 2 });
  assertEquals(parsedOutput, { total: 3 });
});

Deno.test("loadDeck resolves gambit://decks PROMPT.md", async () => {
  const deck = await loadDeck(
    "gambit://decks/openai/codex-sdk/PROMPT.md",
  );
  assertEquals(deck.label, "Codex SDK bridge");
});

Deno.test("markdown deck rejects unsupported mcpServers declarations", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"

[[mcpServers]]
name = "local"
command = "node"
+++
Root deck.
`,
  );

  await assertRejects(
    () => loadMarkdownDeck(deckPath),
    Error,
    "[[mcpServers]]",
  );
});

Deno.test("markdown deck parses tools and warns when action shadows a tool", async () => {
  const dir = await Deno.makeTempDir();
  const actionDir = path.join(dir, "actions", "do");
  await Deno.mkdir(actionDir, { recursive: true });
  await writeTempDeck(
    actionDir,
    "PROMPT.md",
    `+++
label = "do"
contextSchema = "gambit://schemas/graders/respond.zod.ts"
responseSchema = "gambit://schemas/graders/respond.zod.ts"
+++
Action deck.
`,
  );
  const schemaPath = path.join(dir, "tool_input.zod.ts");
  await Deno.writeTextFile(
    schemaPath,
    `import { z } from "zod";
export default z.object({ query: z.string() });
`,
  );
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"

[[actions]]
name = "search_docs"
path = "./actions/do/PROMPT.md"
description = "Run action."

[[tools]]
name = "search_docs"
description = "External search."
inputSchema = "./tool_input.zod.ts"

[[tools]]
name = "external_lookup"
description = "External lookup."
inputSchema = "./tool_input.zod.ts"
+++
Root deck.
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
    assertEquals(deck.tools.length, 2);
    assertEquals(deck.tools[0].name, "search_docs");
    assertEquals(deck.tools[1].name, "external_lookup");
    assert(deck.tools[1].inputSchema, "expected tool input schema");
    const parsed = deck.tools[1].inputSchema?.parse({ query: "q" });
    assertEquals(parsed, { query: "q" });
  } finally {
    // deno-lint-ignore no-console
    console.warn = originalWarn;
  }

  assert(
    warnings.some((line) =>
      line.includes("shadowed") && line.includes("search_docs")
    ),
    "expected action-shadow warning for tool name collision",
  );
});
