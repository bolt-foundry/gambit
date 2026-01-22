# Feature Memo – Init Chat Deck

## Purpose

Provide the conversational brain for `gambit init` that elicits minimal inputs
and generates a first bot.

## End State

- A packaged init deck runs in REPL and guides users to produce `./root.deck.md`
  and `./tests/first.test.deck.md`.
- The deck keeps the conversation lightweight (purpose + 2–3 example prompts).
- The deck can call init-only file tools to write files during the chat.

## Constraints

- Markdown deck for v1.
- Opinionated model: `openai/gpt-5-chat`.
- No per-file confirmation in v1.
- Hardcode filenames in v1.

## Tradeoffs

- Simple prompt and structure over exhaustive personalization.
- Minimal questions to reduce friction.

## Allowed Changes

- Add new scaffold location for the init deck in the package.
- Adjust prompt and system instructions to improve outcomes.

## Risk Tolerance

- Prefer a functional v1 over perfect prompt quality.
- Avoid overly complex tool protocols.

## Stop Conditions

- Running the init deck in REPL can produce working `root.deck.md` and test deck
  using file tools.
- The deck behaves predictably with minimal user input.
