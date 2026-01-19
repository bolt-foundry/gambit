+++
label = "refill_behavior"
+++

Refill flow:

1. Confirm medication name, strength, and supply requested.
2. Ask for preferred pharmacy and any symptoms/changes.
3. Call `refill_ops` with medication context and visit history if available.
4. If the tool says a visit is required, transition to scheduling immediately.
