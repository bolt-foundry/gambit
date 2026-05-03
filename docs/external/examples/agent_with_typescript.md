# Example: agent_with_typescript

What it shows

- Mixing a Markdown LLM agent definition with a TypeScript compute action.
- Embedding a reusable instruction snippet to steer tool usage and reply style.

Key files

- `init/examples/advanced/agent_with_typescript/agent_with_typescript.deck.md` —
  root LLM agent definition and workflow steps.
- `init/examples/advanced/agent_with_typescript/get_time.deck.ts` — TS compute
  action (returns ISO timestamp with Zod schemas).
- `init/examples/advanced/agent_with_typescript/tooling.card.md` — card that
  defines how/when to call the tool and how to respond. The `.card.md` suffix is
  a legacy compatibility filename for a prompt snippet.

Why it’s structured this way

- The snippet keeps routing guidance separate from the agent body, making it
  reusable.
- The TS action uses strict `contextSchema`/`responseSchema` to guarantee a
  deterministic payload from compute code.
- Keeping the model temperature at 0 ensures it consistently calls the tool and
  formats responses.

How to run

- `deno run -A src/cli.ts run init/examples/advanced/agent_with_typescript/agent_with_typescript.deck.md --context '"hi"' --stream`
- Override model: `--model-force anthropic/claude-3-haiku`

Try this input

- `--context '"hello"'` → calls `get_time`, replies with greeting + ISO
  timestamp
- `--context '"just checking time"'` → still calls `get_time`; echoes user text
  with timestamp
