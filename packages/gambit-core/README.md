# @bolt-foundry/gambit-core

Core runtime, definitions, and utilities for building Gambit decks outside of
the CLI. It includes the loader for Markdown/TypeScript decks, guardrail-aware
execution, OpenAI-compatible adapters, and helpers for persisting local run
state. The [`@bolt-foundry/gambit`](../gambit/README.md) package re-exports
these APIs plus the CLI, but `gambit-core` stays focused on the
authoring/runtime pieces that can live in any host.

> **Gambit vs. Gambit Core**
>
> `@bolt-foundry/gambit-core` is the lightweight runtime + authoring toolkit
> (deck definitions, loaders, runtime, provider helpers).
> [`@bolt-foundry/gambit`](../gambit/README.md) bundles those same exports
> **plus** the CLI, simulator server, and higher-level developer experience. If
> you need just the runtime inside another application or service, depend on
> `gambit-core`. If you also want the CLI commands (`run`, `serve`, `repl`,
> etc.) stick with [`@bolt-foundry/gambit`](../gambit/README.md), which already
> depends on this package.

## Highlights

- Typed deck/card definitions with [`defineDeck`](src/definitions.ts) and
  [`defineCard`](src/definitions.ts) that enforce Zod
  `inputSchema`/`outputSchema`.
- Loader that understands Markdown decks/cards, inline embeds, and companion
  decks (`actionDecks`, `testDecks`, `graderDecks`).
- Guardrail-aware runtime (`runDeck`) that can mix LLM actions and pure compute
  decks with structured tracing and execution context helpers.
- Compatibility helpers for OpenAI Chat Completions plus a ready-to-use
  OpenRouter provider factory.
- State utilities (`loadState`/`saveState`) used by the Gambit simulator for
  local-first transcripts, feedback, and notes.

## Installation

### Deno

```
deno add jsr:@bolt-foundry/gambit-core
```

Import directly from JSR:

```
import { defineDeck, runDeck } from "jsr:@bolt-foundry/gambit-core";
```

### Node.js / bundlers

```
npm install @bolt-foundry/gambit-core
```

All exports are ESM and align with what the CLI package (`@bolt-foundry/gambit`)
surfaces. Use any runtime that supports modern ES modules (Node 18+, Bun, Deno,
etc.).

## Core concepts

- **Decks**: The primary executable unit. Decks declare a label, `inputSchema`,
  `outputSchema`, optional `body`/`prompt`, handler hooks, and companion decks
  (actions/tests/graders). Decks with `modelParams` render prompts, while decks
  with `run`/`execute` are compute-only.
- **Cards**: Reusable prompt fragments or schema fragments that can be embedded
  within decks or other cards. Cards can contribute
  `inputFragment`/`outputFragment` that merge into a parent deck’s schema.
- **Guardrails**: Limit recursion with `maxDepth`, `maxPasses`, and `timeoutMs`.
  Decks can override guardrails per definition; `runDeck` enforces them while
  spawning child decks.
- **Handlers**: Background decks triggered on busy/idle/error intervals. Paths
  are resolved relative to the parent deck file.
- **Companion decks**: `actionDecks` expose tools (function calls) to the model,
  `testDecks` house personas or scripted tests, and `graderDecks` evaluate saved
  transcripts.

All actual type definitions live under [`src/types.ts`](src/types.ts). Use them
when scripting tooling or writing custom providers.

## Define a deck in TypeScript

```
// hello.deck.ts
import { defineDeck } from "jsr:@bolt-foundry/gambit-core";
import { z } from "zod";

export default defineDeck({
  label: "Hello World",
  inputSchema: z.object({ user: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  body: `
You are a helpful assistant that greets the user by name.
`,
  respond: true,
  modelParams: {
    model: "openrouter/anthropic/claude-3.5-sonnet",
    temperature: 0.2,
  },
});
```

Cards look similar:

```
import { defineCard } from "jsr:@bolt-foundry/gambit-core";
import { z } from "zod";

export default defineCard({
  label: "Shared context",
  inputFragment: z.object({ customerId: z.string().uuid() }),
  body: "Always double check the account number before responding.",
});
```

## Running decks programmatically

