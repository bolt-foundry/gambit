# <img src="./gambit_1color_bg.png" alt="Gambit logo" height="50" />

Gambit is an open-source, developer-first framework that helps you build\
reliable LLM workflows by composing small, typed “decks”\
with clear inputs/outputs and guardrails. Run decks locally, stream traces, and\
debug with a built-in UI.

[Watch the demo video](https://youtu.be/J_hQ2L_yy60).

## Quickstart

Requirements: Node.js 18+ and `OPENROUTER_API_KEY` (set `OPENROUTER_BASE_URL` if
you proxy OpenRouter-style APIs).

Run the CLI directly with npx (no install):

```
export OPENROUTER_API_KEY=...
npx @bolt-foundry/gambit demo
```

Downloads example files (hello decks plus the `examples/` gallery) and sets
environment variables.

To start onboarding with the simulator, run:

```
npx @bolt-foundry/gambit serve gambit/hello.deck.md
open http://localhost:8000/debug
```

Use the Build tab to draft your own workspace decks and scenarios.

Run an example in the terminal (`repl`):

```
npx @bolt-foundry/gambit repl gambit/hello.deck.md
```

This example just says "hello" and repeats your message back to you.

Run an example in the browser (`serve`):

```
npx @bolt-foundry/gambit serve gambit/hello.deck.md
open http://localhost:8000/debug
```

---

## Status quo

- Most teams wire one long prompt to several tools and hope the model routes\
  correctly.
- Context often arrives as a single giant fetch or RAG blob, so costs climb and\
  hallucinations slip in.
- Input/outputs are rarely typed, which makes orchestration brittle and hard to\
  test offline.
- Debugging leans on provider logs instead of local traces, so reproducing\
  failures is slow.

## Our vision

- Treat each step as a small deck with explicit inputs/outputs and guardrails;\
  model calls are just one kind of action.
- Mix LLM and compute tasks interchangeably and effortlessly inside the same\
  deck tree.
- Feed models only what they need per step; inject references and cards instead\
  of dumping every document.
- Keep orchestration logic local and testable; run decks offline with\
  predictable traces.
- Ship with built-in observability (streaming, REPL, debug UI) so debugging\
  feels like regular software, not guesswork.

---

## Using the CLI

Use the CLI to run decks locally, stream output, and capture traces/state.

Run with npx (no install):

```
npx @bolt-foundry/gambit <command>
```

Run a deck once:

```
npx @bolt-foundry/gambit run <deck> --context <json|string> --message <json|string>
```

> `--context` replaces the old `--init` flag. The CLI still accepts `--init` as
> a deprecated alias for now so existing scripts keep working.

Drop into a REPL (streams by default):

```
npx @bolt-foundry/gambit repl <deck>
```

Run a persona against a root deck (scenario):

```
npx @bolt-foundry/gambit scenario <root-deck> --test-deck <persona-deck>
```

Grade a saved session:

```
npx @bolt-foundry/gambit grade <grader-deck> --state <file>
```

Start the Debug UI server:

```
npx @bolt-foundry/gambit serve <deck> --port 8000
```

Tracing and state: 

`--trace <file>` for JSONL traces\
`--verbose` to print events\
`--state <file>` to persist a session.

### Worker sandbox defaults

- Deck-executing CLI surfaces default to worker sandbox execution.
- Use `--no-worker-sandbox` (or `--legacy-exec`) to force legacy in-process
  execution.
- `--worker-sandbox` explicitly forces worker execution on.
- `--sandbox` / `--no-sandbox` are deprecated aliases.
- `gambit.toml` equivalent:
  ```toml
  [execution]
  worker_sandbox = false # same as --no-worker-sandbox
  # legacy_exec = true    # equivalent rollback toggle
  ```

The npm launcher (`npx @bolt-foundry/gambit ...`) runs the Gambit CLI binary for
your platform, so these defaults and flags apply there as well.

## Using the Simulator

The simulator is the local Debug UI that streams runs and renders traces.

Run with npx (no install):

```
npx @bolt-foundry/gambit <command>
```

Start it:

```
npx @bolt-foundry/gambit serve <deck> --port 8000
```

Then open:

```
http://localhost:8000/
```

It also serves:

```
http://localhost:8000/test
http://localhost:8000/grade
```

The Debug UI shows transcript lanes plus a trace/tools feed. If the deck has an\
`contextSchema`, the UI renders a schema-driven form with defaults and a raw
JSON\
tab. Local-first state is stored under `.gambit/` (sessions, traces, notes).

## Using the Library

Use the library when you want TypeScript decks/cards or custom compute steps.

Import the helpers from JSR:

```
import { defineDeck, defineCard } from "jsr:@bolt-foundry/gambit";
```

Define `contextSchema`/`responseSchema` with Zod to validate IO, and implement\
`run`/`execute` for compute decks. To call a child deck from code, use\
`ctx.spawnAndWait({ path, input })`. Emit structured trace events with\
`ctx.log(...)`.

### Runtime defaults for programmatic `runDeck`

`runDeck` from `@bolt-foundry/gambit` now uses CLI-equivalent provider/model
defaults (alias expansion, provider routing, fallback behavior).

Before (direct-provider setup in each caller):

```ts
import { createOpenRouterProvider, runDeck } from "jsr:@bolt-foundry/gambit";

const provider = createOpenRouterProvider({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
});
await runDeck({
  path: "./root.deck.md",
  input: { message: "hi" },
  modelProvider: provider,
});
```

After (defaulted wrapper):

```ts
import { runDeck } from "jsr:@bolt-foundry/gambit";

await runDeck({
  path: "./root.deck.md",
  input: { message: "hi" },
});
```

Per-runtime override (shared runtime object):

```ts
import { createDefaultedRuntime, runDeck } from "jsr:@bolt-foundry/gambit";

const runtime = await createDefaultedRuntime({
  fallbackProvider: "codex-cli",
});

await runDeck({
  runtime,
  path: "./root.deck.md",
  input: { message: "hi" },
});
```

Replacement mapping:

- Legacy direct core passthrough export: `runDeck` -> `runDeckCore`
- Defaulted wrapper export: `runDeck`
- Runtime builder: `createDefaultedRuntime`

---

## Author your first deck

### Minimal Markdown deck (model-powered): `hello_world.deck.md`

```
+++
label = "hello_world"

[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0
+++

You are a concise assistant. Greet the user and echo the input.
```

Run it:

```
npx @bolt-foundry/gambit run ./hello_world.deck.md --context '"Gambit"' --stream
```

### Compute deck in TypeScript (no model call): `echo.deck.ts`

```typescript
// echo.deck.ts
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

Run it:

```
npx @bolt-foundry/gambit run ./echo.deck.ts --context '{"text":"ping"}'
```

### Deck with a child action (calls a TypeScript tool): `agent_with_time.deck.md`

```
+++
label = "agent_with_time"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
[[actionDecks]]
name = "get_time"
path = "./get_time.deck.ts"
description = "Return the current ISO timestamp."
+++

A tiny agent that calls get_time, then replies with the timestamp and the input.
```

And the child action: `get_time.deck.ts`

```typescript
// get_time.deck.ts
import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "zod";

export default defineDeck({
  label: "get_time",
  contextSchema: z.object({}), // no args
  responseSchema: z.object({ iso: z.string() }),
  run() {
    return { iso: new Date().toISOString() };
  },
});
```

Run it:

```
npx @bolt-foundry/gambit run ./agent_with_time.deck.md --context '"hello"' --stream
```

### Respond flow demo (non-root decks + grading)

Need a turnkey scenario that hits personas → init → non-root `gambit_respond`
payloads → graders? Use the example in `packages/gambit/examples/respond_flow/`.

```
cd packages/gambit
npx @bolt-foundry/gambit serve ./examples/respond_flow/decks/root.deck.ts --port 8000
```

Then:

1. Open `http://localhost:8000/test`, pick the **Escalation persona**, and run
   it. Leave the “Use scenario deck input for init” toggle on to see persona
   data seed the init form automatically.
2. Switch to the Debug tab to inspect the session—the child deck emits a
   `gambit_respond` payload that now shows up as a structured assistant turn.
3. Head to the Calibrate tab and run the **Respond payload grader** to exercise
   grading on the non-root respond output.

## Deno

If you prefer Deno, use the Deno commands below.

Quickstart:

```
export OPENROUTER_API_KEY=...
deno run -A jsr:@bolt-foundry/gambit/cli demo
```

Run a deck:

```
deno run -A jsr:@bolt-foundry/gambit/cli run <deck> --context <json|string> --message <json|string>
```

Start the Debug UI:

```
deno run -A jsr:@bolt-foundry/gambit/cli serve <deck> --port 8000
```
