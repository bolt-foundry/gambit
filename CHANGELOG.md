# Changelog

## Unreleased (v0.6)

- Synthetic tools refreshed: `gambit_init`, `gambit_respond`, `gambit_complete`
  (function-style tools, underscore names).
- Envelope simplification: init carries run/action IDs plus guardrails/model
  hints; respond wraps payload/message/status/code/meta (default status 200 for
  success, 500 for handled errors unless overridden).
- Runtime behavior: child completions and handled errors emit `gambit_complete`;
  interval handlers surface mid-run updates; roots stay conversational-only.
- Docs/memos updated to reflect the minimal scope and naming.
- IO/host: `--message` sends a first user turn; `--input` seeds `gambit_init`
  without changing turn order; REPL/serve/cli flags updated accordingly.
- IO/host: `gambit_init` now only fires when `--input` is provided and its
  payload is just the raw input (no run/action metadata).
- IO/host: `--verbose` tracing now logs tool call arguments and results.

## v0.0

- Authoring: TypeScript/Markdown decks and cards via `defineDeck`/`defineCard`;
  embeds with cycle detection; card actions merge into decks (deck wins); card
  schema fragments merge into deck schemas; non-root decks require input/output
  schemas (root defaults to string-ish).
- Runtime: compute and LLM decks share the surface; assistant-first flow seeds a
  synthetic `gambit_init` tool; helpers `spawnAndWait`, `return`, `fail`; action
  names validated against reserved prefix/pattern/length; default guardrails
  depth=3/passes=3/timeout≈120s with per-deck overrides.
- Handlers/events: optional `onError`/`onInterval` decks emit structured events
  (`gambit_complete` for handled errors, interval-driven updates) with default
  suspense delay 800ms and traces for fire/result.
- IO/host: CLI supports `run`, `repl`, `serve` (WebSocket simulator UI); flags
  for streaming, turn order via user message, trace to console/JSONL, state
  load/save, model overrides; `deno task compile` builds a binary; OpenRouter
  chat provider with streaming/tool calls.
- Runtime + server tests for schemas/embeds/streaming/handlers; tasks for
  fmt/lint/test/ci; root README with quick start.
