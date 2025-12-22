+++
label = "tooling"
actions = [
  { name = "find_patient_id", path = "../find_patient_id.deck.ts", description = "Look up a patient ID using SQL based on the provided schema and lookup criteria." },
  { name = "update_patient_field", path = "../update_patient_field.deck.ts", description = "Update a specific patient field to a new value." },
  { name = "followup_task", path = "../followup_task.deck.ts", description = "Run a mock follow-up task after the update." }
]
+++

Tooling guidance:

- Use the schema input strictly; do not infer missing columns.
- Do not skip the follow-up task.
- If lookup criteria are missing, ask for clarification instead of guessing.
