# CLI, REPL, and debug UI

How to run Gambit, the agent harness framework, locally and observe runs.

## Commands

- Run once:
  `deno run -A src/cli.ts run <deck> [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--verbose]`
- REPL: `deno run -A src/cli.ts repl <deck>` (defaults to
  `src/decks/gambit-assistant.deck.md` in a local checkout). Streams by default
  and keeps state in memory for the session.
- Test bot (CLI):
  `deno run -A src/cli.ts test-bot <root-deck> --test-deck <persona-deck> [--init <json|string>] [--bot-input <json|string>] [--message <json|string>] [--max-turns <n>] [--state <file>] [--grade <grader-deck> ...] [--trace <file>] [--verbose]`
- Grade (CLI):
  `deno run -A src/cli.ts grade <grader-deck> --state <file> [--model <id>] [--model-force <id>] [--trace <file>] [--verbose]`
- Export bundle (CLI):
  `deno run -A src/cli.ts export [<deck>] --state <file> --out <bundle.tar.gz>`
- Debug UI: `deno run -A src/cli.ts serve <deck> --port 8000` then open
  http://localhost:8000/. This serves a multi-page UI:

  - Debug (default): `http://localhost:8000/debug`
  - Test: `http://localhost:8000/test-bot`
  - Calibrate: `http://localhost:8000/calibrate`

  The WebSocket server streams turns, traces, and status updates.
- Examples from a local clone:
  `deno run -A src/cli.ts run examples/hello_world.deck.md --init '"hi"'`.

## Inputs and models

- `--init`: seeds `gambit_init` with raw payload (assistant-first). Omit to let
  the assistant open.
- `--message`: sends a first user turn before the assistant replies.
- `--model`: default model; `--model-force`: override even if deck has
  `modelParams`.

## State and tracing

- `--state <file>` (run/test-bot/grade/export): load/persist messages so you can
  continue a conversation; skips `gambit_init` on resume. `grade` writes
  `meta.gradingRuns` back into the session state, while `export` reads the state
  file to build the bundle.
- `--out <file>` (export): bundle output path (tar.gz).
- `--grade <grader-deck>` (test-bot): can be repeated; graders run in the order
  provided and append results to `meta.gradingRuns` in the same session state
  file.
- `--trace <file>` writes JSONL trace events; `--verbose` prints trace to
  console. Combine with `--stream` to watch live output while capturing traces.
- `--port <n>` overrides debug UI port (default 8000); `PORT` env is honored
  when `--port` is not provided.
- `serve` auto-builds the debug UI bundle on every start and generates source
  maps by default.
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
- Deck `inputSchema` is exposed at `/schema` and included in the `ready`
  WebSocket message; the debug UI renders a schema-driven form with defaults
  (falling back to examples/description) plus a raw JSON tab for init input,
  stacked beneath the user message box. One “Send” submits init first, then the
  user message in the same run. A reconnect button reopens the socket without
  reloading.
- `--watch` on `serve` restarts the debug UI when files change (`PORT` env or
  `--port` controls the bind port; default 8000).
- Custom trace formatting is supported via an optional
  `window.gambitFormatTrace` hook in the page; return a string or
  `{role?, summary?, details?, depth?}` to override the entry that appears in
  the Traces & Tools pane.
- The Test page reuses the same simulator runtime but drives persona/test-bot
  decks so you can batch synthetic conversations, inspect per-turn scoring, and
  export JSONL artifacts for later ingestion. List personas by declaring
  `[[testDecks]]` entries in your root deck (for example
  `examples/voice_front_desk/decks/root.deck.md`). Each entry’s `path` should
  point to a persona deck (Markdown or TS) that includes
  `acceptsUserTurns = true`; the persona deck’s own `inputSchema` and defaults
  power the Scenario/Test Bot form (see
  `examples/voice_front_desk/tests/new_patient_intake.deck.md`). Editing those
  deck files is how you add/remove personas now—there is no
  `.gambit/test-bot.md` override.
- The Calibrate page is the regroup/diagnostics view for graders that run
  against saved Debug/Test sessions; it currently serves as a placeholder until
  the grading transport lands.

## Local persistence (.gambit)

The debug UI/editor is local-first and persists lightweight state under
`.gambit/`:

- `.gambit/sessions/<sessionId>/state.json`: per-session transcript, message
  refs, feedback, traces, and session notes.
