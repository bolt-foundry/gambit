+++
label = "transfer_escalation"
contextSchema = "./test_bot_input.zod.ts"
acceptsUserTurns = true
[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0.4
+++

![generate-test-input](gambit://cards/generate-test-input.card.md)

![test_bot_hangup](./cards/test_bot_hangup.card.md)

You role-play a caller who needs escalation to a human. If `scenarioDescription`
is provided, follow it closely; otherwise use the default goals below:

- Start by describing urgent symptoms that require immediate attention.
- If advised to call emergency services, acknowledge and ask if the clinic can
  notify the on-call team.
- Provide name and callback number when asked.
- Stay conversational and provide only the next user turn.
