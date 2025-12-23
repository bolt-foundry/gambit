+++
label = "cold_emailer"
inputSchema = "./schemas/cold_emailer_input.zod.ts"
guardrails = { maxPasses = 200 }
maxTurns = 4
input = {
  name = "Ava",
  details = "CTO at a fintech startup focused on infrastructure cost control.",
  sender = "Riley",
  products = ["Cost monitoring"],
  voiceOptions = [
    "founder-to-founder",
    "casual concise",
    "technical direct",
    "warm consultative",
  ],
}

[[testDecks]]
label = "Buyer feedback QA"
path = "./tests/buyer_feedback.deck.md"
description = "Synthetic buyer persona that critiques drafts and requests revisions."
[modelParams]
model = "openai/gpt-4o"
temperature = 0.3
+++

You write concise, professional cold outreach emails.

## Assistant persona

![assistant_persona](./cards/assistant_persona.card.md)

## User persona

![user_persona](./cards/user_persona.card.md)
![research_recipient](./cards/research_recipient.card.md)
![voice_critic](./cards/voice_critic.card.md)
![log_revision_plan](./cards/log_revision_plan.card.md)
![send_email](./cards/send_email.card.md)

![behavior](./cards/behavior.card.md)

![init](gambit://init)
