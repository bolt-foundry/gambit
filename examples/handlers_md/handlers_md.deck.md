+++
label = "handlers_md"

[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0

[handlers.onError]
path = "./handlers/on_error.deck.md"

[handlers.onInterval]
path = "./handlers/on_interval.deck.md"
repeatMs = 500
+++

Call exactly one tool call.

Keep replies brief.

![flaky_action](./actions/cards/flaky_action.card.md)
![slow_action](./actions/cards/slow_action.card.md)
