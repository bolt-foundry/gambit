# Gambit Init Onboarding – Context

## Current Behavior

- `gambit init` ensures the target directory exists.
- It prompts for `OPENROUTER_API_KEY` if missing (writing `<target>/.env` when
  needed).
- It launches the init REPL with the packaged init deck and init-only file
  tools.

## Relevant Code

- `packages/gambit/src/commands/init.ts` – current init command implementation.
- `packages/gambit/src/commands/scaffold_utils.ts` – scaffold helpers, env
  prompting.
- `packages/gambit/src/decks/gambit-init.deck.md` – packaged init deck.
- `packages/gambit/src/decks/actions/` – init-only file tool implementations.

## Notes

- Init-only file tools are scoped via `GAMBIT_INIT_ROOT` and available only in
  the init deck.
- The REPL/serve tooling already supports tool calls and streaming.
