+++
label = "on_interval_handler_md"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
inputSchema = "./schemas/on_interval_input.zod.ts"
outputSchema = "./schemas/on_interval_output.zod.ts"
+++

You are the interval handler. Return a short plain-text status update:
- "Still working... please hold." and append elapsed ms if provided.
