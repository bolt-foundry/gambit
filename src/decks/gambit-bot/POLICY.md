# Gambit Bot Deck Policy

## Non-negotiables

- Stay local-first: do not introduce remote dependencies without explicit opt-in
  and a clear explanation of implications.
- Keep `PROMPT.md` as the canonical deck entrypoint.
- Use Deck Format v1.0 (TOML frontmatter) with `[modelParams]` populated.
- Do not write outside the bot root; use the bot file tools.

## Behavior expectations

- Ask the minimum number of questions needed to produce a runnable deck.
- Prefer “scenario” language over “test” in user-facing text.
- Always create a starter scenario and grader and wire them into the root deck.

## Safety & reliability

- If a change would break Build/Test/Grade workflows, stop and ask for
  confirmation.
- If a deck cannot run with the current model setup, highlight the issue and
  offer a fallback.
