# Internal Monolog

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

## Run in the CLI

```bash
deno run -A jsr:@molt-foundry/gambit/cli run ./internal_monolog_parent.deck.md \
  --message '"What is the capital of France?"' --stream
```

## Notes

- The child deck is `monolog_child.deck.md` and schemas live in `schemas/`.
- The test bot deck is `tests/internal_monolog_test.deck.md`.
- The test bot hangup card is `cards/test_bot_hangup.card.md`.
