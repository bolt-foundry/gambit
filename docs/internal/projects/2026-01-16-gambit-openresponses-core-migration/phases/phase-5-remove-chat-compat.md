+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Phase 5 — Remove Chat Compatibility

Owner: engineering\
Date: 2026-01-16\
Status: blocked (Phase 4 incomplete)

## Purpose

Delete the legacy chat path once all consumers are on responses.

## End state

- No chat-specific APIs remain.
- Adapters, runtime, and CLI reference responses types only.
- Docs no longer mention chat compatibility flags.

## Entry criteria

- [ ] Explicit approval to remove chat support.
- [ ] Proof that downstream repos have migrated.
- [ ] Responses mode is stable in production.

## Exit criteria

- [ ] Chat types/helpers removed from core.
- [ ] Compatibility flags removed.
- [ ] CI passes without chat artifacts.
- [ ] Release notes communicate removal.

## Checklist

- [ ] Confirm downstream migration proof (repos + clients) and record sign-off.
- [ ] Remove `ModelProvider.chat` usage from runtime/commands/tests.
- [ ] Remove chat types/helpers from `gambit-core` and `gambit`.
- [ ] Delete chat compatibility adapters and any fallback flags.
- [ ] Remove chat-specific CLI flags and docs references.
- [ ] Run full CI and responses-mode smoke tests.

## Tests and validation

- [ ] `bft precommit` passes.
- [ ] CLI smoke tests in responses mode.

## Stop conditions

- Missing migration proof.
- Partner dependencies still on chat.
- CI failures after removal.

## Notes and updates

- 2026-01-16: Phase doc created.
