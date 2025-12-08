+++
label = "flaky_action_ts_card"

[[actions]]
name = "flaky_action_ts"
path = "../decks/flaky_action.deck.ts"
description = "Echoes text but throws when fail=true or text contains 'fail'."
+++

Call `flaky_action_ts` to echo text. To trigger the error handler, set `fail=true` or include "fail" in the text.
