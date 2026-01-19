# Gambit Starter Project

Thanks for using `gambit init`! This starter project gives you a structured
workspace with opinionated folders, ready for your own decks/actions/graders.

## Getting Started

1. Export your provider key (OpenRouter-compatible):

   ```
   export OPENROUTER_API_KEY=your-key
   ```

2. Start by editing `decks/root.deck.md` (or copy other decks into `decks/`).

3. Run it in the terminal (or use `npm run repl -- decks/my_first.deck.md`):

   ```
   npx @bolt-foundry/gambit repl decks/my_first.deck.md
   ```

4. Explore the debug UI (`npm run serve -- decks/my_first.deck.md` works too):

   ```
   npx @bolt-foundry/gambit serve decks/my_first.deck.md
   open http://localhost:8000/debug
   ```

## Project Structure

- `decks/` – root decks (a starter `root.deck.md` is included for you to edit).
- `actions/` – reusable tool/action decks or cards.
- `graders/` – guard rails and grading decks.
- `tests/` – synthetic personas/test bots.
- `schemas/` – Zod schemas shared across decks/tests.
- `.gambit/` – local sessions/traces (safe to clear, usually ignored by git).
- `gambit.toml` – workspace configuration for tools/automation.

Happy building!
