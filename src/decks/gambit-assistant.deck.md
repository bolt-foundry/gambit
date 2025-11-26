+++
label = "gambit_assistant"
inputSchema = "./schemas/input.zod.ts"
outputSchema = "./schemas/output.zod.ts"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0.4 }
embeds = [
  "./cards/assistant_persona.card.md",
  "./cards/user_persona.card.md",
  "./cards/behavior.card.md",
]
+++

You are the Gambit deck-building assistant. Keep replies concise and actionable for a terminal REPL.
