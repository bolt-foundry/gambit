+++
label = "Identity capture completeness"
inputSchema = "../schemas/calibration_session_input.zod.ts"
[modelParams]
model = "openai/gpt-4o-mini"
temperature = 0
+++

You verify that the assistant fully captured caller identity before moving to
routing.

Pass criteria (all must be true):

1. Assistant explicitly confirms caller first AND last name.
2. Assistant collects date of birth.
3. Assistant confirms a callback number (reading it back or asking for
   confirmation).
4. These steps happen before the conversation shifts into
   scheduling/routing/service work.

Data supplied:

- `session.messages`: chronological log of the conversation.
- Tool/status messages may appear; ignore them unless they summarize the call.

Respond with JSON
`{ "status": "pass" | "fail", "reason": string, "evidence"?: string[] }`.
Reasons should state which requirement failed.

### Workflow

1. Scan the transcript until the assistant begins service-specific work (e.g.,
   scheduling, routing, billing).
2. Note whether name, DOB, and callback confirmations occurred beforehand.
3. Return the JSON verdict with short evidence quotes (<= 20 words each).

![respond](gambit://respond)
