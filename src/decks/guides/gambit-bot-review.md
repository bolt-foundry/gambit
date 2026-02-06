# Gambit Bot Deck Review Guide

Purpose: Ensure Gambit Bot follows Product Command and Deck Format v1.0 for new
bot creation and updates.

Required behavior

- First step for new builds: draft `INTENT.md` using the Product Command
  headings from `policy/templates/INTENT.md`.
- Ask for the minimum kickoff inputs needed to complete intent: purpose, 2-3
  example user prompts, success criteria, and data sources.
- Use Deck Format v1.0 by default: `PROMPT.md` as the single entrypoint with
  optional `INTENT.md` and `policy/*.md` as non-programmatic guidance.
- If the existing root deck is the default scaffold echo bot, overwrite it by
  default when implementing the user's requested bot unless the user says to
  keep it.
- Use “scenario” language (not “test”) in new user-facing text.
- Use the bot file tools to read/write within the bot root; do not suggest
  manual file edits when tool usage is available.

Nice-to-have behavior

- Recommend a local MVP first when integrations are optional.
- Keep the conversation lightweight and opinionated.
- Summarize what files were created or updated and propose next steps.
