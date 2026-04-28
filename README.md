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
npx @bolt-foundry/gambit-simulator serve gambit/hello.deck.md
open http://localhost:8000/debug
```

Use the Build tab to draft your own workspace decks and scenarios.

Run an example in the terminal (`repl`):

```
npx @bolt-foundry/gambit repl gambit/hello.deck.md
```

This example just says "hello" and repeats your message back to you.

Run an example in the browser (`serve` via the simulator package):

```
npx @bolt-foundry/gambit-simulator serve gambit/hello.deck.md
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

Start the Debug UI server with the simulator package:

```
npx @bolt-foundry/gambit-simulator serve <deck> --port 8000
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

The simulator is the local Debug UI that streams runs and renders traces. It now
lives in `@bolt-foundry/gambit-simulator`, not the framework package.

Run with npx (no install):

```
npx @bolt-foundry/gambit-simulator <command>
```

Start it:

```
npx @bolt-foundry/gambit-simulator serve <deck> --port 8000
```

Then open:

```
http://localhost:8000/
```

It also serves:

```
http://localhost:8000/test
http://localhost:8000/grade
http://localhost:8000/verify (enabled by default; disable with GAMBIT_SIMULATOR_VERIFY_TAB=0)
```

To seed deterministic Verify fixtures for local iteration:

```bash
cd packages/gambit
deno task verify:seed-fixture
```

The Debug UI shows transcript lanes plus a trace/tools feed. If the deck has an\
`contextSchema`, the UI renders a schema-driven form with defaults and a raw
JSON\
tab. Local-first state is stored under `.gambit/` (sessions, traces, notes).

### Build Chat Provider (Workbench)

Workbench build chat defaults to Codex CLI (`codex-cli/default`). To run build
chat through Claude Code CLI instead (no OpenRouter path), set:

```bash
export GAMBIT_SIMULATOR_BUILD_CHAT_PROVIDER=claude-code-cli
```

Optional overrides:

```bash
export GAMBIT_SIMULATOR_BUILD_CHAT_MODEL=claude-code-cli/default
export GAMBIT_SIMULATOR_BUILD_CHAT_MODEL_FORCE=claude-code-cli/sonnet
```

When the simulator is running, you can also switch providers in the Workbench
header (left of `New chat`).

## Using the Library

Use the library when you want TypeScript decks/cards or custom compute steps.

Import the helpers from JSR:

```
import { defineDeck, defineCard } from "jsr:@bolt-foundry/gambit";
```

## Related

- `reviews/2026-04-15-AAR-raw-response-items.md`

Define `contextSchema`/`responseSchema` with Zod to validate IO, and implement\
`run`/`execute` for compute decks. To call a child deck from code, use\
`ctx.spawnAndWait({ path, input })`. Emit structured trace events with\
`ctx.log(...)`.

### Runtime defaults for programmatic `runDeckResponses`

`runDeckResponses` from `@bolt-foundry/gambit` is the canonical Gambit 1.0
runtime entrypoint. It uses CLI-equivalent provider/model defaults (alias
expansion, provider routing, fallback behavior) and returns structured Responses
output. Single-string assistant text is a presentation projection, not runtime
state.

Before (direct-provider setup in each caller):

```ts
import {
  createOpenRouterProvider,
  runDeckResponses,
} from "jsr:@bolt-foundry/gambit";

const provider = createOpenRouterProvider({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
});
await runDeckResponses({
  path: "./root.deck.md",
  input: { message: "hi" },
  modelProvider: provider,
});
```

After (defaulted wrapper):

```ts
import { runDeckResponses } from "jsr:@bolt-foundry/gambit";

const result = await runDeckResponses({
  path: "./root.deck.md",
  input: { message: "hi" },
});

console.log(result.output);
```

Per-runtime override (shared runtime object):

```ts
import {
  createDefaultedRuntime,
  runDeckResponses,
} from "jsr:@bolt-foundry/gambit";

const runtime = await createDefaultedRuntime({
  fallbackProvider: "codex-cli",
});

await runDeckResponses({
  runtime,
  path: "./root.deck.md",
  input: { message: "hi" },
});
```

Replacement mapping:

- Legacy direct core passthrough export: `runDeck` -> `runDeckCore`
- Canonical structured defaulted export: `runDeckResponses`
- Legacy defaulted compatibility export: `runDeck`
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
[[actions]]
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

### Legacy respond-flow demo (historical compatibility)

`packages/gambit/examples/respond_flow/` is kept as a legacy compatibility
example for historical transcript/grader behavior. New decks should return
schema-valid assistant output directly instead of calling `gambit_respond`.

```
cd packages/gambit
npx @bolt-foundry/gambit-simulator serve ./examples/respond_flow/decks/root.deck.ts --port 8000
```

Then:

1. Open `http://localhost:8000/test`, pick the **Escalation persona**, and run
   it. Leave the “Use scenario deck input for init” toggle on to see persona
   data seed the init form automatically.
2. Switch to the Debug tab to inspect the session; this scenario still emits
   legacy `gambit_respond` payloads for compatibility testing.
3. Head to the Calibrate tab and run the **Respond payload grader** to validate
   historical non-root respond-output handling.

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
deno run -A jsr:@bolt-foundry/gambit-simulator/cli serve <deck> --port 8000
```
