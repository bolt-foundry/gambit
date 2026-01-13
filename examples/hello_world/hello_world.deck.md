+++
label = "hello_world"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
[[testDecks]]
label = "Hello World test bot"
path = "./tests/hello_world_test.deck.md"
description = "Synthetic user that sends a single greeting input."
+++

![init](gambit://init)

Rules:

- If there is no user request yet (input is empty, missing, or only whitespace),
  reply exactly `What is your name?`.
- Otherwise reply exactly `hello, {input}` with the original input string
  inserted.
- Do not add extra words, punctuation, or quotes.
