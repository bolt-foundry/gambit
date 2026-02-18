+++
label = "billing_service"
contextSchema = "../schemas/service_request.zod.ts"
responseSchema = "../schemas/service_response.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actions]]
name = "billing_support"
path = "../actions/billing_support.deck.ts"
description = "Capture billing concerns and determine next steps."
+++

![billing_behavior](../cards/billing_behavior.card.md)

![respond](gambit://cards/respond.card.md)

1. Gather the invoice/statement reference, amount, and concern.
2. Call `billing_support` with the structured summary and patient context when
   available.
3. Explain the returned guidance in one or two sentences. If `escalate = true`,
   mention that the billing team will follow up.
4. Respond with `{ spokenResponse, followUp }`.
