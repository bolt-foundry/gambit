+++
label = "results_service"
inputSchema = "../schemas/service_request.zod.ts"
outputSchema = "../schemas/service_response.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[[actionDecks]]
name = "results_lookup"
path = "../actions/results_lookup.deck.ts"
description = "Summarize available test results and follow-up instructions."
+++

![results_behavior](../cards/results_behavior.card.md)

![respond](gambit://cards/respond.card.md)

1. Confirm which test or result timeframe the caller is referencing.
2. Call `results_lookup` with the patient context and requested test name.
3. Turn the returned summary/follow-up into a clear spoken response that
   reiterates any next steps.
4. Respond with `{ spokenResponse, followUp }`.
