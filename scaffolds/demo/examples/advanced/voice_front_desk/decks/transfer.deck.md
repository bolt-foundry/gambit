+++
label = "transfer_service"
contextSchema = "../schemas/service_request.zod.ts"
responseSchema = "../schemas/service_response.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actions]]
name = "transfer_request"
path = "../actions/transfer_request.deck.ts"
description = "Produce transfer instructions when automation is blocked."
+++

![transfer_rules](../cards/transfer_rules.card.md)

![respond](gambit://snippets/respond.md)

1. Capture why automation cannot finish the call (policy stop, caller request,
   after-hours, safety issue).
2. Call `transfer_request` with that reason and urgency.
3. Relay the returned instructions verbatim in `spokenResponse`. Include any
   additional context in `followUp` so the root deck can mention it before the
   transfer completes.
