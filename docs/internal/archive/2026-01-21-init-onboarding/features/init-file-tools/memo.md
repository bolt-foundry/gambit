# Feature Memo – Init-Only File Tools

## Purpose

Enable the init deck to inspect and write files safely within a scoped
workspace.

## End State

- Init-only tools exist for `write`, `exists`, `mkdir`.
- Writes are scoped to the target project root, with paths resolved relative to
  it.
- `write` fails if the path already exists; `exists` reports on the resolved
  path; `mkdir` is recursive.
- Tools are only available to the init deck during `gambit init`.

## Constraints

- No delete/append/list/read in v1.
- Enforce path scoping in the CLI layer, not in the deck.
- Reject traversal (`..`), absolute paths outside the target root, and symlink
  escapes (validate with realpath when possible).

## Tradeoffs

- Smaller tool surface now to reduce risk.

## Allowed Changes

- Add new tool definitions and wiring in the CLI runtime.
- Add permission checks for target root scoping.

## Risk Tolerance

- Prefer strict path validation over flexibility.

## Stop Conditions

- Tool calls succeed for valid paths and fail for paths outside the project root
  (including traversal or symlink escapes).
- `write` refuses to overwrite existing files.
- Init deck can write files without crashing the REPL.
