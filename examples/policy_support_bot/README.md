# Policy Support Bot

A Gambit example that demonstrates how to build a simple FAQ-driven support bot
that returns a single-sentence answer grounded in the AcmeFlow FAQ. The example
includes:

- Markdown root deck (`policy_support_bot.deck.md`) that calls the search action
  and returns a one-sentence answer.
- Markdown retrieval action (`actions/search_faq.deck.md`) that reads the
  embedded FAQ knowledge base and returns structured matches with confidence
  scores.
- Demo prompts plus deterministic tests that guard the FAQ knowledge base.

## File tour

| Path                          | Purpose                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `policy_support_bot.deck.md`  | Main chatbot deck. Calls `search_faq` and returns one-sentence answers.                                          |
| `actions/search_faq.deck.md`  | Markdown action that reads the FAQ card, selects the best entries, and emits structured match objects.           |
| `cards/faq_knowledge.card.md` | Source-of-truth FAQ dataset (id, category, question, answer, URL) embedded inside both the action and bot decks. |
| `cards/*.card.md`             | Persona, user persona, and behavior cards reused by the root deck.                                               |
| `schemas/*.zod.ts`            | Zod schemas for bot outputs and search inputs.                                                                   |
| `tests/faq_dataset.test.ts`   | Deno unit tests that ensure the FAQ knowledge base stays intact.                                                 |
| `demo-script.md`              | Suggested prompts (answers + refusals) for the Gambit Debug UI.                                                  |
| `test-bot.md`                 | QA test bot script for the debug UI test-bot page.                                                               |
| `test-bot.input.zod.ts`       | Scenario input schema for the policy support bot test bot.                                                       |

## FAQ ingestion format

Each FAQ item follows this shape (see `cards/faq_knowledge.card.md`):

```ts
{
  id: string; // slug used for grading and references
  category: string; // e.g., "Plans & Pricing"
  question: string;
  answer: string; // authoritative response text
  sourceUrl: string; // link to official FAQ entry
}
```

You can swap in a different dataset by editing `cards/faq_knowledge.card.md` or
pointing the search action to an external data source.

## Running the bot

1. Answer mode:

   ```bash
   deno run -A packages/gambit/src/cli.ts run \
     packages/gambit/examples/policy_support_bot/policy_support_bot.deck.md \
     --message '"How much does AcmeFlow cost?"' --stream
   ```

2. No-coverage mode:

   ```bash
   deno run -A packages/gambit/src/cli.ts run \
     packages/gambit/examples/policy_support_bot/policy_support_bot.deck.md \
     --message '"Do you support HIPAA workflows?"' --stream
   ```

3. Debug UI (Gambit Web app):

   ```bash
   deno run -A packages/gambit/src/cli.ts serve \
     packages/gambit/examples/policy_support_bot/policy_support_bot.deck.md \
     --port 8787 --verbose
   # Open http://localhost:8787 to chat, view traces, and grade runs.
   ```

## Tests + demo script

- Run the FAQ dataset guard tests:

  ```bash
  cd packages/gambit
  deno test --allow-read examples/policy_support_bot/tests/faq_dataset.test.ts
  ```

- Work through `demo-script.md` to exercise:
  - In-scope grounded answers (pricing, exports).
  - Out-of-scope refusal (HIPAA, SOC reports beyond FAQ wording).
  - Edge case where the question partially overlaps two FAQ entries.

Tracking pass/fail for these prompts gives you coverage for both grounded
answers and correct refusals, matching the plan’s lightweight test suite.
