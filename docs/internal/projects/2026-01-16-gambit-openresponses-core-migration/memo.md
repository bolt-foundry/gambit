+++
scope = "Project"
authority = "status"
lifecycle = "beta"
area_owner = "engineering"
+++

# Gambit core + Open Responses format (memo)

Owner: engineering\
Date: 2026-01-16\
Scope: Gambit core runtime format, compatibility layers, and migration options.

## Purpose

- Make Open Responses the canonical Gambit runtime format so adapters can map to
  provider-native APIs without leaking chat-completions semantics.
- Ensure the CLI, simulator, and grading flows stay stable while we migrate:
  `--context`/`--init` must keep working, durable state must serialize, and
  providers must remain pluggable.

## End State

- `@bolt-foundry/gambit-core` exposes only Open Responses items/events and runs
  entirely on `ModelProvider.responses`.
- All provider adapters live in `packages/gambit` behind a compatibility layer.
- Chat-completions callers use a shim in `packages/gambit` until they exit.
- Release tooling (`bft gambit:release`) runs with responses adapters and CI
  coverage (provider conformance, CLI smoke, simulator state tests) green.

## Constraints

- Core cannot ship provider adapters or environment-variable hooks; adapters
  belong in `packages/gambit`.
- During migration, chat compat must stay available so existing decks/tests do
  not break. Only remove it once the CLI + simulator + providers have response
  coverage and a documented fallback.
- Do not merge phases without tests. Each phase must add or update the relevant
  runtime/provider/CLI fixtures before the release stack can advance.
- No release tags until the spec’s “Next steps” checklist is satisfied.

## Tradeoffs

- We accept a temporary duplication window (responses + chat compat) to preserve
  stability.
- Streaming fidelity is scoped to text/function-call items at first; richer
  multimodal items are deferred until adapters stabilize.
- Packaging might bloat slightly because the CLI bundles cards/schemas, but we
  prioritize runtime correctness over binary size in this phase.

## Allowed Changes

- Update core types/runtime/state to Open Responses items/events.
- Move provider adapters into `packages/gambit/src/providers/*` and expose them
  via a compatibility router.
- Add CLI/simulator/test harness changes that are strictly required to keep
  `--context`, `--init`, durable state, and trace exports working.
- Documentation updates (memo + spec) that track the current migration phase.

## Risk Tolerance

- Low. Any regression in `bft precommit`, CLI init/state behavior, or provider
  conformance halts the rollout. Spikes are allowed only behind feature flags
  and must not be released.
- If a phase cannot land with tests, leave it in a draft PR; do not merge
  partial rewrites to main.

## Stop Conditions

- `deno task ci` (packages/gambit) or `bft precommit` fails.
- Manual CLI simulations show `--context`/`--init` divergence or missing
  `gambit_context` payloads.
- Provider adapters lose coverage (provider_conformance tests fail) or we remove
  a provider entirely without a replacement.
- Release helper detects `[SPIKE]` commits without follow-up tests.

## Why this memo exists

We want to catalog the tradeoffs of supporting the Open Responses format in
Gambit core, including whether it should be an adapter or the canonical format.

## Current state (core + gambit)

- Chat-first runtime remains the default, but responses mode is available behind
  `GAMBIT_RESPONSES_MODE=1` / `--responses`.
- Open Responses v1 types + fixtures are exported from
  `packages/gambit-core/src/types.ts`, and runtime/state support responses mode
  when flagged.
- Terminology cleanup is in place: `contextSchema`/`responseSchema` are
  canonical with legacy aliases + warnings; `gambit://cards/*` and
  `gambit://schemas/*` resolve; legacy markers expand with warnings.
- OpenRouter responses adapter lives in `packages/gambit` behind
  `GAMBIT_OPENROUTER_RESPONSES=1`; core still contains
  `packages/gambit-core/src/openai_compat.ts` and
  `packages/gambit-core/src/providers/openrouter.ts` for now.

## Goals

- Make Open Responses the canonical core format (minimal derivations).
- Support multiple providers directly via adapters in `packages/gambit`.
- Keep provider integrations thin via adapters to/from Open Responses.
- Keep `gambit-core` free of provider adapters and environment variables.
- Preserve a chat-completions compatibility adapter in `packages/gambit`.

## Implementation Plan

