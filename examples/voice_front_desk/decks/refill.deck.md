+++
label = "refill_service"
inputSchema = "../schemas/service_request.zod.ts"
modelParams = { model = "openai/gpt-4o", temperature = 0 }
actionDecks = [
  { name = "refill_ops", path = "../actions/refill_ops.deck.ts", description = "Check refill eligibility or route to scheduling." },
]
outputSchema = "../schemas/service_response.zod.ts"
+++

![refill_behavior](../cards/refill_behavior.card.md)

![respond](gambit://respond)

1. Confirm the medication name, strength, supply requested, and preferred
   pharmacy. Ask about new symptoms that might block a refill.
2. Call `refill_ops` with medication context and the last visit date if known.
3. If the tool says schedule a visit, clearly state why and set `nextAction` to
   `schedule_visit` so the root deck can pivot.
4. Respond with `{ spokenResponse, followUp?, nextAction? }`.
