# Arena Chatbot

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
deno run -A jsr:@molt-foundry/gambit/cli serve ./active.deck.md
```

## Run in the CLI

```bash
deno run -A jsr:@molt-foundry/gambit/cli run ./active.deck.md \
  --message '"Tell me one tip about Pikachu"' --stream
```

## Run a test bot (UI)

1. Open the simulator UI and go to the "Test" tab.
2. Choose the "Arena challenger" persona.
3. Click "Run test bot".

## Notes

- Bot variants live in `bots/`.
- The test bot deck is `tests/arena_challenger.deck.md`.
- The test bot hangup card is `cards/test_bot_hangup.card.md`.
