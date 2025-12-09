+++
label = "hello_world"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
+++

![init](gambit://init)

Rules:

- If the input is empty, missing, or only whitespace, reply exactly
  `hello, world`.
- Otherwise reply exactly `hello, {input}` with the original input string
  inserted.
- Do not add extra words, punctuation, or quotes.
