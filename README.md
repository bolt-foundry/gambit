# Gambit v0 Blueprint

Open-source Deno library for deck/card-based assistants. Goals: make multi-layer LLM calls
easy, keep traditional compute first-class, and ship a minimal but strongly typed action
model.

## Core Shape (v0)

- TypeScript-only authoring; decks/cards default-export `defineDeck`/`defineCard` with
  optional `inputSchema`/`outputSchema` (Zod) in one file. Root may omit schemas (defaults
  to string); non-root decks must declare schemas (string = `z.string()`).
- Actions only: every action delegates to another deck by `path`; no inline handlers.
  Cards can contribute actions; merge by name with deck winning. Action params derive
  strictly from the child deck’s `inputSchema` (error if missing). Action result is the
  child deck’s `outputSchema`-validated payload.
- Single-level card embeds; cards can add prompt + actions (no schema fragments in v0).
- Compute + LLM decks share the same surface: if `modelParams.model` is absent (or
  `mode: "compute"`), run compute-only; otherwise use OpenAI/OpenRouter-style chat
  completion.
- Orchestration helpers: synthetic reference context injected to children (validated
  input + action doc), `ctx.spawnAndWait`, `ctx.return`, `ctx.fail`. Default guardrails
  hard-coded: depth=3, passes=3, timeout≈120s, no per-deck overrides in v0.
- Error handling: default bubble/stop. Error/presentation handlers land in v0.1 (see
  roadmap); no per-action catches in v0.
- Resolution: action paths are local/relative only; no remote/module resolution in v0.

## CLI + Packaging

- Minimal CLI:
  `gambit run <deck.ts> --input <json|string> [--model <id>] [--model-force <id>]`. No
  REPL/tracing in v0.
- OSS posture: Apache-2.0, README + quickstart, `examples/hello_world` showing a root deck
  that calls one child action.
- Deno tasks: `ci` runs `deno fmt --check`, `deno lint`, `deno test`; CI workflow calls
  `deno task ci`. Include `deno.json`/`deno.lock`.

## Deferred to v0.1

- Card schema fragments and deeper card-of-card embeds.
- Remote/URL/module resolution for actions.
- REPL/tracing/streaming ergonomics.
- Per-deck guardrail overrides; richer error taxonomies and branching.
- Inline tool handlers (if we ever want non-deck actions).

## Roadmap (lightweight)

### v0 (skeleton) sketch

- TS-only `defineDeck`/`defineCard`, actions-only delegation, schemas required for
  non-root (string via `z.string()`), compute+LLM decks, guardrails
  (depth/passes/timeout), synthetic context + spawn/return/fail, optional `onError`, local
  action paths only.
- Minimal CLI `gambit run`, Apache-2.0, `examples/hello_world`, Deno `ci` task + CI
  workflow, README/quickstart.

### v0.1 Errors (sketch)

- Config: optional `errorHandler` on `defineDeck` pointing to a handler deck.
- Flow: child deck fails → orchestrator calls `errorHandler` with a structured input →
  handler returns a presentation envelope → orchestrator injects it as a synthetic tool
  result into the parent’s convo. Parent decides whether to speak, ignore, or call
  `ctx.fail`/return a fallback; handler does not auto-resolve/bubble.
- Handler input:
  `{ kind: "error", activity, source: { deckPath, actionName }, error: { message, code?, details? }, childInput }`.
- Handler output: `ErrorEnvelope`
  `{ kind: "error", message, activity, source, error, payload?, meta? }` (payload is
  advisory; parent must opt in to use it).
- Defaults: if no handler, failure bubbles to ancestors. Compute/LLM decks share the same
  path.
- Tests: child failure shapes, handler invocation, synthetic tool injection, parent-driven
  paths (ignore vs speak vs fail), bubble when no handler.

### v0.2 Suspense (sketch)

- Config: `defineDeck` accepts `suspenseDelayMs` (default 500–1000 ms) and
  `suspenseHandler` pointing to a handler deck.
- Trigger: parent action still pending after delay.
- Handler input:
  `{ kind: "suspense", activity, source: { deckPath, actionName }, trigger: { reason: "timeout", elapsedMs }, childInput }`.
