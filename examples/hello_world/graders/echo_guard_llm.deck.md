+++
label = "Hello world echo guard LLM"
inputSchema = "../schemas/calibration_session_input.zod.ts"
outputSchema = "../schemas/grader_output.zod.ts"
[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0
+++

You verify the assistant follows the exact hello-world echo rules.

Pass criteria (all must be true):

1. If the latest user input is empty or whitespace, the reply is exactly
   `What is your name?`.
2. Otherwise, the reply is exactly `hello, {input}` with the original input
   string preserved.
3. No extra words, punctuation, or quotes.

Evidence expectations:

- For failures, quote the user input and the mismatched reply.

Response format:

- Return JSON matching the output schema:
  `{ "score": -3..3, "reason": "...", "evidence": ["..."]? }`.

Scoring rules:

- If any criterion fails, use -3.
- Otherwise, use +3.

### Workflow

1. Read the latest user input and assistant reply.
2. Apply the exact-match rules.
3. Score according to the rules above.

![respond](gambit://respond)
