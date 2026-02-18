# Agent With Multiple Actions

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
deno run -A jsr:@bolt-foundry/gambit/cli serve ./PROMPT.md
```

## Run in the CLI

```bash
deno run -A jsr:@bolt-foundry/gambit/cli run ./PROMPT.md \
  --message '"translate bonjour to English"' --stream
```

## Run a scenario (UI)

1. Open the simulator UI and go to the "Test" tab.
2. Choose the "Multi-actions test" persona.
3. Click "Run test".

## Notes

- Action decks live in `actions/decks/` and their cards live in
  `actions/cards/`.
- The scenario deck is `tests/agent_with_multi_actions_test.deck.md`.
- The scenario hangup card is `cards/test_bot_hangup.card.md`.
