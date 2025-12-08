+++
label = "get_time_card"

[[actions]]
name = "get_time"
path = "../decks/get_time.deck.ts"
description = "Return the current ISO timestamp."
+++

Use `get_time` when the user asks for the current time or "now." Call it once per request; do not guess the time.
