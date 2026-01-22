+++
scope = "Resource"
authority = "status"
lifecycle = "beta"
area_owner = "engineering"
+++

# Gambit Core Open Responses Migration

## Current status

Phase 4 is complete; Phase 5 is deferred to allow responses mode to bake in
production. This project doc set now lives under resources until the team is
ready to pick up Phase 5.

## Context

Gambit core is currently built around a chat-completions style interface
(`ModelProvider.chat`, `ModelMessage`, tool calls). We want to align the core
API and types with the Open Responses specification to improve interoperability
and future-proof provider integrations.

## Goal

Adopt Open Responses as the primary abstraction for model calls, streaming, and
tool use in gambit-core, while preserving Gambit deck/runtime semantics and
minimizing disruption for CLI/UI. Provider adapters (including chat completions)
live in `packages/gambit`, not in `gambit-core`.

## Scope

- Replace chat-completions centric types with Open Responses types.
- Update model provider interface to a Responses-style API.
- Update runtime and state storage to use response items.
- Move all provider adapters to `packages/gambit`.
- Reimplement chat-completions compatibility as a `packages/gambit` adapter.

## Decisions

- `gambit-core` is Open Responses-first and contains no provider adapters.
- Provider adapters (OpenAI/Anthropic/OpenRouter/etc.) live in
  `packages/gambit`.
- OpenRouter is a standard adapter and the default fallback in
  `packages/gambit`.
- Chat-completions compatibility is implemented in `packages/gambit`.
- `gambit-core` relies on library configuration (no environment variables).
- Target version bump: `@bolt-foundry/gambit` and `@bolt-foundry/gambit-core`
  move to `0.8.0` when the breaking changes land.

## Current Architecture (Relevant Files)

- Provider interface: `packages/gambit-core/src/types.ts`
- Runtime loop: `packages/gambit-core/src/runtime.ts`
- State model: `packages/gambit-core/src/state.ts`
- Provider adapters (target): `packages/gambit`

## Target Architecture

- New `ModelProvider.responses(...)` with Open Responses request/response types.
- Core "input" and "output" are Open Responses items.
- Streaming uses Open Responses event types (for example
  `response.output_text.delta`).
- State stores response items or full response output, not only messages.
- Provider adapters (including OpenRouter) translate to/from Open Responses in
  `packages/gambit`.
- Chat-completions compatibility lives in `packages/gambit` on top of Responses.

## Supporting specs

- `specs/openresponses-api.md` (external spec notes)
- `specs/gambit-openresponses-v1.md` (Gambit subset, mapping, flags, tests)

## Phase trackers

- `phases/phase-0-terminology-and-namespaces.md`
- `phases/phase-1-type-foundations.md`
- `phases/phase-2-openrouter-dual-path.md`
- `phases/phase-3-runtime-state-migration.md`
- `phases/phase-4-default-switch.md` (complete)
- `phases/phase-5-remove-chat-compat.md` (deferred)

## Proposed Phased Approach (Decision-Aligned)

1. Introduce Open Responses Types in `gambit-core`
   - Add `ResponseItem`, `CreateResponseRequest`, `CreateResponseResponse`,
     `ResponseEvent` types in `packages/gambit-core/src/types.ts`.
2. Swap Provider Interface in `gambit-core`
   - Replace `ModelProvider.chat` with `ModelProvider.responses`.
   - Update runtime to call `responses()` and consume output items/events.
3. Update Core State + Runtime
   - Store response items and metadata in `packages/gambit-core/src/state.ts`.
   - Update rendering/export paths to use response items.
4. Implement Provider Adapters in `packages/gambit`
   - Add Open Responses adapters per provider.
   - OpenRouter is a standard adapter and default fallback in gambit.
5. Add Chat-Completions Compatibility in `packages/gambit`
   - Implement a chat-completions wrapper on top of Responses for backwards
     compatibility.
6. Remove Provider Adapters from `gambit-core`
   - Move any provider-specific code (OpenRouter/OpenAI compat) into
     `packages/gambit`.

## Other Options Considered (Not Selected)

1. Adapter-only (keep chat-completions core)
   - Rejected because it keeps core coupled to chat semantics and limits Open
     Responses fidelity.
2. Hybrid migration (dual types)
   - Rejected to avoid long-lived conversion complexity and split mental model.

## Key Mapping Notes

- `system/user/assistant` messages -> `message` items.
- `tool` messages -> `function_call_output` items.
- tool calls -> `function_call` items.
- streaming text -> `response.output_text.delta` events.

## Risks / Open Questions

- Provider support for Responses vs chat-completions (OpenRouter compatibility).
  - Recommendation: ship OpenRouter as an adapter in `packages/gambit` but keep
    the core API strictly Responses-first; treat chat-completions as a compat
    layer only.
- Impact on UI, tracing, and exported artifacts.
  - Recommendation: add minimal item rendering first (message/output_text +
    function calls) and defer richer item types until UI/export gaps are known.
- Backward compatibility requirements for downstream users.
  - Recommendation: defer compatibility work until core + adapters stabilize;
    avoid dual types in core.

## Definition of Done

- Core runtime uses Open Responses types end-to-end.
- Providers implement Responses API.
- Tests updated/added for Responses flows.
- Chat-completions compatibility remains available via adapter.
