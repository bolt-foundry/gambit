+++
label = "Bolty Bot"
inputSchema = "../schemas/voice_call_input.zod.ts"
[modelParams]
model = "openai/gpt-4o"
temperature = 0.2

[guardrails]
maxPasses = 10
[handlers.onError]
path = "../handlers/on_error.deck.md"
[[testDecks]]
label = "Privacy sensitive patient"
path = "../tests/privacy_sensitive_patient.deck.md"
description = "Persona deck that plays a privacy-sensitive new patient calling to schedule and probes identity coverage without extra objectives."
[[testDecks]]
label = "FAQ-first caller"
path = "../tests/faq_first_caller.deck.md"
description = "Persona deck that asks common clinic FAQ questions before sharing scheduling details."
[[testDecks]]
label = "New patient intake"
path = "../tests/new_patient_intake.deck.md"
description = "Persona deck that provides identity details when asked and attempts to schedule a first visit."
[[testDecks]]
label = "Existing patient lookup"
path = "../tests/existing_patient_lookup.deck.md"
description = "Persona deck that confirms identity for an existing patient."
[[testDecks]]
label = "Scheduling (existing patient)"
path = "../tests/scheduling_existing_patient.deck.md"
description = "Persona deck that books a follow-up visit for an existing patient."
[[testDecks]]
label = "Scheduling (reschedule)"
path = "../tests/scheduling_reschedule.deck.md"
description = "Persona deck that reschedules an existing appointment."
[[testDecks]]
label = "Results inquiry"
path = "../tests/results_inquiry.deck.md"
description = "Persona deck that asks about recent test results."
[[testDecks]]
label = "Billing question"
path = "../tests/billing_question.deck.md"
description = "Persona deck that asks about a billing charge."
[[testDecks]]
label = "Refill request"
path = "../tests/refill_request.deck.md"
description = "Persona deck that requests a medication refill."
[[testDecks]]
label = "Insurance check"
path = "../tests/insurance_check.deck.md"
description = "Persona deck that asks about insurance coverage."
[[testDecks]]
label = "Transfer escalation"
path = "../tests/transfer_escalation.deck.md"
description = "Persona deck that triggers escalation to a human."
[[testDecks]]
label = "Error handler trigger"
path = "../tests/error_handler_trigger.deck.md"
description = "Persona deck that asks for the error simulator to exercise onError handling."
[[graderDecks]]
label = "Fact verifier (conversation)"
path = "../graders/fact_verifier_llm.deck.md"
description = "Fails if any assistant fact in the conversation lacks explicit tool-call proof."
[[graderDecks]]
label = "Fact verifier (turn)"
path = "../graders/fact_verifier_turn_llm.deck.md"
description = "Fails if the latest assistant message states a fact without explicit tool-call proof."
[[graderDecks]]
label = "Tone human-likeness"
path = "../graders/tone_human_likeness_llm.deck.md"
description = "Scores how human and natural the assistant tone feels."
[[graderDecks]]
label = "Tone human-likeness (turn)"
path = "../graders/tone_human_likeness_turn_llm.deck.md"
description = "Scores how human and natural the graded assistant message feels."
[[graderDecks]]
label = "Booking confirmation guard"
path = "../graders/booking_confirmation_guard_llm.deck.md"
description = "Flags booking claims without explicit tool-call confirmation."
+++

You are the voice assistant for Bolty Bot, an AI which helps medical practices
manage their front office work. You'll be interacting with patients who are
calling the clinic.

All information that you provide (facts, hours, services) need to be backed up
by information from a tool call. It's very important that you never provide
information that isn't backed by a tool call. If you don't have an appropriate
tool call, politely state you don't have available information, and that you can
set up a callback.

## Persona + tone

![assistant_persona](../cards/assistant_persona.card.md)
![user_persona](../cards/user_persona.card.md)
![voice_style](../cards/voice_style.card.md)
![human_response_guidelines](../cards/human_response_guidelines.card.md)

## Call playbook

![call_playbook](../cards/call_playbook.card.md)

## Workflow modules

![workflow_modules](../cards/workflow_modules.card.md)

## Init workflow

![init](gambit://init)
