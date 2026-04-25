# AAR: Codex Raw Response Items

## Scope

- Added raw Responses item support to the Codex app-server provider path in
  `packages/gambit`.
- Preserved BFDesktop's existing fallback transcript rendering by ensuring
  built-in non-message/non-reasoning response items now flow through
  `response.output_item.*`.

## Governing context

- `packages/gambit` does not currently have a package-local `INTENT.md`.
- BFDesktop's active app intent in `apps/bfdesktop/INTENT.md` still applies to
  the desktop-facing symptom: this fix stays on the Gambit runtime side of the
  boundary and does not move runtime ownership into BFDesktop.
- README checklist review:
  - `packages/gambit/README.md`: no checklist items
  - `packages/gambit/packages/gambit-core/README.md`: no checklist items
  - `apps/bfdesktop/README.md`: no checklist items
  - Result: no README checkbox work was applicable for this task.

## What changed

- Expanded Gambit core `ResponseItem` support to include the upstream Codex raw
  built-in item types such as `web_search_call`, `local_shell_call`,
  `tool_search_call`, `image_generation_call`, `ghost_snapshot`, `compaction`,
  and `other`.
- Updated Gambit core validators/loaders to treat those item types as core
  response items instead of undeclared extension items.
- Changed the Codex app-server thread-start request to set
  `experimentalRawEvents: true` for new threads.
- Added Codex provider handling for the real upstream app-server notification
  method `rawResponseItem/completed`.
- Projected raw built-in non-message/non-reasoning items into
  `response.output_item.added` / `response.output_item.done` without inventing a
  separate translation contract.
- Included captured raw response items in final Responses output while skipping
  duplicate terminal stream replays.
- Tightened the Codex provider stream adapters so they no longer rely on
  `as unknown as` casts for Responses/trace callbacks.
- Aligned Gambit core `ResponseEvent` with the event metadata already emitted by
  providers by preserving `toolKind` on `tool.call` / `tool.result` and
  explicitly modeling the `codex.event` passthrough event.
- Preserved stream/final output ordering by deriving the final Responses
  `output` array and fallback assistant text indexes from the same raw-item and
  assistant-item index maps used during streaming.
- Updated the Gambit simulator OpenResponses serializer so non-message,
  non-function, non-reasoning response items are emitted from a generic JSON
  record fallback rather than assuming every remaining item is an extension item
  with `id` and `data` fields.

## Verification

- `deno test -A packages/gambit/src/providers/codex.test.ts`
  - Passed: `53 passed, 0 failed`
  - Includes an integrated fake app-server case that asserts:
    - `thread/start` includes `"experimentalRawEvents": true`
    - the upstream notification method `rawResponseItem/completed` is accepted
    - a `web_search_call` survives into streamed and final Responses output
    - the terminal `web_search_call` output item is not duplicated
    - raw items that stream before assistant output keep the same `output_index`
      ordering in fallback text events and final response output
- `deno test -A packages/gambit/packages/gambit-core/src/runtime.test.ts`
  - Passed: `122 passed, 0 failed`
  - Validates that widening the core `ResponseItem` set did not break runtime
    response-item validation or responses-mode execution.
- `deno test -A apps/bfdesktop/sidecar/graphql/desktopThreadTranscript_test.ts`
  - Passed: `7 passed, 0 failed`
  - Confirms the existing BFDesktop fallback projector still renders unknown
    output items through the tool transcript UI.
- `deno lint packages/gambit/src/providers/codex.ts packages/gambit/packages/gambit-core/src/types.ts`
  - Passed: `Checked 2 files`
  - Confirms the Codex provider and core event type updates satisfy the
    `gambit/no-unexplained-as-unknown` rule without reintroducing adapter casts.
- `deno check --quiet packages/gambit/packages/gambit-simulator/src/server_openresponses.ts`
  - Passed
  - Confirms the simulator OpenResponses endpoint accepts the widened
    `ResponseItem` union without assuming extension-item-only fields.

## Outcome

- New Codex app-server threads can now emit built-in raw Responses items through
  Gambit without being dropped.
- BFDesktop should now receive `web_search_call` and related raw built-in items
  through the normal transcript event path and render them with the existing
  tool fallback UI.
