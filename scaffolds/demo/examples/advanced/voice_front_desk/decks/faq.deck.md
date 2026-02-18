+++
label = "faq_service"
contextSchema = "../schemas/service_request.zod.ts"
responseSchema = "../schemas/faq_context_output.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actions]]
name = "frontdesk_faq"
path = "../actions/frontdesk_faq.deck.ts"
description = "Fetch raw clinic FAQ content."
+++

![faq_behavior](../cards/faq_behavior.card.md)

Call `frontdesk_faq` with the caller's operational question when you need
specific clinic facts (services, hours, address, pricing). The tool returns raw
clinic-authored content. Extract the most relevant facts and return them as
structured context. Do not invent clinic details. If nothing matches, return an
empty facts list and a suggested follow-up.

Respond with JSON:

```
{ "facts": string[], "suggestedFollowUp"?: string }
```

![respond](gambit://snippets/respond.md)
