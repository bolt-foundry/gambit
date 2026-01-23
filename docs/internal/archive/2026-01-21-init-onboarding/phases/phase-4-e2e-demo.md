# Phase 4 – End-to-End Demo

## Questions

- Purpose: Why are we doing this phase?
- End State: What must be true when this phase is done?
- Constraints: What limits or rules apply?
- Tradeoffs: What are we intentionally choosing not to do?
- Allowed Changes: What can we change without re-scoping?
- Risk Tolerance: How much risk is acceptable here?
- Stop Conditions: How do we know we are finished?

## Purpose

Prove the full init onboarding flow works in a clean environment.

## End State

- From a fresh directory, `gambit init` runs end-to-end.
- The OpenRouter key prompt succeeds when missing.
- The init chat generates `<target>/root.deck.md` and
  `<target>/tests/first.test.deck.md`.
- The session can be exited cleanly after completion.

## Constraints

- Use the existing REPL (no new UI surface).
- Network access limited to allowlisted domains.

## Tradeoffs

- Use the opinionated model and hardcoded filenames to keep the demo fast.

## Allowed Changes

- Add minimal docs or demo instructions if needed.
- Fix any small regressions that block the demo.

## Risk Tolerance

- Prefer small, targeted fixes over refactors.

## Plan

- Run `gambit init` from a clean directory with no existing `.env`.
- Confirm the OpenRouter key prompt succeeds (masked input) and writes
  `<target>/.env`.
- Validate generated files and location expectations under the target directory.
- Capture any friction points and apply small fixes if needed.

## Stop Conditions

- The demo completes without manual file edits.
- Generated files match the expected locations and names.
