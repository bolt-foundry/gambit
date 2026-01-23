# Phase 2 – Init-Only File Tools

## Questions

- Purpose: Why are we doing this phase?
- End State: What must be true when this phase is done?
- Constraints: What limits or rules apply?
- Tradeoffs: What are we intentionally choosing not to do?
- Allowed Changes: What can we change without re-scoping?
- Risk Tolerance: How much risk is acceptable here?
- Stop Conditions: How do we know we are finished?

## Purpose

Enable the init deck to write files safely within a scoped project root.

## End State

- Init-only tools exist for `write`, `exists`, and `mkdir`.
- Tool access is restricted to the target project root, with paths resolved
  relative to it.
- `write` fails if the path already exists; `exists` reports on the resolved
  path; `mkdir` is recursive.
- Tools are only available during `gambit init`.

## Constraints

- No delete/append/list/read in v1.
- Enforce path scoping in the CLI layer (not the deck).
- Reject traversal (`..`), absolute paths outside the target root, and symlink
  escapes (validate with realpath when possible).

## Tradeoffs

- Keep the tool surface minimal to reduce risk.

## Allowed Changes

- Add tool definitions and wiring in the CLI runtime.
- Add strict path validation for scoped writes.

## Risk Tolerance

- Prefer strict validation over flexibility.

## Plan

- Define init-only file tools: `write`, `exists`, `mkdir` with explicit
  semantics (`write` fails if the path exists; `mkdir` is recursive).
- Implement path scoping: resolve paths against the target root, normalize,
  reject escapes (including `..` and symlink traversal via realpath checks when
  possible).
- Add CLI wiring so tools are only registered during `gambit init`.
- Add minimal tool-call tests or manual checks: valid path, `../` traversal,
  absolute path outside root, symlink escape, and write-to-existing file.

## Stop Conditions

- Tool calls succeed for valid paths under the project root.
- Tool calls fail for paths outside the project root, including traversal or
  symlink escapes.
- `write` refuses to overwrite existing files.
- Init deck can write files without crashing the REPL.
