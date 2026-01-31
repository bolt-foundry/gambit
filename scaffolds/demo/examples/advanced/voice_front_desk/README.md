# Voice Front Desk

This folder is self-contained and can run outside the bfmono repo as long as
Deno is installed and the machine has internet access (to fetch
`jsr:@molt-foundry/gambit`).

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
deno run -A jsr:@molt-foundry/gambit/cli serve ./decks/root.deck.md
```

## Run in the CLI

```bash
deno run -A jsr:@molt-foundry/gambit/cli run ./decks/root.deck.md \
  --context "$(cat ./sample_input.json)" \
  --message '"Hi, this is Nina. I need to move my physical."' --stream
```

## Run a test bot (UI)

1. Open the simulator UI and go to the "Test" tab.
2. Pick a persona from the list (for example, "New patient intake").
3. Click "Run test bot".

## Notes

- Root decks live in `decks/` and action decks live in `actions/`.
- Test personas are listed in `cards/test_decks.card.md`.
- The test bot hangup card is `tests/cards/test_bot_hangup.card.md`.
