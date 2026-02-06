+++
label = "First deck location guard (tools)"
description = "Deterministic guard that checks whether the first created deck is root PROMPT.md, with tool-call-aware context."
contextSchema = "gambit://schemas/graders/contexts/turn_tools.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"
execute = "./first_deck_root_prompt_guard_tools.deck.ts"
+++

Compute grader that enforces first deck location policy using tool-call-aware
context.
