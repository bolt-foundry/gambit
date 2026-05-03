# Runtime and guardrails

How Gambit runs native agent definitions and keeps behavior safe, observable,
and reproducible. The runtime still uses `deck` in exact file names, CLI
arguments, config fields, and API names.

## Guardrails and flow

- Defaults: `maxDepth=3`, `maxPasses=10`, `timeoutMs≈120s`; override per deck
  with `guardrails`.
- Compute vs LLM: an agent definition with `modelParams` runs as LLM; otherwise
  it must expose `run`/`execute` for compute.
- Non-root decks must declare both `contextSchema` and `responseSchema`; roots
  allow looser IO but should still use schemas.
- Child calls use `actionDecks` (LLM tool calls) or `spawnAndWait` in compute
  decks; names must avoid the `gambit_` prefix.
- Outputs are validated against `responseSchema`. Root defaults to string-ish
  output if no schema is present; non-root always validates.

## Synthetic tools and envelopes

- `gambit_context`: sent once when `--context` (formerly `--init`) is provided;
  payload is the raw input. Useful for assistant-first flows so the model can
  read input without a user turn. `gambit_init` remains as a deprecated alias.
- `gambit_respond` / `gambit_end`: removed from runtime defaults. Do not add
  `gambit://snippets/respond.md`, `gambit://snippets/end.md`, `respond: true`,
  or `allowEnd: true` in new decks. Return normal assistant output that matches
  `responseSchema`; model status/code/meta fields directly in that schema when
  needed.
- Child action results are returned through the action tool result payload.
  Handled errors use the same envelope shape:
  `{ runId, actionCallId, source, status?, payload?, message?, code?, meta? }`.

## State and turn order

- State files (`--state`) persist model messages; subsequent runs resume the
  same conversation. When resuming, `gambit_context` is skipped.
- `--message` sends a first user turn before the assistant responds; `--context`
  only seeds `gambit_context` (the deprecated `--init` alias behaves the same).
- Root decks can opt into string passthrough with `allowRootStringInput`
  (REPL/server use this so free-form text works).

## Handlers (busy/idle/error)

- Busy (`handlers.onBusy` or deprecated `onInterval`): fires after `delayMs`
  (default 800ms) from action start, optionally repeats with `repeatMs`.
  Receives
  `{ kind:"busy", source:{deckPath, actionName}, trigger:{reason:"timeout", elapsedMs}, childInput }`.
  Returned string/object is streamed/logged and injected as an assistant status
  message.
- Idle (`handlers.onIdle`): fires after `delayMs` of inactivity during a run,
  repeats if `repeatMs` is set. Input mirrors busy with `kind:"idle"` and no
  `childInput`.
- Error (`handlers.onError`): wraps child errors; should return
  `{ payload?, status?, message?, code?, meta? }` which becomes the structured
  action tool result envelope. If the handler itself fails, the runtime still
  returns a structured error envelope.
- Handler failures are swallowed so they never crash the main run.

## Streaming and tracing

- Streaming is supported for LLM agent definitions; callbacks are invoked per
  chunk and handler messages also stream.
- Tracing: `--verbose` prints trace events; `--trace <file>` writes JSONL.
  Useful events include `model.call/result`, `tool.call/result`, and handler
  triggers.
