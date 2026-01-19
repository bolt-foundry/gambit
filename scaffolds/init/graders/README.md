# Graders

Use this folder for evaluation decks (LLM guards, rubric graders, etc.) that
validate your workflows. Graders can be invoked manually or via `gambit grade`
to keep runs honest.

Recommended:

- Create decks like `graders/tone_guard.deck.md` that assert specific behavior.
- Store shared schemas for grader input/output under `../schemas/`.
- Wire graders into CI or local workflows via `gambit grade`.
