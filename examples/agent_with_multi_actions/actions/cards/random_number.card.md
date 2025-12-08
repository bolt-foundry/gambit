+++
label = "random_number_card"

[[actions]]
name = "random_number"
path = "../decks/random_number.deck.ts"
description = "Generate a random integer (optionally bounded)."
+++

Call `random_number` when the user asks for a random number. Honor provided `min`/`max` when present (default 0 inclusive to 100 exclusive). If bounds are unclear or invalid, ask for clarification before calling.
