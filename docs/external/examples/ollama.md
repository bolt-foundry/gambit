# Ollama

This example shows how to run an existing Gambit example against a local Ollama
instance using the OpenAI-compatible Responses API.

Prereqs:

- Install Ollama and start it: `ollama serve`
- Pull a model, for example: `ollama pull llama3.1`

Run the agent example with the Ollama model prefix:

```bash
deno run -A src/cli.ts run init/examples/advanced/agent_with_typescript/agent_with_typescript.deck.md \
  --context '"hi"' \
  --model ollama/llama3.1 \
  --stream
```

Notes:

- `ollama/` is the routing prefix; the prefix is stripped before sending to
  Ollama, so the actual model name is `llama3.1`.
- To point at a non-local instance, set `OLLAMA_BASE_URL` (defaults to
  `http://localhost:11434/v1`).

## Model aliases

Instead of hard-coding the `ollama/...` string in every deck, define an alias in
`gambit.toml`:

```toml
[models.aliases.randall]
model = "ollama/llama3.1"

[models.aliases.randall.params]
temperature = 0.2
```

Decks can now set `model = "randall"` inside `[modelParams]`. The CLI resolves
the alias before calling Ollama, automatically merging the default params
(`temperature = 0.2` above). CLI flags such as `--model randall` also use the
alias, so swapping the target model only requires editing `gambit.toml`.

Aliases can list multiple models (first available wins), which is helpful for
falling back to OpenRouter when Ollama is offline:

```toml
[models.aliases.randall]
model = ["ollama/llama3.1", "openrouter/openai/gpt-4o-mini"]
```