- Handler output: `SuspenseEnvelope`
  `{ kind: "suspense", message, activity, source, meta? }`.
- Orchestrator: injects envelope as synthetic tool result into parent convo; optional
  host/trace event. Handler only formats; parent decides to speak/ignore/fail. One-shot
  per action call. Bubble to nearest ancestor with a handler; higher ancestors see it only
  if re-surfaced.
- Defaults/behavior: deck-level delay only (no per-action overrides in v0.2); one-shot, no
  retriggers. If child completes before delay, no suspense fired. Guardrail timeouts
  (depth/pass/timeout) still apply; a timeout/fail flows through the error path/`onError`.
  Compute and LLM decks share the same suspense path.
- Envelope example (tool result payload, tool name TBD e.g. `gambit_suspense_event`):
  ```json
  {
    "kind": "suspense",
    "message": "Still checking, give me a few seconds...",
    "activity": "appointment_search",
    "source": { "deckPath": "./root.deck.ts", "actionName": "search" },
    "trigger": { "reason": "timeout", "elapsedMs": 900 },
    "meta": { "next_hint_ms": 0 }
  }
  ```

### v0.3 Ergonomics/Nesting (sketch)

- Card schema fragments; nested cards via explicit `embeds` on `defineCard`/`defineDeck`;
  flatten bodies/actions/fragments with cycle detection; deck wins conflicts; later embeds
  override earlier.
- Optional REPL/tracing; per-deck guardrail overrides; basic streaming; refined error
  taxonomy/messages.

### v0.4 Markdown (sketch)

- Markdown authoring parity with TS: deck/card files, embeds, actions, nesting with the
  same semantics and guardrails.
- Markdown embed syntax for cards/actions; same schema requirements (non-root must
  declare), same action→child schema derivation, local paths only.

## Terminology

- Deck: executable unit; can be LLM or compute-only; declares
  `inputSchema`/`outputSchema`, actions, optional `onError`.
- Card: reusable prompt fragment + actions; embeds into a deck; can declare
  `inputSchema`/`outputSchema` (for its own nesting stage in later versions).
- Action: always delegates to another deck by `path`; params derive from the child’s
  `inputSchema`; result is the child’s `outputSchema` payload.
- Embed: explicit card inclusion in a deck (and later cards embedding cards); flattened
  bodies/metadata; dedupe actions by name (deck wins; later embeds override earlier).
- Compute deck: no `modelParams.model` (or explicit `mode: "compute"`); runs code only.
- LLM deck: has `modelParams.model`; uses OpenAI/OpenRouter chat style.

## Tooling / Events Namespace (proposed)

- User-facing tools: only actions; tool names chosen by deck/card authors. Reserve
  `gambit.*` prefix.
- Synthetic seed: inject reference context to child decks as a tool call/result named
  `gambit.get_reference_context` at turn 0 (contains validated input + action doc). Not
  callable by the model.
- Error event (v0.1): synthetic tool result name `gambit.error_event` carrying
  `ErrorEnvelope` into the parent convo.
- Suspense event (v0.2): synthetic tool result name `gambit.suspense_event` carrying
  `SuspenseEnvelope` into the parent convo.
- IDs for tracing/correlation: include `runId`, `actionCallId`, and `parentActionCallId?`
  in synthetic payloads (reference context, error, suspense). Keep payloads small and
  structured; no transcript leakage.
- No other reserved tools exposed to the model; `ctx.return`/`ctx.fail` are helpers, not
  tools.

## Activity Naming (proposed)

- Keep short, snake_case semantic labels for `activity` (e.g., `appointment_search`,
  `profile_update`), matching tool-name friendly conventions.
- Default to action name if unspecified; allow explicit `activity` override on the action
  definition when needed.
- Root decks should set a sensible default `activity` for their domain; child decks can
  refine/override if more specific.

## Trace Events (host-facing, proposed minimal)

- Event kinds: `run.start`/`run.end`, `deck.start`/`deck.end` (per deck execution, with
  elapsed_ms), `action.start`/`action.end` (with outcome, elapsed_ms),
  `model.request`/`model.response` (truncated), `tool.call`/`tool.result` (actions only),
  `gambit.error_event`, `gambit.suspense_event`, `gambit.reference_context`.
