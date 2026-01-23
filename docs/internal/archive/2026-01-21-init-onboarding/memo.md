# Gambit Init Onboarding – Project Memo (2026-01-21)

## Purpose

Deliver a magical, interactive onboarding flow so a developer can create a first
Gambit bot without writing code.

## End State

- `gambit init` drops directly into an init chat (REPL) that guides creation of
  a first bot.
- By the end, the project has `<target>/root.deck.md` and
  `<target>/tests/first.test.deck.md`.
- The experience is opinionated but lets users override choices during the chat.
- Users can iterate until they quit (Ctrl-C).

## Constraints

- Reuse the existing REPL; avoid a new UI surface in v1.
- Init deck is package-scoped and versioned with the CLI.
- File writes are scoped to the target project root.
- Network access stays within allowlisted domains (boltfoundry.com, openrouter).
- File ops in v1 are limited to `write`, `exists`, `mkdir` (no delete/append).
- `gambit init` without a path still defaults to `./gambit/`.
- If `OPENROUTER_API_KEY` is missing in env and `<target>/.env`, prompt for a
  pasted key (signup flow deferred) and write `<target>/.env`.
- Default model for init chat is `openai/gpt-5.1-chat` via OpenRouter.
- Do not overwrite existing output files; require a clean target directory.

## Tradeoffs

- Hardcode output filenames in v1 to reduce decision surface.
- Write-as-you-go without per-file confirmation to keep the flow fast.
- Opinionated model choice vs. asking user to pick (faster onboarding).

## Allowed Changes

- Add an init deck to the package under `packages/gambit/src/decks/`.
- Extend CLI with init-only file tools and scoped permissions.
- Update `gambit init` command flow to launch the init REPL after minimal setup.
- Add minimal docs for the init flow if needed.

## Risk Tolerance

- Prefer smallest change set that ships a believable onboarding experience.
- Avoid broad filesystem or network permissions.
- Keep v1 simple; defer complex auth or resume flows.

## Stop Conditions

- `gambit init` reliably launches an init chat using `openai/gpt-5.1-chat`.
- The chat can create `<target>/root.deck.md` and
  `<target>/tests/first.test.deck.md`.
- File ops are permission-scoped to the project root.
- Missing `OPENROUTER_API_KEY` in env and `<target>/.env` prompts for a pasted
  key and succeeds.
- Existing output files cause a safe, explicit exit without overwriting.
- User can continue iterating until they quit (Ctrl-C).
