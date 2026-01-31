# Tests

Drop synthetic personas, test bots, or scripted scenarios here. Use them with
`gambit test-bot` to simulate user conversations and verify decks without real
users.

Typical flow:

1. Write a persona file (e.g. `tests/new_patient.deck.md`) that exercises a
   deck.
2. Run
   `npx @molt-foundry/gambit test-bot decks/<deck> --test-deck tests/<persona>`.
3. Capture regressions before shipping changes.
