# simpsons_explainer_user

Local dev example with scenario decks enabled and `startMode = "user"`.

## Prereqs

- Install Deno: https://deno.com
- Set `OPENROUTER_API_KEY` in your environment.

Example:

```bash
export OPENROUTER_API_KEY="your-key-here"
```

## Run the simulator

From this folder:

```bash
deno run -A jsr:@bolt-foundry/gambit@^0.8.3/cli serve PROMPT.md
```

## Run a scenario (UI)

1. Open the simulator UI and go to the "Test" tab.
2. Click "Run scenario".
3. Use the composer to send the first user message (start mode is user).
4. Optionally switch to the "Grade" tab and click "Run grader".

## Notes

- Scenario decks are registered in `cards/test_decks.card.md`.
- Graders are registered in `cards/grader_decks.card.md`.
- Instruction cards live in `cards/` and are included by `PROMPT.md`.
