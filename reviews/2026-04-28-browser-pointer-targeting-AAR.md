# Browser Runtime Pointer Targeting AAR

## Context

The shared browser runtime had live-session click support for selectors and raw
coordinates. Workloop needed a safer higher-level tool surface where agents
could inspect visible controls, choose a target, move the browser mouse there,
and click without exposing arbitrary page evaluation.

Because Workloop browser tools depend on the Gambit browser runtime, the runtime
needed to provide the underlying query/ref/mouse contract before the Workloop
tool wrapper could expose it.

## Intent

- Purpose: support reliable pointer-based browser targeting from the shared
  browser runtime.
- End State: live sessions can query visible interactive elements, return
  short-lived refs, move the mouse to refs/selectors/coordinates, click via the
  mouse, and include the tracked cursor in screenshots.
- Constraints / Tradeoffs: keep arbitrary eval out of the Workloop agent tool
  surface; use DOM inspection only inside the runtime to derive visible
  coordinates; preserve existing selector and coordinate callers.
- Phase (if applicable): Workloop browser-use Phase 2 support with Phase 6
  screenshot evidence support.

## What Happened

Added a `query` live-session command and ref fields for `mouse-move` and
`click`. Query uses constrained runtime-internal DOM inspection to find visible
interactive elements and returns refs such as `e1` for follow-up commands.

Changed live-session click handling to resolve refs and selectors to center
points, move the Playwright mouse there, and click with `page.mouse.click`.
Screenshots now temporarily render the tracked cursor position before capture.

Updated the browser CLI so operator workflows can exercise `live query`,
`live mouse move --ref`, and `live click --ref`.

## Delta Analysis

The previous selector/coordinate API was too low-level for agents that need to
decide among visually similar controls. Returning short-lived refs gives the
agent enough structure to choose a target while keeping actuation mouse-based.

The query command intentionally implements a pragmatic accessible-name subset
rather than a full accessibility tree. That keeps the change small and suitable
for the current failure mode.

## Initiative Assessment

Disciplined initiative: the runtime preserved existing selector and coordinate
contracts while adding refs as an optional, safer target handoff.

Disciplined initiative: screenshot cursor rendering was kept as a temporary
artifact-time overlay rather than a durable page mutation.

## Weaknesses In Intent

No material weaknesses identified for the runtime slice. Future intent should
say whether a full accessibility-tree source is required.

## What We Will Sustain

- Keep browser actuation mouse-based.
- Keep query/read support narrow and structured.
- Keep runtime CLI support aligned with programmatic live-session commands.

## What We Will Improve

- Add stronger stale-ref semantics if query refs are reused after navigation in
  real traces.
- Replace the accessible-name subset with a browser accessibility-tree source if
  query misses become common.

## Ownership And Follow-Up

- Owner: Gambit browser runtime maintainers.
- Action: monitor Workloop browser traces for query quality and stale-ref
  frequency.
- Target date: next browser-runtime polish pass.

## Verification Evidence

- `deno fmt` on the touched browser runtime and mirrored browser files passed.
- `deno check --config packages/browser-runtime/deno.json packages/browser-runtime/src/liveSessionDaemon.ts packages/browser-runtime/src/browserCli.ts`
  passed.
- `deno test -A --config packages/browser-runtime/deno.json packages/browser-runtime/src/liveControl.test.ts packages/browser-runtime/src/liveSessionDaemon.test.ts`
  passed: 8 tests.
- Live smoke: a headless session queried a checkbox by role/name, returned ref
  `e1`, moved to it, captured a screenshot with the visible cursor overlay,
  clicked it with the mouse path, and verified the checkbox became checked.
- `direnv exec . bft precommit` passed the full repo gate: codegen no tracked
  changes, format, lint, typecheck, and 1479 tests passed with 3 ignored.