- Open Responses is the core format, scoped to a minimal item set
  (message/output_text + function_call/function_call_output).
- Core types/runtime/state use Open Responses items/events.
- Provider interface is `responses()` with Open Responses request/response
  types.
- Provider adapters translate Open Responses <-> provider-native APIs in
  `packages/gambit`.
- Chat-completions compatibility lives in `packages/gambit`.

## Rationale for core swap now

- We are early enough that breaking changes have limited blast radius.
- Open Responses items/events are a better fit for agentic workflows.
- A richer core model improves logging, replay, and evals without adapters.
- A single canonical format makes multi-provider support tractable.

## Implementation sketch (core swap, scoped v1)

- Core types in `packages/gambit-core/src/types.ts` become item-first.
- Runtime consumes and emits items in `packages/gambit-core/src/runtime.ts`.
- Provider interface is `responses()` with Open Responses request/response
  types.
- Provider adapters translate Open Responses <-> provider-native APIs in
  `packages/gambit`.
- Chat-completions compatibility lives in `packages/gambit`, not core.
- Optional `onStreamEvent` hook for `response.*` events in core.
- Tests: item-first runtime tests + adapter coverage per provider.

## Migration notes

- Update `packages/gambit-core/src/types.ts` to include items as core types.
- Rework `packages/gambit-core/src/runtime.ts` to operate on items.
- Adjust `packages/gambit-core/src/state.ts` storage schema.
- Keep `packages/gambit-core/src/openai_compat.ts` as an adapter.

## Next steps

1. Add `ModelProvider.responses` (types-only) and export it from
   `@bolt-foundry/gambit-core`.
2. Implement the OpenRouter responses adapter in `packages/gambit` behind
   `GAMBIT_OPENROUTER_RESPONSES=1`, and plan the move of the OpenRouter provider
   out of core.
3. Add provider conformance + CLI smoke tests for responses mode and document
   the flag in the CLI/memo.
4. Prepare the 0.8.2 release: update `packages/gambit/CHANGELOG.md` with the
   default responses switch and plan the version bump.

## Specs

- [Gambit Open Responses v1](specs/gambit-openresponses-v1.md)
- [Open Responses API](specs/openresponses-api.md)

## Mission plan (phased rollout)

- Phase docs:
  - [Phase 0 - Terminology and Namespace Cleanup](phases/phase-0-terminology-and-namespaces.md)
  - [Phase 1 - Type Foundations and Helpers](phases/phase-1-type-foundations.md)
  - [Phase 2 - Dual-Path Provider Interface (OpenRouter only)](phases/phase-2-openrouter-dual-path.md)
  - [Phase 3 - Runtime and State Migration (Opt-in)](phases/phase-3-runtime-state-migration.md)
  - [Phase 4 - Default Switch and Cleanup](phases/phase-4-default-switch.md)
  - [Phase 5 - Remove Chat Compatibility](phases/phase-5-remove-chat-compat.md)

### Phase 0 — Terminology & Namespace Cleanup

- **Purpose**: Remove "init" overload and align deck schema terms with the Open
  Responses mental model before the core swap.
- **End State**: `contextSchema`/`responseSchema` are the primary names;
  `inputSchema`/`outputSchema` remain as deprecated aliases; legacy
  `gambit://init`/`respond`/`end` markers expand with warnings and point to
  `gambit://cards/*` replacements.
- **Constraints**: Must not break existing decks; emit warnings instead of hard
  failures while the alias window is open.
- **Tradeoffs**: Adds short-term compatibility code and doc churn.
- **Allowed Changes**: Loader/markdown updates, doc/scaffold updates, optional
  codemod tooling.
- **Risk Tolerance**: Low—loader regressions halt the phase.
- **Stop Conditions**: CI failures, deck load regressions, or unclear migration
  guidance.

### Phase 1 — Type Foundations & Helpers

- **Purpose**: Introduce Open Responses types/helpers without touching runtime
  behavior so downstream work can import the shapes.
- **End State**: `packages/gambit-core/src/types.ts` exports the new item/event
  types alongside the existing chat types; no call sites use them yet.
- **Constraints**: All existing chat APIs remain untouched; no runtime/CLI code
  references the new types; release artifacts remain identical.
- **Tradeoffs**: We accept duplicated type definitions temporarily to unblock
  adapters; zero runtime risk.
