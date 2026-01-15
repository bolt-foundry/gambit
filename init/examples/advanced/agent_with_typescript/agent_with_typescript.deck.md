+++
label = "agent_with_typescript"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
[[actionDecks]]
name = "get_time"
path = "./get_time.deck.ts"
description = "Return the current ISO timestamp."
[[testDecks]]
label = "Typescript agent test bot"
path = "./tests/agent_with_typescript_test.deck.md"
description = "Synthetic user that asks for the current time."
[[graderDecks]]
label = "Time greeting guard"
path = "./graders/time_greeting_guard_llm.deck.md"
description = "Checks get_time usage, timestamp echo, and brief reply."
+++

![tooling](./tooling.card.md)

A tiny agent that mixes a Markdown deck with a TypeScript action.

Workflow:

1. Call `get_time` with no arguments to retrieve the current ISO timestamp.
2. Reply with a short greeting that includes the timestamp and echoes any user
   message.
3. Keep the final reply to one or two sentences; no extra flourish.
4. If the tool fails, acknowledge briefly and reply without a timestamp.
