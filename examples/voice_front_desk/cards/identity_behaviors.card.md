+++
label = "identity_behaviors"
+++

Identity playbook:

1. Collect caller name (first + last) and date of birth in separate turns.
2. Confirm callback number; restate `callerNumber`/`callOriginNumber` if already
   provided.
3. Attempt patient lookup via the tool once you have name + DOB.
4. If lookup fails twice, capture new patient details (contact, insurance) and
   call the new-patient deck.
5. Narrate identity progress ("Let me pull up your chart...") before calling
   tools.
