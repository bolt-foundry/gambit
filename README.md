# Gambit (draft README)

Gambit helps developers build the most accurate LLM apps by making it simple to
provide exactly the right amount of context at the right time.

## Status quo

- Most teams wire one long prompt to several tools and hope the model routes
  correctly.
- Context often arrives as a single giant fetch or RAG blob, so costs climb and
  hallucinations slip in.
- Input/outputs are rarely typed, which makes orchestration brittle and hard to
  test offline.
- Debugging leans on provider logs instead of local traces, so reproducing
  failures is slow.

## Our vision

- Treat each step as a small deck with explicit inputs/outputs and guardrails;
  model calls are just one kind of action.
- Mix LLM and compute tasks interchangeably and effortlessly inside the same
  deck tree.
- Feed models only what they need per step; inject references and cards instead
  of dumping every document.
- Keep orchestration logic local and testable; run decks offline with
  predictable traces.
- Ship with built-in observability (streaming, REPL, simulator) so debugging
  feels like regular software, not guesswork.

## 5-minute quickstart

Requirements: Deno 2.2+ and `OPENROUTER_API_KEY` (set `OPENROUTER_BASE_URL` if
you proxy OpenRouter-style APIs).

Run the CLI directly from JSR (no install):

```sh
export OPENROUTER_API_KEY=...
deno run -A jsr:@bolt-foundry/gambit/cli --help
```

Run a packaged example without cloning:

```sh
export OPENROUTER_API_KEY=...
deno run -A jsr:@bolt-foundry/gambit/cli run --example hello_world.deck.md --input '"hi"'
```

Run the built-in assistant (from a clone of this repo):

```sh
export OPENROUTER_API_KEY=...
deno run -A src/cli.ts run src/decks/gambit-assistant.deck.md --input '"hi"' --stream
```

Talk to it in a REPL (default deck is `src/decks/gambit-assistant.deck.md`):

```sh
deno run -A src/cli.ts repl --message '"hello"' --stream --verbose
```

Open the simulator UI:

```sh
deno run -A src/cli.ts serve src/decks/gambit-assistant.deck.md --port 8000
open http://localhost:8000/
```

Install the CLI once (uses the published JSR package):

```sh
deno install -A -n gambit jsr:@bolt-foundry/gambit/cli
gambit run path/to/root.deck.ts --input '"hi"'
```

If you run from a remote URL (e.g., `jsr:@bolt-foundry/gambit/cli`), pass an
explicit deck path; the default REPL deck only exists in a local checkout.

## Author your first deck

Minimal Markdown deck (model-powered):

```md
+++
label = "hello_world"

[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0
+++

You are a concise assistant. Greet the user and echo the input.
```

Run it:

```sh
deno run -A src/cli.ts run ./hello_world.deck.md --input '"Gambit"' --stream
```

Compute deck in TypeScript (no model call):

```ts
// echo.deck.ts
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

Run it:

```sh
deno run -A src/cli.ts run ./echo.deck.ts --input '{"text":"ping"}'
```

Deck with a child action (calls a TypeScript tool):

```md
+++
label = "agent_with_time"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
actions = [
  { name = "get_time", path = "./get_time.deck.ts", description = "Return the current ISO timestamp." },
]
+++

A tiny agent that calls get_time, then replies with the timestamp and the input.
```

And the child action:

```ts
// get_time.deck.ts
import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "zod";

export default defineDeck({
  label: "get_time",
  inputSchema: z.object({}), // no args
  outputSchema: z.object({ iso: z.string() }),
  run() {
    return { iso: new Date().toISOString() };
  },
});
```

## Repo highlights

- CLI entry: `src/cli.ts`; runtime: `src/runtime.ts`; definitions: `mod.ts`.
- Examples: `examples/hello_world.deck.md`,
  `examples/agent_with_multi_actions/`.
- Simulator assets: `src/server.ts`.
- Tests/lint/format: `deno task test`, `deno task lint`, `deno task fmt`;
  compile binary: `deno task compile`.
- Docs index: `docs/README.md`; authoring guide: `docs/authoring.md`; prompting
  notes: `docs/hourglass.md`; changelog: `CHANGELOG.md`.

## Docs

- Authoring decks/cards: `docs/authoring.md`
- Runtime/guardrails: `docs/runtime.md`
- CLI, REPL, simulator: `docs/cli.md`
- Examples guide: `docs/examples.md`

## Handlers (error/busy/idle)

- Decks may declare `handlers` with `onError`, `onBusy`, and `onIdle`.
  `onInterval` is still accepted but deprecated (alias for `onBusy`).
- Busy handler input:
  `{kind:"busy", source:{deckPath, actionName}, trigger:{reason:"timeout", elapsedMs}, childInput}`
  plus `delayMs`/`repeatMs` knobs.
- Idle handler input:
  `{kind:"idle", source:{deckPath}, trigger:{reason:"idle_timeout", elapsedMs}}`
  with `delayMs` (and optional `repeatMs` if provided).
- Error handler input: `{kind:"error", source, error:{message}, childInput}` and
  should return an envelope `{message?, code?, status?, meta?, payload?}`.
- Example implementations live under `examples/handlers_ts` and
  `examples/handlers_md`.
- Simulator UI streams handler output in a “status” lane (busy/idle) separate
  from assistant turns.

## Handlers (error/busy/idle)

- Decks may declare `handlers` with `onError`, `onBusy`, and `onIdle`.
  `onInterval` is still accepted but deprecated (alias for `onBusy`).
- Busy handler input:
  `{kind:"busy", source:{deckPath, actionName}, trigger:{reason:"timeout", elapsedMs}, childInput}`
  plus `delayMs`/`repeatMs` knobs.
- Idle handler input:
  `{kind:"idle", source:{deckPath}, trigger:{reason:"idle_timeout", elapsedMs}}`
  with `delayMs` (and optional `repeatMs` if provided).
- Error handler input: `{kind:"error", source, error:{message}, childInput}` and
  should return an envelope `{message?, code?, status?, meta?, payload?}`.
- Example implementations live under `examples/handlers_ts` and
  `examples/handlers_md`.
- Simulator UI streams handler output in a “status” lane (busy/idle) separate
  from assistant turns.

## Next steps

- Swap `modelParams.model` or pass `--model`/`--model-force` to test other
  providers.
- Add `actions` to a deck and call child decks; use `spawnAndWait` inside
  compute decks.
- Use `--stream` and `--verbose` while iterating; pass `--trace <file>` to
  capture JSONL traces.
