# Example: handlers_md

What it shows

- Busy/idle/error handlers authored in Markdown decks, paired with TS actions.
- Using `gambit://snippets/respond.md` in an error handler to force structured
  completion.

Key files

- `init/examples/advanced/cli_handlers_md/handlers_md.deck.md` — root LLM deck
  configuring handlers and two actions.
- `init/examples/advanced/cli_handlers_md/handlers/` — Markdown handler decks
  with Zod schemas.
- `init/examples/advanced/cli_handlers_md/actions/decks/` — TS actions
  `flaky_action` (throws on demand) and `slow_action` (delays).
- `init/examples/advanced/cli_handlers_md/handlers/schemas/` — input/output Zod
  schemas for handlers.

Why it’s structured this way

- Markdown handlers keep prompts readable while still validating IO via schemas.
- `onBusy` uses `repeatMs` to stream periodic status messages; `onIdle` fires
  after inactivity.
- `onError` returns a fixed envelope via `gambit_respond`, ensuring the parent
  sees a consistent `{status, code, message, meta, payload}` even when children
  fail.

How to run

- Trigger busy/idle:
  `deno run -A src/cli.ts run init/examples/advanced/cli_handlers_md/handlers_md.deck.md --context '{"text":"wait","delayMs":3000}' --stream`
- Trigger error handling: `--context '{"text":"fail me","fail":true}'`

Try this input

- `--context '{"text":"please wait","delayMs":2500}'` → calls `slow_action`,
  busy handler streams updates, idle may fire if no activity, final echo after
  delay
- `--context '{"text":"fail on purpose","fail":true}'` → calls `flaky_action`,
  triggers onError handler response envelope with status/code/meta/payload
