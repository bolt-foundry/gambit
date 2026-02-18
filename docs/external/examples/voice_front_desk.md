# Example: voice_front_desk

What it shows

- A modular voice receptionist that mirrors a patient call tree: identity,
  routing, and specialized task decks.
- Persona/behavior snippets that encode the architecture (identity behaviors,
  routing, scheduling/refill/insurance/billing guidance).
- Deterministic TypeScript actions for each flow (patient lookup, new-patient
  capture, scheduling, results, billing, refills, insurance, FAQs, transfers,
  and callback logging).
- Passing along minimal IVR metadata (call origin number, caller number, and a
  `currentDate` string that defaults to `new Date().toISOString().slice(0,10)`
  at deck load) through a schema so Debug UI or CLI runs can preload phone
  context.

Key files

- `init/examples/advanced/voice_front_desk/decks/root.deck.md` —
  greeter/orchestrator deck that calls the identity and routing decks.
- `init/examples/advanced/voice_front_desk/decks/*.deck.md` — modular decks for
  identity, routing, scheduling, results, billing, refills, insurance, FAQs,
  transfers, and callback logging.
- `init/examples/advanced/voice_front_desk/cards/*.card.md` — persona, identity,
  routing, and per-flow behavior snippets that each deck imports as needed.
- `init/examples/advanced/voice_front_desk/actions/*.deck.ts` — deterministic
  TypeScript compute decks for patient lookup, new-patient capture,
  scheduling_ops, results_lookup, billing_support, refill_ops, insurance_check,
  frontdesk_faq, transfer_request, and log_message.
- `init/examples/advanced/voice_front_desk/schemas/*.zod.ts` — init schema plus
  identity, routing, and service-response schemas that keep tool calls typed.
- `init/examples/advanced/voice_front_desk/sample_input.json` — sample call
  metadata for quick CLI runs.

Why it’s structured this way

- The modular voice architecture keeps the persona focused on the live caller
  while dedicated decks handle structured work such as lookup, scheduling,
  refills, or insurance.
- Behavior snippets keep identity gathering, routing, and per-flow questions
  separate, so you can edit the call tree without touching the deck body.
- Deterministic actions make it easy to test scenarios locally; each tool
  exposes a narrow schema with predictable outputs that the assistant can read
  back in plain speech.
- The init schema stays intentionally tiny—just origin number, caller number,
  and a runtime-defaulted `currentDate` string—so the deck behaves like a real
  phone bridge where other context may be missing.

How to run

- `deno run -A src/cli.ts run init/examples/advanced/voice_front_desk/decks/root.deck.md --context "$(cat init/examples/advanced/voice_front_desk/sample_input.json)" --message '"Hi, this is Nina. I need to move my physical."' --stream`

Try this input

- `--context '{"callOriginNumber":"415-555-0198","callerNumber":"415-555-1010","currentDate":"2025-12-23"}' --message '"I hurt my knee over the weekend and need to see someone fast"'`
