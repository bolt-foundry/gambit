# Authoring Gambit decks

Audience: new deck authors who want to build runnable Gambit assistants quickly.
Gambit is an agent harness framework, so decks are the unit of execution and
verification.

## Mental model

- Decks are single units of work. They can be LLM-powered (via `modelParams`) or
  compute-only (via `run`/`execute`).
- Cards are reusable prompt fragments. Embedding cards merges their deck
  references (action/test/grader) and schema fragments into the parent deck.
- Action decks are child decks exposed as model tools. Names must match
  `^[A-Za-z_][A-Za-z0-9_]*$` and avoid the `gambit_` prefix (reserved).
- Persona/test decks may accept free-form user turns. Use the `acceptsUserTurns`
  flag to control this behavior: root decks default to `true`, while action
  decks default to `false`. Set it explicitly to `true` for persona/bot decks or
  to `false` for workflow-only decks.

## Pick a format

- Markdown deck/card: great for quick prompt-first flows. Front matter declares
  label/model/actionDecks/testDecks/graderDecks/handlers; body is the prompt.
  Embeds via image syntax pull in cards or special markers.
- TypeScript deck/card: best when you need compute logic or co-locate schemas.
  Export `defineDeck`/`defineCard` with Zod schemas and a `run`/`execute` for
  compute decks.

## Minimal examples

Markdown LLM deck (`.deck.md`):

```md
+++
label = "hello_world"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
+++

![init](gambit://cards/context.card.md) # seed input if provided via CLI

Rules:

- If input is empty, reply exactly "hello, world".
- Else reply exactly "hello, {input}".
```

TypeScript compute deck (`.deck.ts`):

```ts
import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "zod";

export default defineDeck({
  label: "echo",
  contextSchema: z.object({ text: z.string() }),
  responseSchema: z.object({ text: z.string(), length: z.number() }),
  run(ctx) {
    return { text: ctx.input.text, length: ctx.input.text.length };
  },
});
```

## Schemas and validation

- Non-root decks must declare `contextSchema` and `responseSchema` (Zod). Roots
  default to permissive string-ish input/output if omitted.
- Card `contextFragment`/`responseFragment` merge into the deck’s schemas;
  deck-level definitions win on conflicts.
- LLM outputs are validated against `responseSchema`; compute decks validate
  returned payloads as well.

Legacy `inputSchema`/`outputSchema` and `inputFragment`/`outputFragment` are
deprecated aliases and will emit warnings. Use the new names going forward; to
migrate a repository, run:

```
deno run -A packages/gambit/scripts/migrate-schema-terms.ts <repo-root>
```

## Action decks, test decks, grader decks

- Add action decks in front matter or TS definitions:
  `actionDecks = [{ name = "get_time", path = "./get_time.deck.ts" }]`.
- Action decks defined on embedded cards are merged into the deck; duplicates
  are overridden by the deck’s own entries.
- In compute decks, call child decks with `ctx.spawnAndWait({ path, input })`.
- In LLM decks, the model chooses action decks via tool calls. Provide clear
  descriptions so the model routes correctly.
- `testDecks` describe persona decks (synthetic users/bots). Each entry points
  to a deck that produces user turns/scenarios—use them for automated QA,
  persona-vs-workflow simulations, or even bot-vs-bot runs.
- Example (see `init/examples/advanced/voice_front_desk/decks/root.deck.md`):
  ```toml
  [[testDecks]]
  label = "Synthetic caller – new patient intake"
  path = "./tests/new_patient_intake.deck.md"
  description = "Persona deck that stress-tests identity/routing coverage."
  ```
  The referenced deck (e.g.
  `init/examples/advanced/voice_front_desk/tests/new_patient_intake.deck.md`)
  should set `acceptsUserTurns = true` and may declare its own `contextSchema`
  (for example `contextSchema = "../schemas/my_persona_test.zod.ts"`) so the
  Test tab renders a schema-driven “Scenario” form for that persona.
- For persona/test decks, you can embed
  `![generate-test-input](gambit://cards/generate-test-input.card.md)` to
  include the Test Bot init-fill contract instructions.
