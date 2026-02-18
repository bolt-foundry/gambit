# CLI, REPL, and debug UI

How to run Gambit, the agent harness framework, locally and observe runs.

## Commands

- Onboarding path: `deno run -A src/cli.ts serve <deck> --port 8000`.
- Help and usage:
  - General usage: `deno run -A src/cli.ts help` (or `-h` / `--help`).
  - Full usage: `deno run -A src/cli.ts help --verbose`.
  - Command help: `deno run -A src/cli.ts help <command>` (or
    `deno run -A src/cli.ts <command> -h`).
- Run once:
  `deno run -A src/cli.ts run <deck> [--context <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--responses] [--verbose] [--worker-sandbox|--no-worker-sandbox|--legacy-exec]`
- Check models: `deno run -A src/cli.ts check <deck>`
- REPL: `deno run -A src/cli.ts repl <deck>` (defaults to
  `src/decks/gambit-assistant.deck.md` in a local checkout). Streams by default
  and keeps state in memory for the session.
- Scenario (CLI):
  `deno run -A src/cli.ts scenario <root-deck> --test-deck <persona-deck> [--context <json|string>] [--bot-input <json|string>] [--message <json|string>] [--max-turns <n>] [--state <file>] [--grade <grader-deck> ...] [--trace <file>] [--responses] [--verbose] [--worker-sandbox|--no-worker-sandbox|--legacy-exec]`
- Grade (CLI):
  `deno run -A src/cli.ts grade <grader-deck> --state <file> [--model <id>] [--model-force <id>] [--trace <file>] [--responses] [--verbose] [--worker-sandbox|--no-worker-sandbox|--legacy-exec]`
- Export bundle (CLI):
  `deno run -A src/cli.ts export [<deck>] --state <file> --out <bundle.tar.gz>`
- Debug UI: `deno run -A src/cli.ts serve <deck> --port 8000` or
  `deno run -A src/cli.ts serve --artifact <bundle.tar.gz>` then open
  http://localhost:8000/. This serves a multi-page UI:

  - Debug (default): `http://localhost:8000/debug`
  - Test: `http://localhost:8000/test`
  - Calibrate: `http://localhost:8000/calibrate`

  The WebSocket server streams turns, traces, and status updates.
- Examples from a local clone:
  `deno run -A src/cli.ts run gambit/hello.deck.md --context '"hi"'`.

## Inputs and models

- `--context`: seeds `gambit_context` with raw payload (assistant-first). Omit
  to let the assistant open. The deprecated `--init` alias still works for now,
  and `gambit_init` remains as a legacy tool name.
- `--message`: sends a first user turn before the assistant replies.
- `--model`: default model; `--model-force`: override even if deck has
  `modelParams`.
- `--responses`: opt into Responses mode for runtime/state (stores response
  items and uses `ModelProvider.responses` when available).
- `GAMBIT_RESPONSES_MODE=1`: env alternative to `--responses` for runtime/state.
- `GAMBIT_OPENROUTER_RESPONSES=1`: route OpenRouter calls through the Responses
  API (experimental; chat remains the default path).
- Worker execution defaults on for deck-executing surfaces. Use
  `--no-worker-sandbox` (or `--legacy-exec`) to roll back to legacy in-process
  execution. `--sandbox/--no-sandbox` still work as deprecated aliases.
- `gambit.toml` config equivalent:
  ```toml
  [execution]
  worker_sandbox = false # same as --no-worker-sandbox
  # legacy_exec = true    # equivalent rollback toggle
  ```

## State and tracing

- `--state <file>` (run/scenario/grade/export): load/persist messages so you can
  continue a conversation; skips `gambit_context` on resume. `grade` writes
  `meta.gradingRuns` back into the session state, while `export` reads the state
  file to build the bundle.
- `--out <file>` (export): bundle output path (tar.gz).
- `--grade <grader-deck>` (scenario): can be repeated; graders run in the order
  provided and append results to `meta.gradingRuns` in the same session state
  file.
- `--trace <file>` writes JSONL trace events; `--verbose` prints trace to
  console. Combine with `--stream` to watch live output while capturing traces.
