# Agent With TypeScript

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
  --message '"hi"' --stream
```

## Run a scenario (UI)

1. Open the simulator UI and go to the "Test" tab.
2. Choose the "Typescript agent test" persona.
3. Click "Run test".

## Notes

- The TypeScript action deck is `get_time.deck.ts`.
- The scenario deck is `tests/agent_with_typescript_test.deck.md`.
- The scenario hangup card is `cards/test_bot_hangup.card.md`.
