+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Phase 3 — Runtime & State Migration (Opt-in)

Owner: engineering\
Date: 2026-01-16\
Status: complete (2026-01-22)

## Purpose

Teach gambit-core runtime/state/trace modules to consume Open Responses items
behind an opt-in flag, while keeping chat the default.

## End state

- Runtime and state can run in chat or responses mode via a flag.
- CLI and simulator tests cover both modes.
- `--context`/`--init` behavior is unchanged and regression-tested.

## Entry criteria

- [x] Phase 2 complete and OpenRouter responses adapter available.
- [x] Responses flag naming finalized.
- [x] SavedState schema changes documented.

## Exit criteria

- [x] Responses mode can run end-to-end in CLI/simulator.
- [x] Default chat mode remains green.
- [x] State serialization works for chat and responses formats.

## Checklist

- [x] Update runtime loop to emit/consume response items when flagged.
- [x] Update `SavedState` to support `items` + `format: "responses"`.
- [x] Update trace events to include mode and response data.
- [x] Maintain `messageRefs`/derived messages for simulator UI.
- [ ] Add fixtures for `--context`/`--init` and resume flows in both modes.
- [x] Document responses mode in CLI/docs.

## Tests and validation

- [x] Runtime tests for item-first execution.
- [x] State load/save tests for chat and responses.
- [x] CLI smoke tests for `run`, `repl`, `test-bot` with responses flag.
- [x] Simulator UI test pass in responses mode.

## Flags and toggles

- `GAMBIT_RESPONSES_MODE=1` or CLI `--responses` (opt-in runtime/state mode).

## Decision points

- Should chat compatibility stay in core if core cannot ship provider adapters?
  - Decision: move `chatCompletionsWithDeck` into `packages/gambit` so core
    remains provider-free.
- How should `SavedState`/`TraceEvent` migrations be handled?
  - Recommendation: introduce a versioned schema with a small upgrader in
    `packages/gambit-core/src/state.ts`, plus a fallback flag to emit legacy
    chat-shaped state for one release cycle.
- How should streaming events be stored in durable state and trace exports?
  - Recommendation: store only final items in durable state; trace exports
    should include streaming events as optional metadata when enabled.

## Stop conditions

- Default chat CI fails.
- `--context`/`--init` regression detected.
- Responses mode is deterministically broken without mitigation.

## Notes and updates

- 2026-01-16: Phase doc created.
- 2026-01-22: Responses mode wired through runtime/state/CLI; manual
  `gambit run` verified in responses mode, precommit + responses CLI smoke run
  complete; full CI validation still pending.
- 2026-01-22: Phase accepted as complete; remaining CI gaps acknowledged.
