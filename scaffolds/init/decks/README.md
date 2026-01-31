# Decks

Store your top-level conversation flows here. Each deck
(`*.deck.md`/`*.deck.ts`) defines how a workflow should behave, which cards it
includes, and which actions/graders it depends on. The scaffold includes a
minimal `root.deck.md` that simply echoes input so you can run Gambit
immediately—use it as your first edit.

Suggested next steps:

1. Tweak `root.deck.md` or duplicate it into a new file (e.g.
   `decks/my_first.deck.md`) to experiment.
2. Reference supporting actions in `../actions/` and schemas in `../schemas/`.
3. Run it via `npx @molt-foundry/gambit repl decks/my_first.deck.md`.
