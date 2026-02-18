# Policy Support Bot

A Gambit example that demonstrates how to build a simple FAQ-driven support bot
that returns a single-sentence answer grounded in the AcmeFlow FAQ. The example
includes:

- Markdown root deck (`PROMPT.md`) that calls the search action and returns a
  one-sentence answer.
- Markdown retrieval action (`actions/search_faq.deck.md`) that reads the
  embedded FAQ knowledge base and returns structured matches with confidence
  scores.
- Demo prompts plus deterministic tests that guard the FAQ knowledge base.

## File tour

| Path                                | Purpose                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `PROMPT.md`                         | Main chatbot deck. Calls `search_faq` and returns one-sentence answers.                                          |
| `actions/search_faq.deck.md`        | Markdown action that reads the FAQ card, selects the best entries, and emits structured match objects.           |
| `cards/faq_knowledge.card.md`       | Source-of-truth FAQ dataset (id, category, question, answer, URL) embedded inside both the action and bot decks. |
| `cards/*.card.md`                   | Persona, user persona, and behavior cards reused by the root deck.                                               |
| `schemas/*.zod.ts`                  | Zod schemas for bot outputs and search inputs.                                                                   |
| `tests/faq_dataset.test.ts`         | Deno unit tests that ensure the FAQ knowledge base stays intact.                                                 |
| `tests/new_account_persona.deck.md` | Synthetic persona deck for the Scenario tab.                                                                     |
| `demo-script.md`                    | Suggested prompts (answers + refusals) for the Gambit Debug UI.                                                  |

To wire synthetic QA personas into the Scenario tab, add `[[scenarios]]` entries
to `PROMPT.md` that point at persona decks (for example
`./tests/new_account_persona.deck.md`). Those persona decks should set
`acceptsUserTurns = true` and can declare an `contextSchema` so the Scenario
form is auto-generated.

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
   deno run -A src/cli.ts run \
     init/examples/advanced/policy_support_bot/PROMPT.md \
     --message '"How much does AcmeFlow cost?"' --stream
   ```

2. No-coverage mode:

   ```bash
   deno run -A src/cli.ts run \
     init/examples/advanced/policy_support_bot/PROMPT.md \
     --message '"Do you support HIPAA workflows?"' --stream
   ```

3. Debug UI (Gambit Web app):

   ```bash
   deno run -A src/cli.ts serve \
     init/examples/advanced/policy_support_bot/PROMPT.md \
     --port 8787 --verbose
   # Open http://localhost:8787 to chat, view traces, and grade runs.
   ```

## Tests + demo script

- Run the FAQ dataset guard tests:

  ```bash
  deno test --allow-read init/examples/advanced/policy_support_bot/tests/faq_dataset.test.ts
  ```

- Work through `demo-script.md` to exercise:
  - In-scope grounded answers (pricing, exports).
  - Out-of-scope refusal (HIPAA, SOC reports beyond FAQ wording).
  - Edge case where the question partially overlaps two FAQ entries.

Tracking pass/fail for these prompts gives you coverage for both grounded
answers and correct refusals, matching the plan’s lightweight test suite.
