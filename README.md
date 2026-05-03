# <img src="./gambit_1color_bg.png" alt="Gambit logo" height="50" />

Agent frameworks help you build agents. Gambit helps you create the evidence
that they work.

Gambit is the synthetic scenario and evaluation layer for agent systems: create
realistic scenarios, validate their quality, run agents against them, grade the
behavior, capture trace evidence, and turn failures into regression suites.

Native Gambit agents are still the fastest path to the fully integrated loop:
typed inputs and outputs, local runs, scenarios, graders, traces, permission
evidence, and the simulator's Build/Test/Grade/Verify workflow.

[Watch the demo video](https://youtu.be/J_hQ2L_yy60).

## Quickstart

Requirements: Node.js 18+ and `OPENROUTER_API_KEY` (set `OPENROUTER_BASE_URL` if
you proxy OpenRouter-style APIs).

Run the CLI directly with npx (no install):

```
export OPENROUTER_API_KEY=...
npx @bolt-foundry/gambit demo
```

Downloads example files (hello agent definitions plus the `examples/` gallery)
and sets environment variables.

To start onboarding with the simulator, run:

```
npx @bolt-foundry/gambit-simulator serve gambit/hello.deck.md
open http://localhost:8000/debug
```

Use the Build tab to draft your own workspace agents and scenarios.

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

## Why Gambit

Agent teams already have many ways to build and orchestrate agents: native
Gambit, Mastra, LangGraph, OpenAI Agents SDK, CrewAI, Google ADK, LlamaIndex,
Pydantic AI, and custom stacks. The harder product problem is creating the
situations those agents need to survive, checking whether those situations are
good tests, and preserving the evidence when behavior regresses.

Gambit focuses on that reliability loop:

- **Generate scenarios** for realistic user, tool, workflow, policy, and edge
  case pressure.
- **Evaluate the scenario data** for realism, coverage, difficulty, grounding,
  duplication, and expected-outcome clarity.
- **Run agent evals** against native Gambit, Mastra, LangGraph, OpenAI, or
  custom agents.
- **Grade behavior** from transcripts, artifacts, traces, and typed outputs.
- **Diagnose failures** with trace evidence and permission evidence.
- **Regenerate regression suites** from failures so the same behavior does not
  quietly break again.

For a native Gambit agent, the same system defines, runs, traces, tests, grades,
and debugs the agent end to end. For a Mastra, LangGraph, OpenAI, or custom
agent, Gambit sits on the other side of the framework: the test-data engine,
grader loop, local reproduction harness, and CI behavior check.

## Common workflows

### Native Gambit path

Define the agent in Gambit, run it locally, add scenarios for the behavior that
must keep working, attach graders, inspect traces in the simulator, and reuse
the same checks in CI. This is the most direct path when you want Gambit to own
both the agent definition and the verification loop.

### Bring your own agent

Use Mastra to build the TypeScript agent application. Use Gambit to create and
validate scenario suites around the important Mastra behaviors, then grade the
transcripts and artifacts those runs produce. A thin wrapper can record run
inputs, transcript turns, artifacts, state paths, and trace references so Gambit
can grade them and keep failing cases reproducible.

### Pull request gate

Run important scenarios on every pull request, grade the resulting transcripts
or artifacts, and fail the check when behavior drops below the expected
standard. Failed checks should keep the trace, state, and reproduction inputs so
the regression can be debugged locally.

```yaml
# Proposed workflow shape. This is positioning guidance, not a published
# bolt-foundry/gambit-action release.
name: Agent behavior checks

on:
  pull_request:

jobs:
  gambit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @bolt-foundry/gambit scenario gambit/root.deck.md --test-deck gambit/scenarios/smoke.deck.md --grade gambit/graders/smoke.deck.md --state .gambit/ci-smoke.json --trace .gambit/ci-smoke.jsonl
```

## Status quo

- Teams have more ways than ever to build agents, but fewer ways to know whether
  their eval data covers the behavior that will matter in production.
- Synthetic scenarios can look plausible while duplicating each other, missing
  policy edges, or failing to state the expected outcome clearly.
- Agent failures often disappear into provider logs, so the team cannot replay
  the exact inputs, transcript, tool calls, and artifacts that caused the
  regression.
- CI usually checks code shape more reliably than agent behavior.

## Our vision

- Generate the situations your agents need to survive: users, tasks, workflows,
  tool pressure, policy edges, and hard failure modes.
- Grade the scenario data itself before it becomes trusted eval data.
- Run any target agent against the curated suite and preserve the transcript,
  state, artifacts, trace events, and permission evidence.
- Diagnose failures by capability gap, tool issue, prompt issue, policy
  ambiguity, retrieval miss, or unsafe action.
- Feed those failures back into sharper follow-up scenarios and regression
  checks.

---

## Using the CLI

Use the CLI to run agent definitions locally, stream output, and capture
traces/state. The current CLI and file format still use `deck` as the exact
implementation term.

Run with npx (no install):

```
npx @bolt-foundry/gambit <command>
```

Run an agent definition once:

```
npx @bolt-foundry/gambit run <deck> --context <json|string> --message <json|string>
```

> `--context` replaces the old `--init` flag. The CLI still accepts `--init` as
> a deprecated alias for now so existing scripts keep working.

Drop into a REPL (streams by default):

```
npx @bolt-foundry/gambit repl <deck>
```

Start a focused browser chat for an agent definition:

```
npx @bolt-foundry/gambit chat <deck> --state .gambit/chat/workspace.sqlite --trace .gambit/chat/trace.jsonl
```

Use `chat` when you need a localhost transcript, saved state, trace output, and
runtime-supplied tools without the full simulator workbench. Use `repl` for a
terminal loop, `run` for one-shot automation, and `gambit-simulator serve` for
Build/Test/Grade/Verify workflows.

For repeatable repros, pass `--repro-message <text>` to attach the original user
ask to the session payload without sending it automatically.

Supply runtime tools with Markdown/TOML files:

```
npx @bolt-foundry/gambit chat MANAGER.md --runtime-tools ./workloop-runtime-tools.mock.md
npx @bolt-foundry/gambit chat support.deck.md --runtime-tools ./taxo-runtime-tools.mock.md
```

The runtime-tool file uses `[[tools]]` entries with `name`, `description`,
optional `inputSchema`, and optional `action`. Action bindings run Gambit agent
definitions with the tool arguments as context, keeping product-specific tools
outside the portable root agent. See `examples/local-chat/` for Workloop-style
and Taxo-style mock tool fixtures.

Run a scenario persona against a root agent:

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

- CLI commands that execute decks default to worker sandbox execution.
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

Use the library when you want TypeScript agent definitions, reusable instruction
snippets, or custom compute steps. The exported helper names remain `defineDeck`
and `defineCard` for compatibility.

Import the helpers from JSR:

```
import { defineDeck, defineCard } from "jsr:@bolt-foundry/gambit";
```

## Related

- `reviews/2026-04-15-AAR-raw-response-items.md`

Define `contextSchema`/`responseSchema` with Zod to validate IO, and implement
`run`/`execute` for compute agent definitions. To call a child agent definition
from code, use `ctx.spawnAndWait({ path, input })`. Emit structured trace events
with `ctx.log(...)`.

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

## Author your first native Gambit agent

### Minimal Markdown agent definition (model-powered): `hello_world.deck.md`

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

### Compute agent definition in TypeScript (no model call): `echo.deck.ts`

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

### Agent definition with a child action (calls a TypeScript tool): `agent_with_time.deck.md`

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
example for historical transcript/grader behavior. New agent definitions should
return schema-valid assistant output directly instead of calling
`gambit_respond`.

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
