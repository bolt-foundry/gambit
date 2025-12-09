+++
label = "slow_action_ts_card"

[[actions]]
name = "slow_action_ts"
path = "../decks/slow_action.deck.ts"
description = "Echoes text after an artificial delay (triggers onInterval)."
+++

Call `slow_action_ts` to see TS interval handler updates while it works. Control
delay with `delayMs` (default 2000ms, max 120000ms). When the user asks for a
wait (e.g., "10 seconds"), set `delayMs` to match (10s -> 10000ms) and leave it
unless they ask for more than the max (cap at 120000ms).
