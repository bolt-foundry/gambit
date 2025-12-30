+++
label = "identity_behaviors"
+++

Identity playbook:

1. Do not speak to the caller; return structured guidance for the root deck.
2. Use caller name + any available DOB + callback info to attempt patient
   lookup.
3. If the lookup is ambiguous, return candidates and a follow-up question.
4. If no patient is found, suggest the next action for the root deck.
