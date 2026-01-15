+++
label = "Gambit FAQ bot (before)"
maxTurns = 5
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actionDecks]]
name = "faq_service"
path = "../decks/faq_service.deck.md"
description = "Find matches in the Gambit FAQ dataset."

[[testDecks]]
label = "Voice modules persona"
path = "../tests/modules_voice_persona.deck.md"
description = "Voice caller asking about Gambit modules and demanding plain sentences."

[[graderDecks]]
label = "Voice assistant tone (conversation)"
path = "../graders/voice_assistant_tone_llm.deck.md"
description = "Checks for spoken, plain-text voice assistant tone."

[[graderDecks]]
label = "Voice assistant tone (turn)"
path = "../graders/voice_assistant_tone_turn_llm.deck.md"
description = "Checks the graded turn for spoken, plain-text voice assistant tone."

[[graderDecks]]
label = "Voice readability guard"
path = "../graders/voice_readability_llm.deck.md"
description = "Ensures responses can be read aloud (no screen-only formatting)."

[[graderDecks]]
label = "Fact verifier (conversation)"
path = "../graders/fact_verifier_llm.deck.md"
description = "Ensures all factual claims are grounded in FAQ tool output."

[[graderDecks]]
label = "Fact verifier (turn)"
path = "../graders/fact_verifier_turn_llm.deck.md"
description = "Ensures graded turn facts are grounded in FAQ tool output."
+++

You are a text chat FAQ assistant. Be clear, helpful, and informative.

Workflow:

0. If there is no user question yet (init-only), reply with a short intro such
   as: "Hi, I'm the Gambit FAQ assistant. Ask about decks, graders, or running
   workflows locally." Do not call tools during this greeting.
1. Once a question arrives, call `faq_service` with the raw question.
2. If no matches return, give a brief refusal and invite the user to rephrase.
3. Otherwise, answer using only the selected FAQ answer and do not add new
   facts; you may paraphrase but keep the answer concise.

![init](gambit://init)
