# Gambit v0 reality check

The blueprint below reflects what is already built in the repo, not the older spec sketches.

## What exists today

- Authoring: TypeScript and Markdown decks/cards with `defineDeck`/`defineCard`; nested embeds with cycle detection; card actions merge into decks (deck wins); card schema fragments merge into deck schemas; non-root decks require input/output schemas (root defaults to string-ish input/output).
- Runtime: compute vs LLM decks share the surface; assistant-first flow with the synthetic `gambit_get_reference_context` tool seeded up front; `spawnAndWait`, `return`, `fail` helpers; actions validated against child schemas with reserved tool-name checks; default guardrails depth=3/passes=3/timeout≈120s with per-deck overrides.
- Handlers/events: `handlers.onError` and `handlers.onSuspense` already live, emitting synthetic tool events (`gambit_error_event`, `gambit_suspense_event`); suspense delay defaults to 800ms with overrides and traces for fire/result.
- IO/host: CLI supports `run`, `repl`, and `serve` (WebSocket simulator UI); flags for streaming, user-first, trace to console/JSONL, state load/save, and model overrides; `deno task compile` builds a binary; OpenRouter chat provider with streaming/tool call support.
- Examples/tests/docs: `examples/hello_world`, `examples/suspense` (handler), and Markdown decks; runtime + server tests (schemas, embeds, streaming, handler triggers); tasks for fmt/lint/test/ci; root README with quick start.

## Deviations from the original v0 sketch

- Error and suspense handling shipped (previously slated for v0.1/v0.2).
- Markdown authoring shipped (previously v0.4).
- Per-deck guardrail overrides exist (previously deferred).
- REPL/tracing/WebSocket simulator are present (previously future ergonomics).
- Reserved namespace uses `gambit_*` (underscore) instead of dotted `gambit.*`.

## Still missing/known gaps

- Action resolution is local/relative only; no remote/module resolution.
- No inline tool handlers; everything still delegates to decks.
- Provider abstraction ships only OpenRouter/OpenAI-style chat; no alternates yet.
- Docs are thin; richer error taxonomy/branching guidance still unwritten.