- `--port <n>` overrides debug UI port (default 8000); `PORT` env is honored
  when `--port` is not provided.
- `--artifact <bundle.tar.gz>` (serve only): restore and serve a bundle created
  by `gambit export` (or FAQ download). Mutually exclusive with explicit deck
  path.
- `serve` auto-builds the debug UI bundle on every start and generates source
  maps by default in dev environments (set `GAMBIT_ENV=development` or
  `NODE_ENV=development`, or pass `--bundle`/`--sourcemap` explicitly).
- `--no-bundle` (serve only): disable auto-bundling.
- `--no-sourcemap` (serve only): disable source map generation.
- `--bundle` / `--sourcemap` (serve only): explicitly enable bundling or source
  maps if you disabled them.
- `--platform <platform>` (serve only): controls the bundler target; use `web`
  (browser) to generate output that debuggers treat as browser code. Defaults to
  `deno`. For manual builds, see `deno task bundle:sim:web`.

## Debug UI notes

- The debug page (`/debug`) shows transcript lanes for
  user/assistant/system/status plus a trace/event feed.
- Incoming `stream` messages render incrementally; handler messages appear in
  the status lane.
- Every WebSocket message echoes `runId` so you can correlate with traces.
- Deck `contextSchema` is exposed at `/schema` and included in the `ready`
  WebSocket message; the debug UI renders a schema-driven form with defaults
  (falling back to gambit/examples/advanced/description) plus a raw JSON tab for
  init input, stacked beneath the user message box. One “Send” submits init
  first, then the user message in the same run. A reconnect button reopens the
  socket without reloading.
- `--watch` on `serve` restarts the debug UI when files change (`PORT` env or
  `--port` controls the bind port; default 8000).
- Custom trace formatting is supported via an optional
  `window.gambitFormatTrace` hook in the page; return a string or
  `{role?, summary?, details?, depth?}` to override the entry that appears in
  the Traces & Tools pane.
- The Test page reuses the same simulator runtime but drives persona/scenario
  decks so you can batch synthetic conversations, inspect per-turn scoring, and
  export JSONL artifacts for later ingestion. List personas by declaring
  `[[scenarios]]` entries in your root deck (for example
  `gambit/examples/advanced/voice_front_desk/decks/root.deck.md`). Each entry’s
  `path` should point to a persona deck (Markdown or TS) that includes
  `acceptsUserTurns = true`; the persona deck’s own `contextSchema` and defaults
  power the Scenario form (see
  `gambit/examples/advanced/voice_front_desk/tests/new_patient_intake.deck.md`).
  Editing those deck files is how you add/remove personas now—there is no
  `.gambit/scenario.md` override.
- The Calibrate page is the regroup/diagnostics view for graders that run
  against saved Debug/Test sessions; it currently serves as a placeholder until
  the grading transport lands.

## Local persistence (.gambit)

The debug UI/editor is local-first and persists lightweight state under
`.gambit/`:

- `<project-root>/.gambit/sessions/<sessionId>/state.json`: materialized
  snapshot for the session (messages, refs, feedback, notes, meta). Traces are
  stored separately in `events.jsonl` so the snapshot stays lightweight; the
  snapshot includes log paths in `meta` for downstream ingestion.
- `<project-root>/.gambit/sessions/<sessionId>/events.jsonl`: append-only event
  protocol (includes runtime traces and state snapshots).
- `<project-root>/.gambit/sessions/<sessionId>/feedback.jsonl`: append-only user
  feedback entries.
- `<project-root>/.gambit/sessions/<sessionId>/grading.jsonl`: append-only
  grading runs, flags, and reference samples. The project root is the nearest
  parent of the deck with `deno.json`, `deno.jsonc`, or `package.json` (falls
  back to the deck directory).

Each `*.jsonl` file is line-delimited JSON. Read it by streaming lines and
parsing each line as a standalone event. `events.jsonl` is the canonical stream
for runtime activity (including traces) and includes periodic `session.snapshot`
events for rebuilding `state.json` without polling.
