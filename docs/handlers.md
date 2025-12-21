# Handlers: error, busy, idle

Gambit decks can register optional handler decks to surface status or recover
from failures without blocking the main turn. They run as child decks with
structured inputs.

## Declaring handlers

```toml
++
[handlers.onError]
path = "./handlers/on_error.deck.md"

[handlers.onBusy]
path = "./handlers/on_busy.deck.md"
delayMs = 800      # optional; default 800ms
repeatMs = 1000    # optional; repeat while action is still running

[handlers.onIdle]
path = "./handlers/on_idle.deck.md"
delayMs = 1200     # optional; default 800ms
++
```

Notes:

- `onInterval` is a deprecated alias for `onBusy`; `intervalMs` is a deprecated
  alias for `repeatMs`.
- Handlers can live in TS or MD decks; paths are resolved relative to the
  declaring deck.
- Cards cannot declare handlers.

## Handler inputs

- **Busy** (mid-action updates):
  ```ts
  {
    kind: "busy",
    label?: string,
    source: { deckPath: string; actionName: string },
    trigger: { reason: "timeout"; elapsedMs: number },
    childInput?: Record<string, unknown>,
  }
  ```
  Fires after `delayMs` from action start; repeats every `repeatMs` if set.

- **Idle** (no activity during a run):
  ```ts
  {
    kind: "idle",
    label?: string,
    source: { deckPath: string },
    trigger: { reason: "idle_timeout"; elapsedMs: number },
  }
  ```
  Fires once after `delayMs` of inactivity (repeats if `repeatMs` is provided).

- **Error** (handled failures):
  ```ts
  {
    kind: "error",
    label?: string,
    source: { deckPath: string; actionName: string },
    error: { message: string },
    childInput?: Record<string, unknown>,
  }
  ```
  Return `{ message?, code?, status?, meta?, payload? }` to populate a
  `gambit_complete` envelope.

## Outputs and streaming

- Busy/idle handlers can return a string or object; the stringified message is
  streamed/logged and injected as an assistant message with elapsed ms appended.
- Handler errors are swallowed; they should never crash the run.
- The debug UI shows busy/idle streams in the “status” lane separate from
  assistant turns.

## Examples

- TS: `examples/handlers_ts/handlers/on_busy.ts`, `.../on_idle.ts`,
  `.../on_error.ts`
- MD: `examples/handlers_md/handlers/on_busy.deck.md`, `.../on_idle.deck.md`,
  `.../on_error.deck.md`
