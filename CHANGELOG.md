# Changelog

## Unreleased (v0.6)

- Synthetic tools refreshed: `gambit_init`, `gambit_ping`, `gambit_complete`
  (function-style tools, underscore names).
- Envelope simplification: init carries run/action IDs plus guardrails/model
  hints; ping carries elapsedMs, HTTP-style status (102 keepalive, 103 when
  carrying info), optional message/payload/meta; complete wraps
  payload/message/status/code/meta (default status 200 for success, 500 for
  handled errors unless overridden).
- Runtime behavior: child completions and handled errors emit `gambit_complete`;
  suspense handlers emit `gambit_ping`; roots stay conversational-only.
- Docs/memos updated to reflect the minimal scope and naming.

## v0.0

- Authoring: TypeScript/Markdown decks and cards via `defineDeck`/`defineCard`;
  embeds with cycle detection; card actions merge into decks (deck wins); card
  schema fragments merge into deck schemas; non-root decks require input/output
  schemas (root defaults to string-ish).
- Runtime: compute and LLM decks share the surface; assistant-first flow seeds a
  synthetic `gambit_init` tool; helpers `spawnAndWait`, `return`, `fail`; action
  names validated against reserved prefix/pattern/length; default guardrails
  depth=3/passes=3/timeout≈120s with per-deck overrides.
- Handlers/events: optional `onError`/`onSuspense` decks emit synthetic events
  (`gambit_complete` for handled errors, `gambit_ping` for suspense) with
  default suspense delay 800ms and traces for fire/result.
- IO/host: CLI supports `run`, `repl`, `serve` (WebSocket simulator UI); flags
  for streaming, user-first, trace to console/JSONL, state load/save, model
  overrides; `deno task compile` builds a binary; OpenRouter chat provider with
  streaming/tool calls.
- Examples/tests/docs: `examples/hello_world`, `examples/suspense` (handler),
  Markdown decks; runtime + server tests for schemas/embeds/streaming/handlers;
  tasks for fmt/lint/test/ci; root README with quick start.