- Test Bot init fill: when a Test Bot run is missing required init fields, the
  selected persona deck is asked to supply only the missing values before the
  run begins. The persona receives a single user message containing a JSON
  payload like:
  ```json
  {
    "type": "gambit_test_bot_init_fill",
    "missing": ["customer.name", "issueType"],
    "current": { "channel": "sms" },
    "schemaHints": [
      { "path": "customer.name", "kind": "string", "description": "..." },
      { "path": "issueType", "kind": "enum", "enumValues": ["billing", "ops"] }
    ]
  }
  ```
  The persona should respond with **JSON only**, returning values for the
  missing fields (nested by path). Explicit init values are never overwritten;
  invalid JSON or schema-violating output blocks the run with a clear error.
- `graderDecks` describe calibration decks that score transcripts/artifacts. The
  simulator Calibrate page will run these decks against stored runs.
- Configure `acceptsUserTurns` alongside these references:
  - Markdown roots default to `true`; TypeScript decks default to `false`
    everywhere. Set it to `false` for any workflow deck that should never accept
    user turns (regardless of how it's run).
  - Persona/test decks should set `acceptsUserTurns = true` so they can receive
    messages even when invoked as non-root bots.

## Synthetic tools and handlers

- `gambit_context`: injected automatically when `--context` (formerly `--init`)
  is provided; carries the raw input as the first tool result. `gambit_init`
  remains as a deprecated alias.
- `gambit_respond`: enable by inserting the
  `![respond](gambit://cards/respond.card.md)` marker in Markdown decks (or
  `respond: true` in TypeScript). Required for LLM decks finish via a structured
  envelope: `{ status?, payload, message?, code?, meta? }`.
- `gambit_complete`: emitted by child actions and handled errors to wrap their
  results for the parent.
- Optional handlers (deck-only): `handlers.onBusy`, `handlers.onIdle`,
  `handlers.onError` point to other decks. Inputs are structured (see
  `../reference/handlers.md`); errors inside handlers are swallowed.

## Embeds (cards)

- In Markdown, use image syntax to embed:
  `![behavior](./cards/behavior.card.md)`. Special markers:
  `gambit://cards/context.card.md` hints init tool,
  `gambit://cards/respond.card.md` injects respond instructions, and
  `gambit://cards/end.card.md` enables the `gambit_end` hang-up tool.
- Cards can also be TS files exported with `defineCard`. They may contain
  action/test/grader deck references and schema fragments, but no handlers.

## Running and debugging

- Run once:
  `deno run -A src/cli.ts run path/to/deck --context '"hi"' --message '"hello"' --stream`.
- REPL: `deno run -A src/cli.ts repl path/to/deck --model openai/gpt-4o-mini`.
- Debug UI: `deno run -A src/cli.ts serve path/to/deck --port 8000` then open
  http://localhost:8000/debug.
- Tracing: add `--verbose` for console traces or `--trace out.jsonl` to persist
  events; use `--state state.json` with `run` to persist conversation state
  between turns. When `--state` is omitted, test-bot/serve sessions default to
  `<project-root>/.gambit/sessions/...` where each session includes `state.json`
  (materialized snapshot) plus append-only `events.jsonl`, `feedback.jsonl`, and
  `grading.jsonl` for downstream ingestion. The project root is the nearest
  parent with `deno.json`, `deno.jsonc`, or `package.json` (falling back to the
  deck directory).

### Compute deck logging

- In TypeScript decks, `ctx.log(entry | string)` emits a structured trace event
  (shown with `--verbose`, `--trace`, or in the debug UI). Example:
  ```ts
  run(ctx) {
    ctx.log({ level: "debug", message: "starting fetch", meta: { attempt: 1 } });
    // ...
    return result;
  }
  ```
  Levels: `debug | info | warn | error` (defaults to `info`).

## Guardrails and defaults

- Defaults: `maxDepth=3`, `maxPasses=10`, `timeout≈120s`; override per deck via
  `[guardrails]` or `guardrails` field.
- Busy/idle handlers fire after `delayMs` (default 800ms) and optionally repeat
  with `repeatMs`.

## What to read next

- Examples: `init/hello.deck.md` (LLM),
  `init/examples/advanced/agent_with_typescript/` (Markdown + TS action),
  `init/examples/advanced/agent_with_multi_actions/` (routing with multiple
  action decks), `init/examples/advanced/cli_handlers_*` (busy/idle/error
  handlers).
- Hourglass prompting (context engineering) best practices:
  `../concepts/hourglass.md`.
- Prompt structuring: `../concepts/hourglass.md`.
- Handler details: `../reference/handlers.md`.
