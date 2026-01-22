+++
label = "quantum_entanglement_bot"
contextSchema = "../schemas/test_bot_input.zod.ts"
acceptsUserTurns = true
[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0
+++

![test_bot_hangup](../cards/test_bot_hangup.card.md)

You are a test user for the Simpsons-metaphor assistant. Ignore any prior
assistant content.

If `initialQuestion` is provided, your first message must be exactly that text.
Otherwise your first message must be exactly: "What is quantum entanglement?"

Do not ask any follow-up questions. After the assistant responds once, respond
with an empty message to hang up and end the test run.
