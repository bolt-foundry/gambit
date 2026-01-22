# Gambit Init Onboarding – Project Memo (2026-01-21)

## Purpose

Deliver a magical, interactive onboarding flow so a developer can create a first
Gambit bot without writing code.

## End State

- `gambit init` drops directly into an init chat (REPL) that guides creation of
  a first bot.
- By the end, the project has `./root.deck.md` and `./tests/first.test.deck.md`.
- The experience is opinionated but lets users override choices during the chat.
- Users can iterate until they quit (Ctrl-C).

## Constraints

- Reuse the existing REPL; avoid a new UI surface in v1.
- Init deck is package-scoped and versioned with the CLI.
- File writes are scoped to the target project root.
- Network access stays within allowlisted domains (boltfoundry.com, openrouter).
- File ops in v1 are limited to `write`, `exists`, `mkdir` (no delete/append).
- `gambit init` without a path still defaults to `./gambit/`.
- If `OPENROUTER_API_KEY` is missing, prompt for a pasted key (signup flow
  deferred).
- Default model for init chat is `openai/gpt-5-chat` via OpenRouter.

## Tradeoffs

- Hardcode output filenames in v1 to reduce decision surface.
- Write-as-you-go without per-file confirmation to keep the flow fast.
- Opinionated model choice vs. asking user to pick (faster onboarding).

## Allowed Changes

- Add an init deck to the package (new scaffolds path).
- Extend CLI with init-only file tools and scoped permissions.
- Update `gambit init` command flow to launch the init REPL after minimal setup.
- Add minimal docs for the init flow if needed.

## Risk Tolerance

- Prefer smallest change set that ships a believable onboarding experience.
- Avoid broad filesystem or network permissions.
- Keep v1 simple; defer complex auth or resume flows.

## Stop Conditions

- `gambit init` reliably launches an init chat using `openai/gpt-5-chat`.
- The chat can create `./root.deck.md` and `./tests/first.test.deck.md`.
- File ops are permission-scoped to the project root.
- Missing `OPENROUTER_API_KEY` path prompts for a pasted key and succeeds.
- User can continue iterating until they quit (Ctrl-C).
