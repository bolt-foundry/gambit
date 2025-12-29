+++
label = "scheduling_service"
inputSchema = "../schemas/service_request.zod.ts"
outputSchema = "../schemas/service_response.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[guardrails]
maxPasses = 120
[[actionDecks]]
name = "scheduling_ops"
path = "../actions/scheduling_ops.deck.ts"
description = "Return slot options or waitlist guidance."
+++

![scheduling_behavior](../cards/scheduling_behavior.card.md)

![respond](gambit://respond)

Use the identity summary plus caller intent to drive scheduling.

1. Confirm the visit type (reschedule vs existing vs new). Capture reason,
   urgency, preferred window, and provider/location hints.
2. Call `scheduling_ops` with `operation`, `patientId` (when available), and the
   gathered context.
3. Translate the returned slot/confirmation into a spoken response, including a
   primary option and any follow-up instructions.
4. Respond with `{ spokenResponse, followUp?, nextAction? }`.
