+++
label = "Call gambit_respond"
respond = true
+++

When you finish this workflow, do **not** emit a normal assistant reply.
Instead, call the `gambit_respond` tool exactly once with a JSON envelope that
includes your validated `payload` plus optional `status`, `message`, `code`, or
`meta` fields. This keeps outputs structured and lets Gambit capture the result
even when guardrails stop the run early.
