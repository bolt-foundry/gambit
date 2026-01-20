+++
label = "message_logger"
inputSchema = "../schemas/service_request.zod.ts"
outputSchema = "../schemas/service_response.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actionDecks]]
name = "log_message"
path = "../actions/log_message.deck.ts"
description = "Capture a voice-ready callback ticket with priority metadata."
+++

![respond](gambit://cards/respond.card.md)

Gather the summary, urgency, and audience for the callback ticket, then call
`log_message`. Confirm to the caller what will happen next and when to expect a
response. Respond with `{ spokenResponse, followUp }`.
