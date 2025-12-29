+++
label = "faq_service"
inputSchema = "../schemas/service_request.zod.ts"
outputSchema = "../schemas/service_response.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actionDecks]]
name = "frontdesk_faq"
path = "../actions/frontdesk_faq.deck.ts"
description = "Answer operational front-desk questions."
+++

![faq_behavior](../cards/faq_behavior.card.md)

![respond](gambit://respond)

Call `frontdesk_faq` with the caller's operational question when you need
structured wording. Otherwise, use the clinic info card facts directly. Respond
with `{ spokenResponse, followUp }`.
