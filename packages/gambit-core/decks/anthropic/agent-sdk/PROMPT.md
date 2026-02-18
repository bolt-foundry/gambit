+++
label = "Anthropic agent SDK bridge"
contextSchema = "gambit://schemas/scenarios/plain_chat_input_optional.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"
+++

This stdlib deck provides the default bridge between the Anthropic agent SDK
runtime and Gambit decks. It is intentionally minimal; downstream runners supply
the actual runtime behavior.
