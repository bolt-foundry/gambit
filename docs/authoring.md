# Authoring Gambit decks

Audience: new deck authors who want to build runnable Gambit assistants quickly.

## Mental model

- Decks are single units of work. They can be LLM-powered (via `modelParams`) or
  compute-only (via `run`/`execute`).
- Cards are reusable prompt fragments. Embedding cards merges their actions and
  schema fragments into the deck.
- Actions are child decks exposed as model tools. Names must match
  `^[A-Za-z_][A-Za-z0-9_]*$` and avoid the `gambit_` prefix (reserved).

## Pick a format

- Markdown deck/card: great for quick prompt-first flows. Front matter declares
  label/model/actions/handlers; body is the prompt. Embeds via image syntax pull
  in cards or special markers.
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

![init](gambit://init) # seed input if provided via CLI

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
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string(), length: z.number() }),
  run(ctx) {
    return { text: ctx.input.text, length: ctx.input.text.length };
  },
});
```

## Schemas and validation

- Non-root decks must declare `inputSchema` and `outputSchema` (Zod). Roots
  default to permissive string-ish input/output if omitted.
- Card `inputFragment`/`outputFragment` merge into the deck’s schemas;
  deck-level definitions win on conflicts.
- LLM outputs are validated against `outputSchema`; compute decks validate
  returned payloads as well.

## Actions (tools)

- Add actions in front matter or TS definitions:
  `actions = [{ name = "get_time", path = "./get_time.deck.ts" }]`.
- Actions defined on embedded cards are merged into the deck; duplicates are
  overridden by the deck’s own actions.
- In compute decks, call child decks with `ctx.spawnAndWait({ path, input })`.
- In LLM decks, the model chooses actions via tool calls. Provide clear
  descriptions so the model routes correctly.

## Synthetic tools and handlers

- `gambit_init`: injected automatically when `--input` is provided; carries the
  raw input as the first tool result.
- `gambit_respond`: enable by setting `syntheticTools.respond = true` (or
  `![...](gambit://respond)` in Markdown). Required for LLM decks that should
  finish via a structured envelope:
  `{ status?, payload, message?, code?, meta? }`.
- `gambit_complete`: emitted by child actions and handled errors to wrap their
  results for the parent.
- Optional handlers (deck-only): `handlers.onBusy`, `handlers.onIdle`,
  `handlers.onError` point to other decks. Inputs are structured (see
  `docs/handlers.md`); errors inside handlers are swallowed.

## Embeds (cards)

- In Markdown, use image syntax to embed:
  `![behavior](./cards/behavior.card.md)`. Special markers: `gambit://init`
  hints init tool, `gambit://respond` injects respond instructions.
- Cards can also be TS files exported with `defineCard`. They may contain
  actions and schema fragments, but no handlers.

## Running and debugging

- Run once:
  `deno run -A src/cli.ts run path/to/deck --input '"hi"' --message '"hello"' --stream`.
- REPL: `deno run -A src/cli.ts repl path/to/deck --model openai/gpt-4o-mini`.
- Simulator UI: `deno run -A src/cli.ts serve path/to/deck --port 8000` then
  open http://localhost:8000/.
- Tracing: add `--verbose` for console traces or `--trace out.jsonl` to persist
  events; use `--state state.json` with `run` to persist conversation state
  between turns.

## Guardrails and defaults

- Defaults: `maxDepth=3`, `maxPasses=3`, `timeout≈120s`; override per deck via
  `[guardrails]` or `guardrails` field.
- Busy/idle handlers fire after `delayMs` (default 800ms) and optionally repeat
  with `repeatMs`.

## What to read next

- Examples: `examples/hello_world.deck.md` (LLM),
  `examples/agent_with_typescript/` (Markdown + TS action),
  `examples/agent_with_multi_actions/` (routing with multiple tools),
  `examples/handlers_*` (busy/idle/error handlers).
- Prompt structuring: `docs/hourglass.md`.
- Handler details: `docs/handlers.md`.
