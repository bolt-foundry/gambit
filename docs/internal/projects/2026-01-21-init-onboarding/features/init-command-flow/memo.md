# Feature Memo – Init Command Flow

## Purpose

Transform `gambit init` from static scaffolding into an interactive init chat
launcher.

## End State

- `gambit init` creates/uses a target directory (default `./gambit/`).
- If `OPENROUTER_API_KEY` is missing, the CLI prompts for a pasted key.
- CLI launches REPL with the init deck and init-only file tools enabled.

## Constraints

- No browser signup flow in v1.
- Avoid new UI surfaces; stick to REPL.

## Tradeoffs

- Minimal setup prompts over exhaustive config choices.

## Allowed Changes

- Update `packages/gambit/src/commands/init.ts`.
- Add any minimal helpers needed for the flow.

## Risk Tolerance

- Prefer a simple, deterministic flow.

## Stop Conditions

- Running `gambit init` drops into the init chat and can complete file writes.
- The CLI path defaults and key prompt behave consistently.
