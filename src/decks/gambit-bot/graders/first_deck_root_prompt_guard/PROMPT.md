+++
label = "First deck location guard (turn)"
description = "Deterministic guard that checks whether the first created deck is root PROMPT.md."
contextSchema = "gambit://schemas/graders/contexts/turn_tools.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"
execute = "./first_deck_root_prompt_guard.deck.ts"
+++

Compute grader that enforces first deck location policy.
