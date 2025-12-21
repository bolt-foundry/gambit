# Policy-Aware Support Bot

This example (located at `packages/gambit/examples/policy_support_bot/`) shows
how to combine Markdown decks and compute actions to build a refusal-first
support bot grounded entirely in a curated FAQ.

Key ideas:

1. **FAQ ingestion** – `cards/faq_knowledge.card.md` is the canonical knowledge
   base. The Markdown action `actions/search_faq.deck.md` reads that card
   directly, selects the best entries, and emits structured matches with manual
   confidence scores (no external vector store required).
2. **Policy-aware orchestration** – `policy_support_bot.deck.md` embeds persona,
   grounding, and refusal cards, calls `search_faq`, enforces citation
   formatting, and uses `gambit://respond` with a schema so the UI/CLI always
   receives structured envelopes.
3. **Tests + demos** – `tests/faq_dataset.test.ts` guards the FAQ knowledge base
   (category headings, IDs, entry counts), while `demo-script.md` lists prompts
   for grounded answers, refusals, and edge cases that you can replay in the
   Gambit Debug UI.

Run the bot:

```bash
deno run -A packages/gambit/src/cli.ts run \
  packages/gambit/examples/policy_support_bot/policy_support_bot.deck.md \
  --message '"How much does AcmeFlow cost?"' --stream
```

Serve it in the web-based Gambit Debug UI:

```bash
deno run -A packages/gambit/src/cli.ts serve \
  packages/gambit/examples/policy_support_bot/policy_support_bot.deck.md \
  --port 8787
```