The runtime loads the deck (Markdown or TS) and steps through each pass. Provide
any `ModelProvider` implementation; the OpenRouter adapter lives in
`@bolt-foundry/gambit`.

```
import { runDeck } from "jsr:@bolt-foundry/gambit-core";
import { createOpenRouterProvider } from "jsr:@bolt-foundry/gambit";

const provider = createOpenRouterProvider({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
  referer: "https://example.com",
  title: "My Gambit Runner",
});

const result = await runDeck({
  path: "./hello.deck.ts",
  input: { user: "Casey" },
  modelProvider: provider,
  isRoot: true,
  trace: (event) => console.log(event),
  stream: true,
  onStreamText: (chunk) => Deno.stdout.write(new TextEncoder().encode(chunk)),
});

console.log(result);
```

When the deck defines `run`/`execute`, the runtime hands you an
[`ExecutionContext`](src/types.ts) with:

- `ctx.input`: validated input (narrowable when you type the schema).
- `ctx.spawnAndWait({ path, input })`: call another deck and await the result.
- `ctx.return(payload)`: respond early without running guards again.
- `ctx.fail({ message, code?, details? })`: aborts the run (throws).
- `ctx.log(...)`: emit structured trace entries for observability.

Pass `guardrails`, `initialUserMessage`, `modelOverride`, and
`allowRootStringInput` to `runDeck` when scripting custom runtimes.

## Loading Markdown decks and cards

Markdown files use front matter for metadata, with the body becoming the prompt.
Embedded cards or system hints can be referenced with markdown image syntax.

```
---
label: Support Triage
inputSchema: ./schemas/triage_input.ts
outputSchema: ./schemas/triage_output.ts
actionDecks:
  - name: escalate
    description: Escalate to a manager
    path: ./actions/escalate.deck.md
testDecks:
  - path: ./personas/test_bot.deck.md
---
![](gambit://cards/context.card.md)

You are the front door for support tickets. Summarize the ticket and ask
clarifying questions before choosing an action.

![](./cards/safety.card.md)
```

`loadDeck` normalizes relative paths, merges card fragments, enforces unique
action names, and warns about deprecated fields (`actions`,
`handlers.onInterval`, `intervalMs`). The Markdown loader also injects helper
text for built-in tools like `gambit_init`, `gambit_respond`, and `gambit_end`
when you add `gambit://` markers.

## Compatibility and utilities

- **Chat Completions bridge**: [`chatCompletionsWithDeck`](src/openai_compat.ts)
  lets you present a single deck as an OpenAI-compatible endpoint. It normalizes
  tool calls, enforces deck schemas, and returns Chat Completions–shaped
  responses with a `gambit` metadata extension.
- **Request rendering**: [`renderDeck`](src/render.ts) merges an existing Chat
  Completions request with the deck’s system prompt and tool schema, so you can
  debug what will actually reach the model or feed it into another orchestrator.
- **Model providers**: the OpenRouter adapter lives in `@bolt-foundry/gambit`
  (see `packages/gambit/src/providers/openrouter.ts`). Implement your own
  provider by conforming to the `responses()` signature in `ModelProvider`.
- **Constants**:
  [`GAMBIT_TOOL_INIT`, `GAMBIT_TOOL_RESPOND`, `GAMBIT_TOOL_END`](src/constants.ts)
  define the reserved tool names the runtime expects when the assistant starts,
  responds, and explicitly ends runs.

## Persisted state and traces

[`loadState`](src/state.ts) and [`saveState`](src/state.ts) read/write JSON
session files that include transcript messages, message references, feedback,
trace events, notes, and optional conversation scores. The CLI stores them under
`.gambit/`, but the API works anywhere.

Use the `trace` callback offered by `runDeck` to collect
[`TraceEvent`](src/types.ts) entries, then persist them via `saveState` or
stream them to your own observability stack.

## Local development

From `packages/gambit-core/`:

```
deno task fmt      # format sources
deno task lint     # lint with the repo-standard rules
deno task test     # run unit tests (allowing net/fs as required)
deno task build_npm  # emit the npm bundle via dnt
```

Tests exercise the Markdown loader, renderer, OpenAI compatibility layer, and
runtime guardrails. Update snapshots/fixtures via `deno test -- --update` when
necessary.
