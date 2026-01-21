+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Phase 1 — Type Foundations & Helpers

Owner: engineering\
Date: 2026-01-16\
Status: complete (2026-01-21)

## Purpose

Introduce Open Responses types and helpers without changing runtime behavior.

## End state

- `packages/gambit-core/src/types.ts` exports Open Responses item/event types.
- Optional helper module exists (e.g. `openresponses.ts`) for mapping utilities.
- No runtime, CLI, or provider call sites reference the new types yet.

## Entry criteria

- [x] `specs/gambit-openresponses-v1.md` drafted.
- [x] `specs/gambit-openresponses-v1.md` is reviewed and approved.
- [x] Phase 0 complete.
- [x] No active runtime refactors in progress.

## Exit criteria

- [x] Types compile and export cleanly.
- [x] No runtime diffs in behavior or public API.
- [x] Type fixtures added for Open Responses shapes (no helper utilities in
      Phase 1).
- [x] `bft precommit` remains green.

## Checklist

- [x] Add Open Responses type exports to `packages/gambit-core/src/types.ts`.
- [ ] Add helper utilities for item mapping (optional; deferred to Phase 2).
- [x] Document the new exports in `gambit-core` README if needed (not needed
      yet).
- [x] Ensure no runtime/CLI code paths import the new types yet.

## Tests and validation

- [x] `bft precommit`.
- [x] `deno test` for any new helper modules (N/A - none added).

## Flags and toggles

- None for this phase.

## Decision points

- Do we need multimodal items (image/file) in v1, or text-only?
  - Recommendation: start text-only (message/output_text + function calls) and
    add multimodal once adapters and state storage are stable.
- Is streaming required for core, or adapter-only at first?
  - Recommendation: include streaming support in core via `ResponseEvent` types,
    but keep it optional for adapters to implement early.

## Stop conditions

- CI failure.
- Any runtime diff detected while landing type-only changes.

## Notes and updates

- 2026-01-16: Phase doc created.
- 2026-01-21: Phase complete; Open Responses types + fixtures landed, helpers
  deferred.
