# Feature Memo – Init Command Flow

## Purpose

Transform `gambit init` from static scaffolding into an interactive init chat
launcher.

## End State

- `gambit init` creates/uses a target directory (default `./gambit/`).
- All generated files are written under the target directory:
  `<target>/root.deck.md` and `<target>/tests/first.test.deck.md`.
- If `OPENROUTER_API_KEY` is missing in env and `<target>/.env`, the CLI prompts
  for a pasted key and writes `<target>/.env`.
- CLI launches REPL with the init deck and init-only file tools enabled.

## Constraints

- No browser signup flow in v1.
- Avoid new UI surfaces; stick to REPL.
- No overwrites; require a clean target directory for the hardcoded outputs.

## Tradeoffs

- Minimal setup prompts over exhaustive config choices.

## Allowed Changes

- Update `packages/gambit/src/commands/init.ts`.
- Add any minimal helpers needed for the flow.

## Risk Tolerance

- Prefer a simple, deterministic flow.

## Stop Conditions

- Running `gambit init` drops into the init chat and can complete file writes
  under the target directory.
- The CLI path defaults and key prompt behave consistently.
