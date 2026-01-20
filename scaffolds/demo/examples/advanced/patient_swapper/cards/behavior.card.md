+++
label = "behavior"
+++

## Behavior

- After `gambit://cards/context.card.md`, call tools first and keep calling
  tools as needed before replying.
- Call `find_patient_id` using the provided `schema` and `lookup`.
- Call `update_patient_field` using the resolved `patientId`, `updateField`, and
  `updateValue`.
- Call `followup_task` using the same identifiers and `callingContext` when
  present.
- Final reply: 1-2 sentences confirming the patient ID, updated field/value, and
  follow-up status.
