# Feature Memo – Init-Only File Tools

## Purpose

Enable the init deck to inspect and write files safely within a scoped
workspace.

## End State

- Init-only tools exist for `write`, `exists`, `mkdir`.
- Writes are scoped to the target project root.
- Tools are only available to the init deck during `gambit init`.

## Constraints

- No delete/append/list/read in v1.
- Enforce path scoping in the CLI layer, not in the deck.

## Tradeoffs

- Smaller tool surface now to reduce risk.

## Allowed Changes

- Add new tool definitions and wiring in the CLI runtime.
- Add permission checks for target root scoping.

## Risk Tolerance

- Prefer strict path validation over flexibility.

## Stop Conditions

- Tool calls succeed for valid paths and fail for paths outside the project
  root.
- Init deck can write files without crashing the REPL.
