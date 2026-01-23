# Phase 1 – Init Deck Stub

## Questions

- Purpose: Why are we doing this phase?
- End State: What must be true when this phase is done?
- Constraints: What limits or rules apply?
- Tradeoffs: What are we intentionally choosing not to do?
- Allowed Changes: What can we change without re-scoping?
- Risk Tolerance: How much risk is acceptable here?
- Stop Conditions: How do we know we are finished?

## Purpose

Ship a packaged init deck stub that the REPL can load and run end-to-end.

## End State

- Init deck lives in the package and can be invoked by the REPL.
- The deck runs end-to-end with the opinionated model `openai/gpt-5.1-chat`.

## Constraints

- Use the existing REPL (no new UI surface).
- Markdown deck for v1.
- Keep the prompt lightweight (purpose + 2–3 examples).

## Tradeoffs

- Prefer a functional stub over perfect prompt quality.
- Hardcode filenames later to reduce decision surface.

## Allowed Changes

- Add the init deck under `packages/gambit/src/decks/`.
- Adjust prompt and system instructions to improve outcomes.

## Risk Tolerance

- Prefer the smallest change set that validates the flow.
- Avoid adding complex tooling protocols in v1.

## Plan

- Add/initiate the packaged init deck location and ensure it is discoverable by
  the REPL.
- Wire the init deck path into the REPL invocation path for the init flow.
- Validate the init deck runs end-to-end in REPL with `openai/gpt-5.1-chat`.

## Stop Conditions

- The REPL can load the init deck from the package.
- A basic end-to-end REPL run completes without errors.
