# Example: agent_with_multi_actions

What it shows

- Routing agent that picks exactly one tool from a mixed set of TS/MD child
  decks.
- Cards contribute action decks and schema fragments that merge into the root
  deck.

Key files

- `init/examples/advanced/agent_with_multi_actions/agent_with_multi_actions.deck.md`
  — root LLM router with brevity rules.
- `init/examples/advanced/agent_with_multi_actions/actions/cards/*.card.md` —
  cards declare action decks/labels/descriptions.
- `init/examples/advanced/agent_with_multi_actions/actions/decks/*` — child
  decks (TS compute and MD LLM) with Zod schemas.
- `init/examples/advanced/agent_with_multi_actions/schemas/*` — shared
  input/output schemas for tool calls.

Why it’s structured this way

- Action cards keep action-deck definitions close to their prompts and schemas;
  the loader merges them so the model sees a unified tool list.
- Clear descriptions + strict schemas bias the model toward the right action and
  payload shape.
- Root prompt enforces “exactly one action” to avoid tool-chaining and keeps
  replies short.

How to run

- Translate:
  `deno run -A src/cli.ts run init/examples/advanced/agent_with_multi_actions/agent_with_multi_actions.deck.md --context '"translate bonjour to English"' --stream`
- Summarize: `--context '"summarize: long text here"'`
- Math: `--context '{"a":4,"b":5,"op":"multiply"}'` (tool fills in defaults if
  missing).

Try this input

- `--context '"translate hola to French"'` → calls `translate_text`, returns
  translated text only
- `--context '"summarize: The quick brown fox jumps over the lazy dog."'` →
  calls `summarize_text`, returns one-sentence summary
- `--context '{"a":3,"b":7,"op":"add"}'` → calls `basic_math`, returns
  `{ "result": 10, "op": "add" }`
- `--context '"echo this back"'` → calls `echo_input`, returns echoed text
