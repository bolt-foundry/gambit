# Example: handlers_ts

What it shows

- Busy/idle/error handlers written in TypeScript with explicit Zod schemas.
- Demonstrates handled errors producing `gambit_complete` envelopes and status
  streaming.

Key files

- `examples/advanced/cli_handlers_ts/handlers_ts.deck.md` — root LLM deck wiring
  TS handlers and two actions.
- `examples/advanced/cli_handlers_ts/handlers/` — TS handler decks:
  `on_busy.ts`, `on_idle.ts`, `on_error.ts`.
- `examples/advanced/cli_handlers_ts/actions/decks/` — TS actions
  `flaky_action_ts` (can throw) and `slow_action_ts` (delays).
- `examples/advanced/cli_handlers_ts/actions/cards/` — action cards with
  descriptions.

Why it’s structured this way

- TS handlers keep schema, logic, and output shape together; `onError` returns a
  rich envelope with code/status/meta/payload.
- `onBusy`/`onIdle` return strings that stream as status updates, showing how
  handlers don’t block the main run.
- Root prompt nudges the model to prefer `flaky_action_ts` and surface handler
  messages clearly when things fail.

How to run

- Trigger busy/idle:
  `deno run -A src/cli.ts run examples/advanced/cli_handlers_ts/handlers_ts.deck.md --init '{"text":"please wait","delayMs":2500}' --stream`
- Trigger error handling: `--init '{"text":"fail this","fail":true}'`

Try this input

- `--init '{"text":"run slow","delayMs":2500}'` → calls `slow_action_ts`, busy
  handler streams status, idle may fire, final echo after delay
- `--init '{"text":"fail this","fail":true}'` → calls `flaky_action_ts`,
  triggers onError handler envelope with code/status/meta/payload