- Common fields: `runId`, `actionCallId`, `parentActionCallId?`, `deckPath`, `actionName`,
  `activity`, `model?`, `elapsedMs?`, `ok`/`error` with `code`/`message`/`details?`.
- Redaction: no transcripts or secrets; keep payloads small; include hashes or lengths as
  needed for auditing.

## Execution Checklist (v0)

- Implement TS API: `defineDeck`/`defineCard` with actions-only delegation; schema
  requirements (root optional; non-root required), compute+LLM support, guardrails
  (depth/passes/timeout), synthetic context + spawn/return/fail, `onError`.
- Minimal CLI: `gambit run <deck.ts> --input --model/--model-force`.
- Example: `examples/hello_world` root deck calling one child action.
- OSS: Apache-2.0, README + quickstart, Deno tasks in `deno.json`, CI workflow running
  `deno task ci`.

## Testing Strategy (proposed)

- Deno-first: use `deno test` with a fake model provider (no network), deterministic
  seeds, and golden fixtures.
- Unit coverage:
  - Loader: schema enforcement (non-root required), action resolution, local path rules,
    compute vs LLM mode selection.
  - Orchestration: synthetic reference context injection, guardrails
    (depth/passes/timeout), spawn/return/fail behaviors.
  - Error handler (v0.1): child failure → handler invocation → synthetic
    `gambit.error_event` injection; parent reactions (ignore/speak/fail) and bubble when
    no handler.
  - Suspense (v0.2): pending action beyond delay → handler → synthetic
    `gambit.suspense_event`; no fire when child completes before delay.
  - Nesting (v0.3): embeds flatten/merge, cycle detection, action dedupe ordering, schema
    fragment merges.
- Golden runs: small example decks under `examples/hello_world` and a few multi-action
  scenarios with canned model outputs to assert orchestrator transcripts/outputs.
- CLI smoke: thin tests that run `gambit run` against fixtures with local model stub to
  ensure flags and I/O shapes stay stable.

### Versioned Testing Goals

- v0: loader + orchestration basics, guardrails, compute vs LLM selection, synthetic
  reference context, actions-only flow, CLI smoke, golden hello_world run.
- v0.1: error handler path (invoke handler, inject `gambit.error_event`, parent
  reactions), bubble when no handler, fail-fast when schemas missing for non-root.
- v0.2: suspense delay/trigger, handler invocation, inject `gambit.suspense_event`, no
  fire when child completes early, one-shot behavior.
- v0.3: embeds flatten/merge with cycle detection, action/tool dedupe ordering, schema
  fragment merges, REPL/tracing flag plumbing, per-deck guardrail overrides.
- v0.4: Markdown parsing/authoring parity; embeds/actions/nesting semantics match TS;
  golden runs for Markdown decks.

### Delivery Approach

- Hybrid: TDD the risky seams (loader, orchestration core, handler injection) with a fake
  model provider; then layer CLI and examples to keep momentum.
- Sequence per version:
  - v0: write tests first for loader/schema enforcement, reference context, guardrails,
    compute vs LLM, spawn/return/fail; add golden hello_world and CLI smoke with stub
    provider.
  - v0.1: add tests for error handler invocation/injection vs bubble.
  - v0.2: add tests for suspense trigger/injection vs no-fire when early completion.
  - v0.3: add tests for embeds/nesting/merge semantics and new flags
    (REPL/tracing/overrides).
  - v0.4: add parity tests for Markdown authoring vs TS behaviors.

## Open Questions / Decisions to Nail Down

- Schemas (resolved stance): non-root must declare `inputSchema`/`outputSchema` (string
  via `z.string()` allowed); root may omit. Compute-only decks still must declare; missing
  ⇒ load fail.
- Event naming/trace fields: finalize synthetic tool names for injected envelopes (e.g.,
  `gambit_error_event` / `gambit_suspense_event`), and whether handler inputs/envelopes
  include parent/child thread IDs or run IDs for tracing.
- Default model resolution: if LLM deck has no `modelParams.model` and no CLI override,
  fail fast. Compute decks without a model are fine. Any global default would be explicit
  (not implicit).
