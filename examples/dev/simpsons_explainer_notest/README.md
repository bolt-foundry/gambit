# simpsons_explainer_notest

Local dev example for testing the Test tab when no test decks are configured.

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
deno run -A jsr:@molt-foundry/gambit@^0.8.3/cli serve root.deck.md
```

## Start the assistant (UI)

1. Open the simulator UI and go to the "Test" tab.
2. Click "Start assistant" (start mode is `assistant`).
3. Send messages manually.

## Notes

- This example intentionally has no `[[testDecks]]`.
- Graders are registered in `cards/grader_decks.card.md`.
- Instruction cards live in `cards/` and are included by `root.deck.md`.
