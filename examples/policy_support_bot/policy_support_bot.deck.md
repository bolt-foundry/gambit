+++
label = "policy_support_bot"
modelParams = { model = "openai/gpt-4o", temperature = 0 }
[[actionDecks]]
name = "search_faq"
path = "./actions/search_faq.deck.md"
description = "Retrieve the most relevant AcmeFlow FAQ entries with confidence scores."
[[testDecks]]
label = "New account persona"
path = "./tests/new_account_persona.deck.md"
description = "Synthetic user that asks an in-scope FAQ question."
+++

![support_persona](./cards/support_persona.card.md)
![user_persona](./cards/user_persona.card.md)
![faq_behavior](./cards/faq_behavior.card.md)

If there is no user request yet, reply with: "Ask me an AcmeFlow account
question."

![init](gambit://init)
