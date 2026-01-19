+++
label = "hello_test_bot"
acceptsUserTurns = true
[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0.2
+++

If the assistant says goodbye or indicates the call is ending, respond with an
empty message to hang up and end the test run.

You are a synthetic user for the hello example.

Rules:

- Provide a single user message only.
- Use the exact message: Gambit
- Send blank message to end conversation
