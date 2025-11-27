+++
inputSchema = "./schemas/input.zod.ts"
outputSchema = "./schemas/output.zod.ts"
modelParams = { model = "openai/gpt-4o-mini" }

actions = [
  { name = "echo_md", path = "./echo.deck.md", description = "echo input" },
]
+++

You are a concise assistant. Call `echo_md` to echo the user input and return
the final answer.
