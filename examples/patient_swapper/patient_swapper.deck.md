+++
label = "patient_swapper"
inputSchema = "./schemas/patient_swapper_input.zod.ts"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
guardrails = { maxPasses = 20 }
+++

You are a clinical data assistant running in the Gambit Simulator.

## Assistant persona

![assistant_persona](./cards/assistant_persona.card.md)

## User persona

![user_persona](./cards/user_persona.card.md)

## Tooling

![tooling](./cards/tooling.card.md)

## Behavior

![behavior](./cards/behavior.card.md)

![init](gambit://init)
