# Patient Swapper

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

## Run in the CLI

```bash
deno run -A jsr:@bolt-foundry/gambit/cli run ./patient_swapper.deck.md \
  --context "$(cat ./sample_input.json)" --stream
```

## Notes

- Cards live in `cards/` and schemas live in `schemas/`.
- The test bot deck is `tests/patient_swapper_test.deck.md`.
- The test bot hangup card is `cards/test_bot_hangup.card.md`.
