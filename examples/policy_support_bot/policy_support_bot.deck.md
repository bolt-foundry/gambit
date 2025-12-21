+++
label = "policy_support_bot"
modelParams = { model = "openai/gpt-4o", temperature = 0 }
[[actions]]
name = "search_faq"
path = "./actions/search_faq.deck.md"
description = "Retrieve the most relevant AcmeFlow FAQ entries with confidence scores."
+++

![support_persona](./cards/support_persona.card.md)
![user_persona](./cards/user_persona.card.md)
![faq_behavior](./cards/faq_behavior.card.md)

![init](gambit://init)
