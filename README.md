# Gambit

Gambit is a toolkit for building multi-step LLM “decks” that mix model calls,
compute, and structured tool calls. It aims to make agent-style workflows
predictable, testable, and easy to ship.

## Goals

- **Composable decks:** Author actions as small, typed decks that call each
  other; keep logic local and explicit.
- **First-class types:** Zod schemas for inputs/outputs at every non-root deck;
  validations enforced at runtime.
- **Symmetric compute + LLM:** Compute decks run plain code; LLM decks run chat
  completions with optional tools and streaming.
- **Guardrails by default:** Depth/pass/time limits, structured errors, suspense
  handlers, and reference context injection.
- **Transparent runtime:** Verbose tracing, optional streaming, and REPL to
  debug interactions.
- **CLI + serve:** Run decks via `gambit run`, explore in a REPL, or serve a
  WebSocket simulator UI.
- **Provider abstraction:** OpenRouter/OpenAI-style chat provider with streaming
  and tool call support; plug in alternatives.
- **Testability:** Deterministic unit tests for orchestration without network;
  focus on validated inputs/outputs.

## Quick start

```sh
# set your model provider key
export OPENROUTER_API_KEY=...

# run an example
deno run -A src/cli.ts run examples/hello_world/root.deck.ts --input '"hi"'

# REPL with streaming
deno run -A src/cli.ts repl examples/suspense/root.deck.ts --verbose --stream

# WebSocket simulator UI
deno run -A src/cli.ts serve examples/suspense/root.deck.ts --port 8000
open http://localhost:8000/
```

## Key concepts

- **Decks:** Units that declare `inputSchema`/`outputSchema`, optional
  `modelParams`, and a set of `actions` (child decks). LLM decks return model
  output; compute decks return code output.
- **Cards:** Reusable prompt fragments and actions that can be embedded into
  decks; embedded cards can contribute actions to the parent deck.
- **Actions:** Always delegate to another deck; tool definitions derive from the
  child deck’s input schema.
- **Handlers:** `handlers.onError` and `handlers.onSuspense` shape structured
  responses; synthetic orchestration tools use `gambit_init`, `gambit_ping`,
  `gambit_complete`. `ping` uses HTTP-style status (102 keepalive, 103 with
  info); `complete` envelopes use HTTP-style status codes (200 by default;
  handled errors usually 500 unless overridden).
- **Streaming:** Pass `--stream` (or use the REPL/simulator) to stream tokens
  from the provider; suspense updates arrive as separate bubbles in the
  simulator UI.
- **Turn order:** The assistant speaks first by default (input is provided in
  the reference context); use `--user-first` to send the user message first.

## Development

- Tasks: `deno task fmt`, `deno task lint`, `deno task test`,
  `deno task compile` (builds `dist/gambit`).
- Tests: `deno test -A` (network-free; uses stub providers).
- Env: `OPENROUTER_API_KEY` required for real runs; `OPENROUTER_BASE_URL`
  optional.

## Docs

- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Docs index: [docs/README.md](./docs/README.md)
- Memos: [docs/memos/README.md](./docs/memos/README.md)
- Hourglass prompting: [docs/hourglass.md](./docs/hourglass.md)

## Status

- Active development pre-1.0; APIs are likely to change (notably handler/label
  naming and CLI flags). Streaming, suspense, and error handling are exercised
  in examples and tests.

## License

Apache-2.0
