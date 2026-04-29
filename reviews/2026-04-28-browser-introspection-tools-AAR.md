# Browser Runtime Introspection Tools AAR

## Context

Workloop needed more browser read tools after the pointer-targeting pass:
waiting, page state, text/region queries, point inspection, viewport controls,
highlighting, link extraction, and recent console/network diagnostics. The
Workloop tool boundary should remain narrow and must not expose arbitrary
browser eval.

Because Workloop routes browser commands through the shared Gambit browser
runtime, the live-session command contract needed to support those capabilities.

## Intent

- Purpose: add structured browser live-session introspection commands that
  Workloop can expose as narrow coworker tools.
- End State: live sessions support read-only page state, text, region, element,
  viewport, point, link, console, and network-failure inspection, plus bounded
  wait and highlight commands.
- Constraints / Tradeoffs: keep arbitrary eval out of the Workloop-facing
  surface; keep the runtime command payloads explicit and typed; preserve
  existing query/ref/mouse commands.
- Phase (if applicable): Workloop browser-use Phase 2 support with Phase 6
  screenshot/debug evidence support.

## What Happened

Extended `BrowserLiveSessionCommand` with wait, page-state, text query, region
query, element description, stable-layout wait, viewport measurement/resize,
point inspection, highlight, link extraction, console read, and network failure
read commands.

The live daemon now keeps bounded in-memory rings for console messages and
failed network requests. It can derive visible text blocks, element boxes,
visible links with `href`, and the element stack at a coordinate. Highlighting
adds a visible overlay that can be captured by the existing screenshot command.

The new DOM-inspection helpers live in `liveSessionInspection.ts`, keeping
`liveSessionDaemon.ts` below the repository file-length hard limit.

## Delta Analysis

The earlier runtime supported enough structure to click a known target, but it
did not provide enough state for robust multi-step page diagnosis. Adding these
commands to the runtime keeps Workloop's tool wrapper simple and lets future
CLI/operator surfaces reuse the same underlying behavior if needed.

The implementation intentionally does not remove the runtime's existing low
level eval command because it predates Workloop and is useful for developer
verification. Workloop still does not expose it as an assistant tool.

## Initiative Assessment

Disciplined initiative: the command contract was extended in one place and the
Workloop wrapper simply forwards typed commands.

Disciplined initiative: link extraction now includes `href`, which avoids
forcing callers to infer navigation targets from text and coordinates.

Disciplined initiative: verification exercised a real browser session and
captured console/network failure events rather than relying only on typechecks.

## Weaknesses In Intent

The runtime still has duplicated accessible-name logic between query and element
description. That is acceptable for this pass, but a follow-up should extract a
shared helper if more DOM description behavior is added.

## What We Will Sustain

- Keep Workloop-facing commands typed and narrow.
- Preserve mouse/ref based actuation as the default action model.
- Keep diagnostic event buffers bounded so sessions do not grow unbounded in
  long tasks.

## What We Will Improve

- Add stale-ref generation semantics if real traces show refs reused after
  navigation.
- Consider exposing these commands in the developer CLI only if operator
  workflows need them directly.

## Ownership And Follow-Up

- Owner: Gambit browser runtime maintainers.
- Action: monitor Workloop browser-use traces for missed controls, stale refs,
  and whether console/network diagnostics explain page failures.
- Target date: next browser-runtime polish pass.

## Verification Evidence

- `deno fmt apps/workloop/sidecar/chief_runtime_browser_tools.ts apps/workloop/sidecar/chief_runtime_browser_tools_test.ts apps/workloop/sidecar/chief_runtime_workloop_tools_test.ts packages/browser-runtime/src/liveControl.ts packages/browser-runtime/src/liveSessionDaemon.ts packages/browser-runtime/src/liveSessionInspection.ts`
  passed as part of the final formatting run with `Checked 10 files`.
- `deno check --config packages/browser-runtime/deno.json packages/browser-runtime/src/liveSessionDaemon.ts packages/browser-runtime/src/liveSessionInspection.ts`
  passed.
- `deno test -A --config packages/browser-runtime/deno.json packages/browser-runtime/src/liveControl.test.ts packages/browser-runtime/src/liveSessionDaemon.test.ts`
  passed: 8 tests.
- Live smoke: a headless session named `workloop-js-tools-smoke` validated all
  new runtime commands on a local `data:` page. The run extracted a visible link
  with `href` `https://example.com/docs`, captured console event
  `smoke-console-error`, captured failed request
  `http://127.0.0.1:9/missing-smoke.png`, and wrote screenshot evidence to
- Live smoke after the file split repeated the same command sequence and wrote
  screenshot evidence to
  `/Users/randallb/code/bolt-foundry/codebot-workspaces/shared/bft-e2e/browser-live-workloop-js-tools-smoke/__latest__/screenshots/2026-04-28T22-23-36-724Z_browser-js-tools-smoke-refactor.png`.
- `direnv exec . bft precommit` passed after splitting Gambit and Workloop
  commits: codegen produced no tracked changes, format/lint/typecheck passed,
  and the full test run reported `1484 passed`, `0 failed`, and `3 ignored`.
