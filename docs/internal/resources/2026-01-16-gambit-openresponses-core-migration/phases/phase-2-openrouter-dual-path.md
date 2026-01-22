+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Phase 2 — Dual-Path Provider Interface (OpenRouter only)

Owner: engineering\
Date: 2026-01-16\
Status: complete (2026-01-22)

## Purpose

Introduce `ModelProvider.responses` and a feature-flagged OpenRouter responses
adapter while keeping the runtime chat-first.

## End state

- OpenRouter supports both chat and responses paths.
- Responses path is opt-in via flag; chat remains the default.
- Provider conformance coverage exists for both paths.
- Adapters live in `packages/gambit` (core stays adapter-free).

## Entry criteria

- [x] Phase 1 complete.
- [x] v1 responses contract approved.
- [x] Flag names for responses mode agreed.

## Exit criteria

- [x] OpenRouter responses implementation passes conformance tests.
- [x] CLI smoke test passes with responses flag enabled.
- [x] Chat path remains default and unchanged.

## Checklist

- [x] Add `ModelProvider.responses` signature in `gambit-core` types.
- [x] Implement OpenRouter responses adapter in `packages/gambit`.
- [x] Add a feature flag to enable responses for OpenRouter only.
- [x] Provide provider conformance coverage for chat + responses.
- [x] Document the flag in CLI docs or the project memo.

## Tests and validation

- [x] Provider conformance tests for OpenRouter chat and responses.
- [x] CLI smoke test in responses mode (flag on).
- [ ] `deno task ci` stays green in default chat mode.

## Flags and toggles

- `GAMBIT_OPENROUTER_RESPONSES=1` (enables OpenRouter responses path only).

## Decision points

- Where should opt-in flags live if core cannot read env vars?
  - Recommendation: keep env parsing in CLI and/or `packages/gambit` and pass a
    typed config into core; core should only accept an explicit flag value.
- Should the `ModelProvider.responses` interface live in core, or in
  `packages/gambit`?
  - Recommendation: define the interface types in core (pure types), implement
    adapters and any routing layer in `packages/gambit`.

## Stop conditions

- Provider conformance failures.
- CLI smoke failure with the flag enabled.
- `--context` regression in either OpenRouter mode.

## Notes and updates

- 2026-01-16: Phase doc created.
- 2026-01-21: Phase 1 complete; Phase 2 ready to start.
- 2026-01-22: OpenRouter responses adapter + flag wiring landed; conformance and
  CLI smoke tests still pending.
- 2026-01-22: Added OpenRouter conformance coverage and responses adapter
  normalization fixes; validation run completed.
