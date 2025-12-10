# internal_monolog

Demonstrates a non-root LLM deck emitting internal monolog (assistant turns without tool calls) before completing its work.

- `internal_monolog_parent.deck.md`: root deck that calls the child tool and relays its answer.
- `monolog_child.deck.md`: LLM child with `syntheticTools.respond=true` that first thinks aloud (monolog), then calls a compute action, then responds.
- `lookup_fact.deck.ts`: simple compute action the child calls.

Run in the simulator to see monolog traces:

```bash
deno run -A src/cli.ts serve examples/internal_monolog/internal_monolog_parent.deck.md --model openai/gpt-4o-mini --trace out.jsonl --verbose
```

Send a question (e.g., "What is Rust?"). In the Traces & Tools panel you’ll see:

- `model.result` from the child showing a content-only assistant turn (monolog).
- A `monolog` trace entry (emitted because the child is non-root and spoke without tool calls).
- Subsequent tool call/result for `lookup_fact`, then the final respond envelope.