- **Allowed Changes**: New type exports, helper utilities (e.g.,
  `openresponses.ts`), doc updates pointing to the new shapes.
- **Risk Tolerance**: Low—CI must stay green; failure means rollback.
- **Stop Conditions**: CI failure, missing tests for the new helpers, or any
  runtime diff detected while landing the types.

### Phase 2 — Dual-Path Provider Interface (OpenRouter only)

- **Purpose**: Add `ModelProvider.responses` while keeping `ModelProvider.chat`
  working so adapters can migrate incrementally, starting with OpenRouter.
- **End State**: OpenRouter ships both completions (default `chat`) and a
  feature-flagged responses implementation; provider_conformance tests cover
  both modes. Other providers stay on completions until a later release.
- **Constraints**: Runtime/CLI still call `chat`; the responses path is guarded
  by a feature flag/environment toggle and never enabled by default in this
  phase. Adapters remain in `packages/gambit`; core stays adapter-free.
- **Tradeoffs**: Slight adapter complexity because OpenRouter maintains two
  transports for a cycle; other providers are deferred.
- **Allowed Changes**: OpenRouter adapter/router updates, feature flag plumbing,
  provider_conformance tests for both code paths, CLI flags/env vars to opt in
  to OpenRouter responses experiments.
- **Risk Tolerance**: Low—if either OpenRouter path fails CI or smoke tests the
  phase halts; other providers remain untouched.
- **Stop Conditions**: Provider tests fail, CLI smoke fails when the flag is
  enabled, or `--context` regression detected in either OpenRouter mode.

### Phase 3 — Runtime & State Migration (Opt-in)

- **Purpose**: Teach `gambit-core` runtime/state/trace modules to consume Open
  Responses items while retaining the chat path as default.
- **End State**: Runtime/state can be toggled between chat and responses via a
  config flag; simulator + CLI tests exercise both modes; `--context`/`--init`
  flows have regression coverage.
- **Constraints**: Default behavior remains chat; opt-in flag required to use
  responses; documentation clearly marks the mode as experimental; release
  tooling still runs in chat mode.
- **Tradeoffs**: Additional configuration surface and more tests to maintain in
  the short term.
- **Allowed Changes**: Runtime/state implementation, trace/event emitters,
  CLI/simulator plumbing, new fixtures validating init/state/resume.
- **Risk Tolerance**: Medium—failures inside the opt-in path are acceptable as
  long as default chat stays green; any default regression halts rollout.
- **Stop Conditions**: `deno task ci` fails in default mode, CLI smoke fails, or
  opt-in tests show deterministically broken behavior without a mitigation.

### Phase 4 — Default Switch & Cleanup

- **Purpose**: Flip the default runtime/provider interface to Open Responses and
  deprecate the chat path for end users.
- **End State**: CLI/simulator/providers run on responses by default; chat
  compat remains behind a fallback flag; release 0.8.2+ ships with responses.
- **Constraints**: All provider adapters must be response-capable with
  conformance coverage; `bft precommit` and manual smoke tests run in responses
  mode; docs/CLI help updated.
- **Tradeoffs**: Short-term compatibility mode complexity until downstream
  workflows migrate.
- **Allowed Changes**: Default config change, doc/help updates, feature flag
  inversion, release engineering tasks (version bump, changelog).
- **Risk Tolerance**: Very low—any regression triggers rollback per the
  stop-conditions list.
- **Stop Conditions**: CI/test failures, customer-reported regressions, or
  incompatibility with existing decks; revert to Phase 3 if triggered.

### Phase 5 — Remove Chat Compatibility

- **Purpose**: Delete the legacy chat path once all consumers are on responses.
- **End State**: No chat-specific APIs remain; adapters, runtime, and CLI only
  reference responses types.
- **Constraints**: Requires explicit approval + proof that downstream repos have
  migrated; a release note communicates removal.
- **Tradeoffs**: None beyond code cleanup; simplifies maintenance.
- **Allowed Changes**: Delete chat helpers, remove compatibility flags, prune
  docs.
- **Risk Tolerance**: Medium—acceptable to delay the phase if any lingering
  dependency is discovered.
- **Stop Conditions**: Missing migration proof, partner dependencies still on
  chat, or CI fails after removal.
