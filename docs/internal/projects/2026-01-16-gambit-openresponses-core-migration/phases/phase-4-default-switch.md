+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Phase 4 — Default Switch & Cleanup

Owner: engineering\
Date: 2026-01-16\
Status: in progress (default switch landed; validation pending)

## Purpose

Flip defaults so responses are the primary runtime/provider interface, while
keeping chat compat behind a fallback flag.

## End state

- CLI/simulator/providers run on responses by default.
- Chat compat exists behind an explicit fallback flag.
- Release 0.8.2+ ships with responses enabled.

## Entry criteria

- [x] Phase 3 complete with stable responses mode.
- [ ] All providers are response-capable with conformance coverage.
- [ ] CLI/simulator smoke tests pass in responses mode.

## Exit criteria

- [x] Default mode is responses; chat mode is opt-in fallback.
- [x] Docs and CLI help updated.
- [ ] Release tooling passes with responses adapters.

## Checklist

- [x] Identify the default-setting entrypoints (CLI, server, simulator) and set
      responses mode as the default.
- [x] Introduce `GAMBIT_CHAT_FALLBACK=1` (or equivalent) and wire it through CLI
      and `packages/gambit` config to force chat mode.
- [x] Update CLI help text + docs to reflect new defaults and fallback flag.
- [ ] Run `bft precommit` with responses as default and verify chat fallback.
- [ ] Run OpenRouter conformance tests for chat + responses.
- [x] Add a short release note + version bump plan for 0.8.2+.

## Tests and validation

- [ ] `bft precommit` passes in responses mode.
- [ ] Manual CLI smoke tests for `--context`/`--init`.
- [ ] Provider conformance tests pass.

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
