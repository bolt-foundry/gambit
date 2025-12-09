# CLI, REPL, and simulator

How to run decks locally, iterate quickly, and observe runs.

## Commands

- Run once:
  `deno run -A src/cli.ts run <deck> [--input <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--verbose]`
- REPL: `deno run -A src/cli.ts repl <deck>` (defaults to
  `src/decks/gambit-assistant.deck.md` in a local checkout). Streams by default
  and keeps state in memory for the session.
- Simulator: `deno run -A src/cli.ts serve <deck> --port 8000` then open
  http://localhost:8000/. WebSocket server streams turns, traces, and status
  updates.
- Examples without cloning:
  `deno run -A jsr:@bolt-foundry/gambit/cli run --example hello_world.deck.md --input '"hi"'`.

## Inputs and models

- `--input`: seeds `gambit_init` with raw payload (assistant-first). Omit to let
  the assistant open.
- `--message`: sends a first user turn before the assistant replies.
- `--model`: default model; `--model-force`: override even if deck has
  `modelParams`.

## State and tracing

- `--state <file>` (run only): load/persist messages so you can continue a
  conversation; skips `gambit_init` on resume.
- `--trace <file>` writes JSONL trace events; `--verbose` prints trace to
  console. Combine with `--stream` to watch live output while capturing traces.

## Simulator UI notes

- UI shows transcript lanes for user/assistant/system/status plus a trace/event
  feed.
- Incoming `stream` messages render incrementally; handler messages appear in
  the status lane.
- Every WebSocket message echoes `runId` so you can correlate with traces.
