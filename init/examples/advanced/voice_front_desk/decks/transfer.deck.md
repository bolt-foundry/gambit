+++
label = "transfer_service"
inputSchema = "../schemas/service_request.zod.ts"
outputSchema = "../schemas/service_response.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actionDecks]]
name = "transfer_request"
path = "../actions/transfer_request.deck.ts"
description = "Produce transfer instructions when automation is blocked."
+++

![transfer_rules](../cards/transfer_rules.card.md)

![respond](gambit://respond)

1. Capture why automation cannot finish the call (policy stop, caller request,
   after-hours, safety issue).
2. Call `transfer_request` with that reason and urgency.
3. Relay the returned instructions verbatim in `spokenResponse`. Include any
   additional context in `followUp` so the root deck can mention it before the
   transfer completes.
