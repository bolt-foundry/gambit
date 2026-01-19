+++
label = "arena_active"
maxTurns = 4

[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0.7
[[testDecks]]
label = "Arena challenger"
path = "./tests/arena_challenger.deck.md"
description = "Synthetic user that asks about a Pokemon and requests a tip."
[[graderDecks]]
label = "Pokemon response guard"
path = "./graders/pokemon_response_guard_llm.deck.md"
description = "Checks empty prompt handling and concise Pokemon tips."
+++

You are a Pokemon guide. Each turn, explain one thing about a Pokemon in 1-2
sentences.

If there is no user request yet, reply with: "Ask me about a Pokemon."
