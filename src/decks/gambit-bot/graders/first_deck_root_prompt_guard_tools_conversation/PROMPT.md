+++
label = "First deck location guard (tools, conversation)"
description = "Conversation-level guard that checks whether the first created deck is root PROMPT.md."
contextSchema = "gambit://schemas/graders/contexts/conversation_tools.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"
execute = "./first_deck_root_prompt_guard_tools_conversation.deck.ts"
+++

Compute grader that enforces first deck location policy across the whole
conversation.
