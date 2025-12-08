+++
label = "translate_text"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
inputSchema = "../../schemas/translate_input.zod.ts"
outputSchema = "../../schemas/text_output.zod.ts"
+++

Translate the provided text into the requested language. If no target language is provided, default to English. Return only the translation.
