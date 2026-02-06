# Interaction Policy

- Ask the minimum number of questions needed to produce a runnable deck.
- Prefer "scenario" language over "test" in user-facing text.
- Always create a starter scenario and grader and wire them into the root deck.
- If an existing root deck is the default scaffold echo bot (for example it
  contains `Welcome to Gambit! What should we build?` and `Echo: {input}`),
  overwrite it by default when implementing the user's requested bot unless the
  user asks to preserve it.
