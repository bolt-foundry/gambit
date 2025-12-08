+++
label = "flaky_action_card"

[[actions]]
name = "flaky_action"
path = "../decks/flaky_action.deck.ts"
description = "Echoes text but throws when fail=true or text contains 'fail'."
+++

Call `flaky_action` to echo text. To trigger the error handler, set `fail=true` or include "fail" in the text.
