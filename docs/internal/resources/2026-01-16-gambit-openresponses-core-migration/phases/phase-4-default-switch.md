+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Phase 4 — Default Switch & Cleanup

Owner: engineering\
Date: 2026-01-16\
Status: complete (2026-01-22)

## Purpose

Flip defaults so responses are the primary runtime/provider interface, while
keeping chat compat behind a fallback flag.

## End state

- CLI/simulator/providers run on responses by default.
- Chat compat exists behind an explicit fallback flag.
- Release 0.8.2+ ships with responses enabled.

## Entry criteria

- [x] Phase 3 complete with stable responses mode.
- [x] All providers are response-capable with conformance coverage.
- [x] CLI/simulator smoke tests pass in responses mode.

## Exit criteria

- [x] Default mode is responses; chat mode is opt-in fallback.
- [x] Docs and CLI help updated.
- [x] Release tooling passes with responses adapters.

## Checklist

- [x] Identify the default-setting entrypoints (CLI, server, simulator) and set
      responses mode as the default.
- [x] Introduce `GAMBIT_CHAT_FALLBACK=1` (or equivalent) and wire it through CLI
      and `packages/gambit` config to force chat mode.
- [x] Update CLI help text + docs to reflect new defaults and fallback flag.
- [x] Run `bft precommit` with responses as default and verify chat fallback.
- [x] Run OpenRouter conformance tests for chat + responses.
- [x] Add a short release note + version bump plan for 0.8.2+.

## Tests and validation

- [x] `bft precommit` passes in responses mode.
- [x] Manual CLI smoke tests for `--context`/`--init`.
- [x] Provider conformance tests pass.

## Flags and toggles

- `GAMBIT_CHAT_FALLBACK=1` (or equivalent) to force chat mode.

## Decision points

- How much backward compatibility do we need for existing users?
  - Recommendation: defer compatibility work until core + adapters stabilize;
    avoid dual types in core.

## Stop conditions

- CI/test failures.
- Customer-reported regressions.
- Incompatibility with existing decks/tests.

## Notes and updates

- 2026-01-16: Phase doc created.
- 2026-01-22: Default responses mode + chat fallback flag wired; CLI smoke
  validated in both default and fallback modes, including `test-bot`.
- 2026-01-22: CLI/help docs updated to mark responses as default; changelog note
  added for the 0.8.2 release.
- 2026-01-22: `deno task ci` + `bft precommit` green with responses default;
  OpenRouter conformance tests pass. Supabase-dependent tests skipped (env var
  missing). Warnings emitted for deprecated `inputSchema`/`outputSchema` in temp
  decks (recommend renaming to `contextSchema`/`responseSchema`).
- 2026-01-22: Manual CLI smoke tests for `gambit run` with `--context` and
  legacy `--init` succeeded (hello deck).
- 2026-01-22: `deno task e2e` reports no simulator e2e tests present (no
  `*.e2e.ts` files). Simulator smoke coverage still needs a manual `serve`
  verification or new e2e tests.
- 2026-01-22: Manual simulator smoke: `gambit serve` on port 8010 with the hello
  deck responds with the Debug UI HTML (`http://localhost:8010/`). Port 8000 was
  already in use.
- 2026-01-22: Provider coverage note: OpenRouter is the only provider in
  `packages/gambit/src/providers`, and its responses + conformance tests pass.
- 2026-01-22: Release tooling gate: `deno task ci` and `bft precommit` pass with
  responses default.
