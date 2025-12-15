# Example: hello_world.deck.md

What it shows

- Minimal Markdown LLM deck with strict output rules.
- Uses `gambit://init` so the assistant stays assistant-first while still
  receiving input.

Key files

- `examples/hello_world.deck.md`

Why it’s structured this way

- Front matter declares only `modelParams` and label to keep the prompt focused.
- The `gambit://init` marker injects the raw `--init` payload as a tool result,
  so the model can branch on “empty vs provided” without a user turn.
- Rules are explicit to make behavior deterministic and testable.

How to run

- `deno run -A src/cli.ts run examples/hello_world.deck.md --init '"Gambit"' --stream`
- Try `--init '""'` to see the empty-case reply.

Try this input

- `--init '"Gambit"'` → responds exactly `hello, Gambit`
- `--init '""'` → responds exactly `hello, world`
