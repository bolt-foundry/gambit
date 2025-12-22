# Runtime and guardrails

How Gambit runs decks and keeps them safe/observable.

## Guardrails and flow

- Defaults: `maxDepth=3`, `maxPasses=10`, `timeoutMs≈120s`; override per deck
  with `guardrails`.
- Compute vs LLM: a deck with `modelParams` runs as LLM; otherwise it must
  expose `run`/`execute` for compute.
- Non-root decks must declare both `inputSchema` and `outputSchema`; roots allow
  looser IO but should still use schemas.
- Child calls use `actions` (LLM tool calls) or `spawnAndWait` in compute decks;
  names must avoid the `gambit_` prefix.
- Outputs are validated against `outputSchema`. Root defaults to string-ish
  output if no schema is present; non-root always validates.

## Synthetic tools and envelopes

- `gambit_init`: sent once when `--init` is provided; payload is the raw input.
  Useful for assistant-first flows so the model can read input without a user
  turn.
- `gambit_respond`: enable with `syntheticTools.respond=true` (or
  `gambit://respond` marker in Markdown). Required for LLM decks that should
  finish with a structured envelope
  `{ payload, status?, message?, code?, meta? }`.
- `gambit_complete`: emitted automatically for child completions and handled
  errors so the parent can see
  `{ runId, actionCallId, source, status?, payload?, message?, code?, meta? }`.

## State and turn order

- State files (`--state`) persist model messages; subsequent runs resume the
  same conversation. When resuming, `gambit_init` is skipped.
- `--message` sends a first user turn before the assistant responds; `--init`
  only seeds `gambit_init`.
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
  `{ payload?, status?, message?, code?, meta? }` which becomes a
  `gambit_complete` envelope. If the handler itself fails, the runtime still
  returns a structured error envelope.
- Handler failures are swallowed so they never crash the main run.

## Streaming and tracing

- Streaming is supported for LLM decks; callbacks are invoked per chunk and
  handler messages also stream.
- Tracing: `--verbose` prints trace events; `--trace <file>` writes JSONL.
  Useful events include `model.call/result`, `tool.call/result`, and handler
  triggers.
