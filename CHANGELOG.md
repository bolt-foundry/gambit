+++
[release]
since = "b0ddcc2ba4e861e0879dc92cc713e8cde30d230f"
+++

# Changelog

## Unreleased (v0.6.0)

- TBD

## v0.5.0

### Runtime and API

- Synthetic tools refreshed: `gambit_init`, `gambit_respond`, `gambit_complete`
  (function-style tools, underscore names).
- Envelope simplification: init carries run/action IDs plus guardrails/model
  hints; respond wraps payload/message/status/code/meta (default status 200 for
  success, 500 for handled errors unless overridden).
- Runtime behavior: child completions and handled errors emit `gambit_complete`;
  interval handlers surface mid-run updates; roots stay conversational-only.
- `gambit_init` only fires when `--init` is provided and its payload is the raw
  input (no run/action metadata).
- Added trace timestamps for latency metrics and persisted streamed assistant
  text before tool calls.
- Added OpenAI chat completions compatibility (`renderDeck` plus wrapper).
- Increased default guardrail `maxPasses`.

### Simulator UI and test bot

- New React simulator UI with sessions, recents, nested trace hierarchy, and
  session notes/ratings.
- Pivoted the simulator to debug/test/calibrate workflows with a new editor
  assistant endpoint and UI tab.
- Test bot upgrades: per-run streaming + debug link, init/scenario panels,
  default scenario schema, deck input config, feedback on all bubbles, and
  session routing/persistence.
- Calibration/grading updates: deck-defined grading flows, streamed results,
  reference samples, compact context previews, and renaming calibration runs to
  grading runs.

### Decks and examples (voice front desk)

- Added voice front desk example decks and modularized the deck set.
- Added new patient intake + additional voice front desk test decks.
- Added appointment lookup orchestration and scheduling confirmation flow.
- Enabled scheduling service deck and shared patient identity test input schema.
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
