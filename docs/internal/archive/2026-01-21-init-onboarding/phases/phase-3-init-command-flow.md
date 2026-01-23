# Phase 3 – Init Command Flow

## Questions

- Purpose: Why are we doing this phase?
- End State: What must be true when this phase is done?
- Constraints: What limits or rules apply?
- Tradeoffs: What are we intentionally choosing not to do?
- Allowed Changes: What can we change without re-scoping?
- Risk Tolerance: How much risk is acceptable here?
- Stop Conditions: How do we know we are finished?

## Purpose

Transform `gambit init` from static scaffolding into an interactive init chat
launcher.

## End State

- `gambit init` creates/uses a target directory (default `./gambit/`).
- All generated files are written under the target directory:
  `<target>/root.deck.md` and `<target>/tests/first.test.deck.md`.
- If `OPENROUTER_API_KEY` is missing in env and `<target>/.env`, the CLI prompts
  for a pasted key (masked input) and writes `<target>/.env`; otherwise it skips
  the prompt.
- CLI launches the REPL with the init deck and init-only file tools enabled.
- If output files already exist, the command exits with a clear message and does
  not overwrite.

## Constraints

- No browser signup flow in v1.
- Avoid new UI surfaces; stick to the REPL.
- No overwrites; require a clean target directory for the hardcoded outputs.

## Tradeoffs

- Minimal setup prompts over exhaustive config choices.

## Allowed Changes

- Update `packages/gambit/src/commands/init.ts`.
- Add minimal helpers needed for the flow.

## Risk Tolerance

- Prefer a simple, deterministic flow.

## Plan

- Update `gambit init` to create/use the target directory and treat it as the
  root for all generated files.
- Check for existing `<target>/root.deck.md` and
  `<target>/tests/first.test.deck.md`; exit with a clear message if they exist.
- Prompt for `OPENROUTER_API_KEY` if missing in env and `<target>/.env`, then
  write `<target>/.env` using masked input; skip the prompt if already present.
- Launch the REPL with the init deck and init-only tools scoped to the target
  directory.
- Verify the flow works with default path `./gambit/` and writes the expected
  files under that directory.

## Stop Conditions

- Running `gambit init` drops into the init chat.
- The init chat can complete file writes successfully under the target
  directory.
- Existing output files cause a safe, explicit exit without overwriting.
