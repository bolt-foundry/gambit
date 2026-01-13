+++
label = "grader_decks"
[[graderDecks]]
label = "Fact verifier (conversation)"
path = "../graders/fact_verifier_llm.deck.md"
description = "Fails if any assistant fact in the conversation lacks explicit tool-call proof."
[[graderDecks]]
label = "Fact verifier (turn)"
path = "../graders/fact_verifier_turn_llm.deck.md"
description = "Fails if the latest assistant message states a fact without explicit tool-call proof."
[[graderDecks]]
label = "Tone human-likeness"
path = "../graders/tone_human_likeness_llm.deck.md"
description = "Scores how human and natural the assistant tone feels."
[[graderDecks]]
label = "Tone human-likeness (turn)"
path = "../graders/tone_human_likeness_turn_llm.deck.md"
description = "Scores how human and natural the graded assistant message feels."
+++
