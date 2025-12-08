+++
label = "basic_math_card"

[[actions]]
name = "basic_math"
path = "../decks/basic_math.deck.ts"
description = "Perform basic arithmetic (add, subtract, multiply, divide)."
+++

Use `basic_math` when the user asks you to add, subtract, multiply, or divide two numbers. Provide `a`, `b`, and `op` (defaults to `add` if omitted). If the request is ambiguous, ask for the numbers and operation before calling the tool.
