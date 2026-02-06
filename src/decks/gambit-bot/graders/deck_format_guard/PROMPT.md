+++
label = "Deck format guard (turn)"
description = "Deterministic guard that checks bot_write payloads for Deck Format v1.0 compliance."
contextSchema = "gambit://schemas/graders/contexts/turn.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"
execute = "./deck_format_guard.deck.ts"
+++

Compute grader for Deck Format v1.0 guardrails.
