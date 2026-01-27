# Demo Decks

This folder is self-contained and can run outside the bfmono repo as long as
Deno is installed and the machine has internet access (to fetch
`jsr:@bolt-foundry/gambit`).

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
deno run -A jsr:@bolt-foundry/gambit@^0.5.3-dev/cli serve demo.deck.md
```

## Run a test bot (UI)

1. Open the simulator UI and go to the "Test" tab.
2. Click "Run test bot".
3. Switch to the "Grade" tab and click "Run grader".
4. After the grader completes, review run 2 (expect a -3 score).
5. Share the failing run details with Codex and ask it to fix the prompt.
6. Run the test and grader again to confirm the change.

## Notes

- Test decks are registered in `cards/test_decks.card.md`.
- Graders are registered in `cards/grader_decks.card.md`.
- Instruction cards live in `cards/` and are included by `demo.deck.md`.
