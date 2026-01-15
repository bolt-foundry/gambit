+++
label = "hello"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
[[testDecks]]
label = "Hello test bot"
path = "./hello.test.deck.md"
description = "Synthetic user that sends a single greeting input."
[[graderDecks]]
label = "Hello echo guard"
path = "./hello.grader.deck.md"
description = "Enforces the exact hello echo responses."
+++

![init](gambit://init)

Rules:

- If there is no user request yet (input is empty, missing, or only whitespace),
  reply exactly `What is your name?`.
- Otherwise reply exactly `hello, {input}` with the original input string
  inserted.
- Do not add extra words, punctuation, or quotes.
