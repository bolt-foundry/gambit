+++
[release]
since = "225456917f75e92cc095af525201373c4be37944"
+++

# Changelog

## Unreleased (v0.6.8)

- Repl fixes.
- Replaced voice front desk graders and expanded FAQ persona/grading coverage.

### CLI and UX

- Added a grading command with test-bot hooks in the CLI.
- `--message` now works without `--init` for object root schemas.
- REPL/serve/CLI flags refreshed; `--verbose` logs tool call args/results.

### Fixes

- Avoid extra assistant turn on test-bot resume; skip empty assistant turns in
  grading; keep grader respond blocks last.
- Fixed test-bot sidebar loading, grader score reads, and booking confirmation
  placement.
- Simulator UI polish: full-height layout, sourcemap adverts, locked init panel
  behavior, and reconnect/permalink reloads.

## v0.0

- Authoring: TypeScript/Markdown decks and cards via `defineDeck`/`defineCard`;
  embeds with cycle detection; card actions merge into decks (deck wins); card
  schema fragments merge into deck schemas; non-root decks require input/output
  schemas (root defaults to string-ish).
- Runtime: compute and LLM decks share the surface; assistant-first flow seeds a
  synthetic `gambit_init` tool; helpers `spawnAndWait`, `return`, `fail`; action
  names validated against reserved prefix/pattern/length; default guardrails
  depth=3/passes=3/timeout≈120s with per-deck overrides.
- Handlers/events: optional `onError`/`onBusy`/`onIdle` decks emit structured
  events (`gambit_complete` for handled errors, busy/idle updates) with default
  delay 800ms and traces for fire/result (`onInterval` is deprecated alias for
  `onBusy`).
- IO/host: CLI supports `run`, `repl`, `serve` (WebSocket simulator UI); flags
  for streaming, turn order via user message, trace to console/JSONL, state
  load/save, model overrides; `deno task compile` builds a binary; OpenRouter
  chat provider with streaming/tool calls.
- Runtime + server tests for schemas/embeds/streaming/handlers; tasks for
  fmt/lint/test/ci; root README with quick start.
