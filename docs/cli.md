# CLI, REPL, and debug UI

How to run decks locally, iterate quickly, and observe runs.

## Commands

- Run once:
  `deno run -A src/cli.ts run <deck> [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--verbose]`
- REPL: `deno run -A src/cli.ts repl <deck>` (defaults to
  `src/decks/gambit-assistant.deck.md` in a local checkout). Streams by default
  and keeps state in memory for the session.
- Debug UI: `deno run -A src/cli.ts serve <deck> --port 8000` then open
  http://localhost:8000/. This serves a multi-page UI:

  - Editor (default): `http://localhost:8000/`
  - Debug: `http://localhost:8000/debug`

  The WebSocket server streams turns, traces, and status updates.
- Examples without cloning:
  `deno run -A jsr:@bolt-foundry/gambit/cli run --example hello_world.deck.md --init '"hi"'`.

## Inputs and models

- `--init`: seeds `gambit_init` with raw payload (assistant-first). Omit to let
  the assistant open.
- `--message`: sends a first user turn before the assistant replies.
- `--model`: default model; `--model-force`: override even if deck has
  `modelParams`.

## State and tracing

- `--state <file>` (run only): load/persist messages so you can continue a
  conversation; skips `gambit_init` on resume.
- `--trace <file>` writes JSONL trace events; `--verbose` prints trace to
  console. Combine with `--stream` to watch live output while capturing traces.
- `--port <n>` overrides debug UI port (default 8000); `PORT` env is honored
  when `--port` is not provided.
- `--test-bot <path>` (serve only): load/save the test bot markdown from a
  custom path instead of `.gambit/test-bot.md`.
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

## Editor UI notes

The editor page (`/`) is for iterating on a deck and its related markdown files.

- File browser: recursively lists `*.md` files under the current root.
- Editor: opens a markdown file and autosaves changes to disk (debounced).
  Selecting a file updates the URL with `?file=...` so reloads restore the
  active file.
- Active deck: any opened markdown file can be set as the active deck; the file
  list root defaults to `dirname(activeDeckPath)`.
- Iteration sidebar:
  - Deck notes: stored as a local-only sidecar under `.gambit/notes/` and tied
    to the active deck path.
  - Feedback: aggregated from saved sessions for the active deck (newest-first),
    with archive/unarchive support. Clicking “View” opens a session context
    drawer (message window + session notes).

## Local persistence (.gambit)

The debug UI/editor is local-first and persists lightweight state under
`.gambit/`:

- `.gambit/sessions/<sessionId>/state.json`: per-session transcript, message
  refs, feedback, traces, and session notes.
- `.gambit/config.json`: editor state (e.g., `rootPath`, `activeDeckPath`).
- `.gambit/notes/*.md`: deck-level notes sidecars (keyed by deck path).
