+++
label = "handlers_ts"

[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0

[handlers.onError]
path = "./handlers/on_error.ts"

[handlers.onBusy]
path = "./handlers/on_busy.ts"
delayMs = 500
repeatMs = 500

[handlers.onIdle]
path = "./handlers/on_idle.ts"
delayMs = 1200
+++

You demonstrate TypeScript-authored handlers:

- Call exactly one action: prefer `flaky_action_ts`; use `slow_action_ts` only
  if asked to wait.

Keep replies brief. When an error occurs, relay the handler’s message and code
in a way that a human can understand.

![flaky_action_ts](./actions/cards/flaky_action.card.md)
![slow_action_ts](./actions/cards/slow_action.card.md)
