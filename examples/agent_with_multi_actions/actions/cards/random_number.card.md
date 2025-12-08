+++
label = "random_number_card"

[[actions]]
name = "random_number"
path = "../decks/random_number.deck.ts"
description = "Generate a random integer (optionally bounded)."
+++

Use `random_number` when the user asks for a random number. Honor provided `min`/`max` when present; otherwise default to 0 (inclusive) and 100 (exclusive). Do not call if bounds are nonsensical—ask for clarification instead.
