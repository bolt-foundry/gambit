# Example: handlers_ts

What it shows

- Busy/idle/error handlers written in TypeScript with explicit Zod schemas.
- Demonstrates handled errors producing `gambit_complete` envelopes and status
  streaming.

Key files

- `examples/handlers_ts/handlers_ts.deck.md` — root LLM deck wiring TS handlers
  and two actions.
- `examples/handlers_ts/handlers/` — TS handler decks: `on_busy.ts`,
  `on_idle.ts`, `on_error.ts`.
- `examples/handlers_ts/actions/decks/` — TS actions `flaky_action_ts` (can
  throw) and `slow_action_ts` (delays).
- `examples/handlers_ts/actions/cards/` — action cards with descriptions.

Why it’s structured this way

- TS handlers keep schema, logic, and output shape together; `onError` returns a
  rich envelope with code/status/meta/payload.
- `onBusy`/`onIdle` return strings that stream as status updates, showing how
  handlers don’t block the main run.
- Root prompt nudges the model to prefer `flaky_action_ts` and surface handler
  messages clearly when things fail.

How to run

- Trigger busy/idle:
  `deno run -A src/cli.ts run examples/handlers_ts/handlers_ts.deck.md --input '{"text":"please wait","delayMs":2500}' --stream`
- Trigger error handling: `--input '{"text":"fail this","fail":true}'`

Try this input

- `--input '{"text":"run slow","delayMs":2500}'` → calls `slow_action_ts`, busy
  handler streams status, idle may fire, final echo after delay
- `--input '{"text":"fail this","fail":true}'` → calls `flaky_action_ts`,
  triggers onError handler envelope with code/status/meta/payload
