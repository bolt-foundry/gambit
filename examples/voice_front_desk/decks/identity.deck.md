+++
label = "identity_orchestrator"
inputSchema = "../schemas/identity_input.zod.ts"
outputSchema = "../schemas/identity_output.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0

[guardrails]
maxPasses = 10
[[actionDecks]]
name = "patient_lookup"
path = "../actions/patient_lookup.deck.ts"
description = "Resolve an existing patient record once name + DOB are confirmed."
[[actionDecks]]
name = "acquire_new_patient"
path = "../actions/acquire_new_patient.deck.ts"
description = "Create a starter chart for brand-new patients."
+++

![identity_behaviors](../cards/identity_behaviors.card.md)

![respond](gambit://respond)

Instructions:

1. Collect the caller's first and last name plus date of birth as separate,
   short turns. Confirm the best callback number; restate the provided value so
   the caller can correct it.
2. Call `patient_lookup` once name + DOB are confirmed. If it succeeds, capture
   the returned `patientId` and note that the patient is on file.
3. When lookup fails twice, gather contact and insurance basics, then call
   `acquire_new_patient` once. Treat the returned `patientId` as the chart ID
   and set `newPatient = true`.
4. Always narrate what you are doing ("Let me pull up your chart") before
   calling a tool. Keep narration short.
5. When you are confident you have caller name, DOB, callback number, patient ID
   (if any), and insurance status, call `gambit_respond` with an object that
   matches the output schema.
6. If the caller refuses to share required info, respond with
   `newPatient = false`, omit `patientId`, and set `summary` to the refusal.
