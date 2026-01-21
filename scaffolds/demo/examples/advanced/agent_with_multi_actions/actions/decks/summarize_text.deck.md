+++
label = "summarize_text"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
contextSchema = "../../schemas/summarize_input.zod.ts"
responseSchema = "../../schemas/text_output.zod.ts"
+++

Summarize the provided text into one concise sentence. Return only the summary
without extra commentary.
