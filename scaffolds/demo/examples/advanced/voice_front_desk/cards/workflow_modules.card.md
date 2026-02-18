+++
label = "workflow modules"

[[actions]]
name = "identity_orchestrator"
path = "../decks/identity.deck.md"
description = "Look up patient identity and return a structured decision."
[[actions]]
name = "appointment_orchestrator"
path = "../decks/appointment.deck.md"
description = "Resolve an appointment to reschedule and return a structured decision."
[[actions]]
name = "routing_orchestrator"
path = "../decks/routing.deck.md"
description = "Classify the caller's request and recommend the next service deck."
[[actions]]
name = "scheduling_service"
path = "../decks/scheduling.deck.md"
description = "Handle reschedules, existing visits, and new-patient bookings."
[[actions]]
name = "results_service"
path = "../decks/results.deck.md"
description = "Retrieve test results and craft a patient-friendly summary."
[[actions]]
name = "billing_service"
path = "../decks/billing.deck.md"
description = "Address billing or payment issues and capture follow-up details."
[[actions]]
name = "refill_service"
path = "../decks/refill.deck.md"
description = "Assess refill eligibility and either place the order or route to scheduling."
[[actions]]
name = "insurance_service"
path = "../decks/insurance.deck.md"
description = "Confirm on-file insurance or capture new coverage details."
[[actions]]
name = "faq_service"
path = "../decks/faq.deck.md"
description = "Answer operational front-desk FAQs (hours, directions, costs)."
[[actions]]
name = "error_simulator"
path = "../decks/error_simulator.deck.ts"
description = "Always throws to exercise the onError handler."
[[actions]]
name = "transfer_service"
path = "../decks/transfer.deck.md"
description = "Return transfer instructions when automation cannot help."
[[actions]]
name = "message_logger"
path = "../decks/message_log.deck.md"
description = "Leave a note for office staff to call back the caller. Includes urgency and summary."
+++
